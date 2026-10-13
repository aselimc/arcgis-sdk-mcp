/**
 * `arcgis-sdk-mcp call <tool> '<json>'`: runs one tool through a real server instance and
 * returns the text an agent would see. Useful for trying a query by hand and in bug reports.
 */
import type { ToolName } from '../core/names.js';
import { RpcError, withInProcessClient, type ConnectableServer } from './in-process-client.js';

/** Outcome of one tool call. */
export interface CallOutcome {
  /** The text blocks of the result, joined by blank lines. */
  text: string;
  /** True for a tool error (`isError`) and for a rejected request (invalid arguments). */
  isError: boolean;
}

/** Text of every `{ type: 'text' }` block of a tool result; other block types are named. */
function textOf(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: unknown) => {
      const { type, text } = block as { type?: unknown; text?: unknown };
      return typeof text === 'string'
        ? text
        : `[${typeof type === 'string' ? type : 'unknown'} content]`;
    })
    .join('\n\n');
}

/**
 * Calls `tool` with `args` on `server` and closes the server afterwards.
 *
 * A request the server rejects before the tool runs (arguments that fail the input schema)
 * is reported as an error outcome, not thrown: for the person at the terminal it is the same
 * kind of answer as a tool error.
 */
export async function runCall(
  server: ConnectableServer,
  tool: ToolName,
  args: Record<string, unknown>,
  clientVersion: string,
): Promise<CallOutcome> {
  try {
    const result = await withInProcessClient(server, clientVersion, (request) =>
      request('tools/call', { name: tool, arguments: args }),
    );
    return {
      text: textOf(result),
      isError: (result as { isError?: unknown } | null)?.isError === true,
    };
  } catch (error) {
    if (error instanceof RpcError) {
      return { text: `Error: ${error.message} (JSON-RPC ${error.code})`, isError: true };
    }
    throw error;
  }
}
