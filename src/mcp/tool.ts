/**
 * Registration of one tool: the shared annotations, a fresh request budget per call and the
 * conversion of every thrown error into an `isError` result (design sections 3.1 and 6.1).
 */
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import { newBudget } from '../core/async.js';
import type { ToolName } from '../core/names.js';
import type { CallOptions } from '../core/ports.js';
import { READ_ONLY_ANNOTATIONS } from './annotations.js';
import type { McpContainer } from './container.js';
import { renderError } from './errors.js';

/** Everything `tools/list` shows for one tool. Also the input of the tools documentation. */
export interface ToolDefinition<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodObject = z.ZodObject,
> {
  name: ToolName;
  title: string;
  /** Descriptive only, at most 1,000 characters. */
  description: string;
  inputSchema: I;
  /** Present on the tools that return `structuredContent`. */
  outputSchema?: O;
  meta?: Record<string, unknown>;
}

/** The body of a tool: validated arguments in, a complete result out. May throw `McpDocError`. */
export type ToolHandler<I extends z.ZodObject> = (
  args: z.output<I>,
  call: CallOptions,
  container: McpContainer,
) => Promise<CallToolResult>;

/**
 * Registers `definition` on `server`.
 *
 * Each call gets its own `RequestBudget` from the configured limits and the request's abort
 * signal. A handler that throws yields `Error [CODE]: ...` with `isError: true`; nothing
 * propagates to the SDK, so an agent never sees a bare JSON-RPC error for a failed lookup.
 */
export function registerDocTool<I extends z.ZodObject, O extends z.ZodObject>(
  server: McpServer,
  container: McpContainer,
  definition: ToolDefinition<I, O>,
  handler: ToolHandler<I>,
): void {
  // The SDK infers the callback's argument type from the schema, which it cannot do through
  // a type parameter: register with the widened schema types and narrow the arguments below.
  const inputSchema: z.ZodObject = definition.inputSchema;
  const outputSchema: z.ZodObject | undefined = definition.outputSchema;
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema,
      ...(outputSchema === undefined ? {} : { outputSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
      ...(definition.meta === undefined ? {} : { _meta: definition.meta }),
    },
    async (args, request): Promise<CallToolResult> => {
      const { ctx } = container;
      const call: CallOptions = {
        budget: newBudget(
          ctx.config.limits.requestsPerCall,
          ctx.config.limits.callDeadlineMs,
          ctx.clock,
        ),
        signal: request.mcpReq.signal,
      };
      try {
        // Validated by the SDK against `definition.inputSchema` before this callback runs.
        return await handler(args as z.output<I>, call, container);
      } catch (thrown) {
        return renderError(
          thrown,
          { tool: definition.name, args },
          { logger: ctx.logger, clock: ctx.clock, repoUrl: ctx.config.repoUrl },
        );
      }
    },
  );
}
