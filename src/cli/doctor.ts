/**
 * `arcgis-sdk-mcp doctor`: one report that answers "why does the server not find anything?".
 * Local checks first (configuration, policy, cache directory, proxy variables, adapters),
 * then the upstream probes, then what the probes revealed (GitHub quota, host breakers).
 */
import { missingAdapterTypes } from '../app/adapter-registry.js';
import type { Container } from '../app/container.js';
import { PACKAGE_NAME } from '../core/names.js';
import { compareVersions } from '../core/version-key.js';
import type { DoctorTier } from './args.js';
import { runProbes, selectProbeTargets, type ProbeOutcome } from './doctor-probes.js';

/** Oldest Node.js release the package supports (`engines` in package.json). */
export const MIN_NODE_VERSION = '22.12.0';

/** Verdict of one check. */
export type CheckStatus = 'ok' | 'warn' | 'fail';

/** One line of the report, with optional detail lines below it. */
export interface DoctorCheck {
  id: 'config' | 'policy' | 'cache' | 'proxy' | 'adapters' | 'github' | 'hosts';
  status: CheckStatus;
  summary: string;
  detail: string[];
}

/** The complete result of a doctor run; printed as text or as JSON. */
export interface DoctorReport {
  version: string;
  node: string;
  checks: DoctorCheck[];
  /**
   * Which sources were selected: the floor source of each product (the default), or every
   * source of the product named with `--product`. A report that does not say so reads as
   * if every source had been checked.
   */
  probed: 'floor-sources' | 'product-sources';
  probes: ProbeOutcome[];
  /** Floor sources of developer products whose probe failed, as `product/source`. */
  failedFloors: string[];
  /** 1 when a check failed or a floor source of a developer product is failing, else 0. */
  exitCode: 0 | 1;
}

/** Arguments of the `doctor` command. */
export interface DoctorOptions {
  product?: string;
  tier: DoctorTier;
}

/** What `doctor` needs from the process, injected so the command is testable. */
export interface DoctorDeps {
  env: NodeJS.ProcessEnv;
  /** `process.versions.node`. */
  nodeVersion: string;
  /** Tries to create a file in `dir`; resolves with the failure message, or nothing on success. */
  checkWritable: (dir: string) => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
  /** Progress lines while the probes run. */
  progress?: (line: string) => void;
}

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function configCheck(container: Container, nodeVersion: string): DoctorCheck {
  const { config } = container;
  const nodeOk = compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0;
  return {
    id: 'config',
    status: nodeOk ? 'ok' : 'fail',
    summary: nodeOk
      ? `${PACKAGE_NAME} ${config.version}, Node ${nodeVersion}, ${config.mode} mode`
      : `Node ${nodeVersion} is older than the required ${MIN_NODE_VERSION}`,
    detail: [
      `project directory: ${config.projectDir}`,
      `default result size: ${config.defaultMaxTokens} tokens`,
      `log level: ${config.logLevel}`,
    ],
  };
}

function policyCheck(container: Container): DoctorCheck {
  const summary = container.policy.summary();
  return {
    id: 'policy',
    // Offline is a legitimate setting, but it explains every "not found" that follows.
    status: summary.offline ? 'warn' : 'ok',
    summary: `preset ${summary.preset}${summary.offline ? ', offline (cache only)' : ''}`,
    detail: [
      `enabled: ${summary.enabled.join(', ') || 'none'}`,
      `disabled: ${summary.disabled.join(', ') || 'none'}`,
    ],
  };
}

async function cacheCheck(container: Container, deps: DoctorDeps): Promise<DoctorCheck> {
  try {
    const info = await container.cache.info();
    const problem = await deps.checkWritable(info.dir);
    return {
      id: 'cache',
      status: problem === undefined ? 'ok' : 'fail',
      summary:
        problem === undefined
          ? `${info.dir} is writable`
          : `${info.dir} is not writable: ${problem}`,
      detail: [
        `${info.entries} entries, ${mb(info.bytes)} of ${container.config.cacheMaxMb} MB`,
        ...(problem === undefined ? [] : ['set ARCGIS_DOCS_CACHE_DIR to a writable directory']),
      ],
    };
  } catch (error) {
    return {
      id: 'cache',
      status: 'fail',
      summary: `the cache cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      detail: ['set ARCGIS_DOCS_CACHE_DIR to a writable directory'],
    };
  }
}

/** A proxy URL without its credentials, which must not end up in a pasted report. */
function redactProxy(value: string): string {
  return value.replace(/\/\/[^/@]*@/, '//***@');
}

function proxyCheck(env: NodeJS.ProcessEnv): DoctorCheck {
  const names = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];
  const set = names.filter((name) => (env[name] ?? '') !== '');
  const usesProxy = set.some((name) => !name.toLowerCase().startsWith('no_'));
  const enabled = ['1', 'true'].includes((env.NODE_USE_ENV_PROXY ?? '').toLowerCase());
  const detail = set.map((name) => `${name}=${redactProxy(env[name] ?? '')}`);
  if (!usesProxy) {
    return { id: 'proxy', status: 'ok', summary: 'no proxy variables are set', detail };
  }
  if (enabled) {
    return {
      id: 'proxy',
      status: 'ok',
      summary: 'proxy variables are set and NODE_USE_ENV_PROXY is on',
      detail,
    };
  }
  return {
    id: 'proxy',
    status: 'warn',
    summary: "proxy variables are set, but Node's fetch ignores them by default",
    detail: [
      ...detail,
      'set NODE_USE_ENV_PROXY=1 in the environment of the MCP host so that requests use the proxy',
      'this needs a Node.js release with environment-proxy support; upgrade Node if requests still fail',
    ],
  };
}

function adaptersCheck(container: Container): DoctorCheck {
  const missing = new Set(missingAdapterTypes(container.adapters));
  const needed = new Set(
    container.registry.all().flatMap((product) => product.sources.map((source) => source.adapter)),
  );
  const broken = [...needed].filter((type) => missing.has(type));
  return {
    id: 'adapters',
    status: broken.length === 0 ? 'ok' : 'fail',
    summary:
      broken.length === 0
        ? `${container.adapters.types().length} source adapters, ${container.registry.all().length} products`
        : `the registry uses adapters this build lacks: ${broken.join(', ')}`,
    detail: [],
  };
}

function githubCheck(container: Container): DoctorCheck {
  const quota = container.github.quota();
  // The quota is learned from response headers, so it is unknown until an API call was made.
  const remaining =
    quota.remaining === undefined ? 'quota not read yet' : `${quota.remaining} requests remaining`;
  return {
    id: 'github',
    status: quota.remaining === 0 || !quota.authenticated ? 'warn' : 'ok',
    summary: quota.authenticated
      ? `authenticated with GITHUB_TOKEN, ${remaining}`
      : `unauthenticated (60 requests per hour), ${remaining}`,
    detail: [
      ...(quota.resetAt === undefined ? [] : [`quota resets at ${quota.resetAt}`]),
      ...(quota.authenticated ? [] : ['set GITHUB_TOKEN to raise the quota to 5000 per hour']),
    ],
  };
}

function hostsCheck(container: Container): DoctorCheck {
  const states = container.http.hostStates();
  const troubled = states.filter((state) => state.breaker !== 'closed');
  return {
    id: 'hosts',
    status: troubled.length === 0 ? 'ok' : 'warn',
    summary:
      troubled.length === 0
        ? `${states.length} hosts contacted, none failing`
        : `${troubled.length} of ${states.length} contacted hosts are failing`,
    detail: troubled.map(
      (state) =>
        `${state.host}: breaker ${state.breaker}${state.lastError === undefined ? '' : ` (${state.lastError})`}`,
    ),
  };
}

/**
 * Runs every check and probe.
 *
 * @throws McpDocError `UNKNOWN_PRODUCT` when `options.product` does not resolve; every other
 *   problem becomes a line of the report.
 */
export async function runDoctor(
  container: Container,
  options: DoctorOptions,
  deps: DoctorDeps,
): Promise<DoctorReport> {
  const targets = selectProbeTargets(container.registry, options);
  const checks: DoctorCheck[] = [
    configCheck(container, deps.nodeVersion),
    policyCheck(container),
    await cacheCheck(container, deps),
    proxyCheck(deps.env),
    adaptersCheck(container),
  ];

  const probed = options.product === undefined ? 'floor-sources' : 'product-sources';
  deps.progress?.(
    probed === 'floor-sources'
      ? `probing ${targets.length} floor sources (one per product)`
      : `probing ${targets.length} sources`,
  );
  const probes = await runProbes(container, targets, deps.sleep, (outcome) => {
    const tail = outcome.reason === undefined ? '' : `: ${outcome.reason}`;
    deps.progress?.(`${outcome.status} ${outcome.product}/${outcome.source}${tail}`);
  });
  checks.push(githubCheck(container), hostsCheck(container));

  const failedFloors = probes
    .filter((probe) => probe.status === 'fail' && probe.floor && probe.tier === 'developer')
    .map((probe) => `${probe.product}/${probe.source}`);
  const failed = failedFloors.length > 0 || checks.some((check) => check.status === 'fail');
  return {
    version: container.config.version,
    node: deps.nodeVersion,
    checks,
    probed,
    probes,
    failedFloors,
    exitCode: failed ? 1 : 0,
  };
}
