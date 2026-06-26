import type { WorkspaceContext } from "./context.ts";

export interface FlagDefinition {
  type: "boolean" | "string" | "number";
  short?: string;
  description: string;
  multiple?: boolean;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  flags?: Record<string, FlagDefinition>;
  /**
   * If true, any unrecognized flags and arguments are collected as forwarded args.
   * Useful for the `run` and `up` commands which delegate execution to a child process.
   */
  allowForwardedArgs?: boolean;
  execute(ctx: WorkspaceContext, parsed: ParsedCommand): Promise<void> | void;
}

export interface ParsedCommand {
  // Command-specific positional arguments
  positionals: string[];
  // Parsed flags mapping flag name (long form) to value
  flags: Record<string, unknown>;
  // Forwarded arguments (e.g. for run and up, containing unknown flags/args and anything after --)
  forwardedArgs: string[];
}
