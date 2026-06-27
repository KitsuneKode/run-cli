import type { FlagDefinition, ParsedArgs } from "../args.ts";
import type { WorkspaceContext } from "../context.ts";

export interface Command {
  name: string;
  description: string;
  usage?: string;
  flags?: Record<string, FlagDefinition>;
  allowForwardedArgs?: boolean;
  execute: (ctx: WorkspaceContext, parsed: ParsedArgs) => Promise<void>;
}
