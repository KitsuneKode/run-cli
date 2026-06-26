import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { FlagDefinition } from "../args.ts";

export interface Command {
  name: string;
  description: string;
  flags?: Record<string, FlagDefinition>;
  allowForwardedArgs?: boolean;
  execute: (ctx: WorkspaceContext, parsed: ParsedArgs) => Promise<void>;
}
