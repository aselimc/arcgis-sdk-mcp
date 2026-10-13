/**
 * Text rendering of a doctor report. Kept apart from the checks so that `--json` prints the
 * same facts without any of this.
 */
import type { ProbeOutcome } from './doctor-probes.js';
import type { DoctorReport } from './doctor.js';

const tag = (status: string): string => `[${status}]`.padEnd(7);

function probeLine(probe: ProbeOutcome): string {
  const facts = [
    probe.adapter,
    ...(probe.floor ? ['floor'] : []),
    ...(probe.records === undefined ? [] : [`${probe.records} records`]),
    ...(probe.chars === undefined ? [] : [`${probe.chars} chars`]),
    ...(probe.family === undefined ? [] : [probe.family]),
    ...(probe.ms === undefined ? [] : [`${Math.round(probe.ms)} ms`]),
  ];
  const head = `${tag(probe.status)}${probe.product}/${probe.source} (${facts.join(', ')})`;
  return probe.status === 'ok'
    ? head
    : `${head}\n       ${probe.reason ?? 'no reason given'}\n       ${probe.url}`;
}

/** The report as plain text, ending with a one-line verdict. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(`${tag(check.status)}${check.id}: ${check.summary}`);
    for (const detail of check.detail) lines.push(`       ${detail}`);
  }

  const count = (status: ProbeOutcome['status']): number =>
    report.probes.filter((probe) => probe.status === status).length;
  // The default run checks one source per product, not all of them; the heading says so.
  const heading =
    report.probed === 'floor-sources'
      ? 'Floor sources probed (one per product; --product <id> probes every source of one)'
      : 'Sources probed';
  lines.push(
    '',
    `${heading}: ${count('ok')} ok, ${count('fail')} failed, ${count('skip')} skipped`,
    ...report.probes.map(probeLine),
    '',
  );

  if (report.exitCode === 0) {
    lines.push('Result: ok');
  } else if (report.failedFloors.length > 0) {
    lines.push(`Result: failed. Floor sources not reachable: ${report.failedFloors.join(', ')}`);
  } else {
    const failing = report.checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id);
    lines.push(`Result: failed. Failing checks: ${failing.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
