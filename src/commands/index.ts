import type { Command } from "./types.ts";
import { initCommand } from "./init.ts";
import { configCommand } from "./config.ts";
import { completionCommand } from "./completion.ts";
import { doctorCommand } from "./doctor.ts";
import { trustCommand } from "./trust.ts";

export const commands: Command[] = [
  initCommand,
  configCommand,
  completionCommand,
  doctorCommand,
  trustCommand,
];
