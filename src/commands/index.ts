import type { Command } from "./types.ts";
import { initCommand } from "./init.ts";
import { configCommand } from "./config.ts";
import { completionCommand } from "./completion.ts";
import { doctorCommand } from "./doctor.ts";
import { trustCommand } from "./trust.ts";
import { upCommand } from "./up.ts";
import { psCommand } from "./ps.ts";
import { dashboardCommand } from "./dashboard.ts";
import { inspectCommand } from "./inspect.ts";
import { logsCommand } from "./logs.ts";
import { stopCommand } from "./stop.ts";
import { restartCommand } from "./restart.ts";
import { killCommand } from "./kill.ts";
import { pruneCommand } from "./prune.ts";
import { portsCommand } from "./ports.ts";
import { profilesCommand } from "./profiles.ts";

export const commands: Command[] = [
  initCommand,
  configCommand,
  completionCommand,
  doctorCommand,
  trustCommand,
  upCommand,
  psCommand,
  dashboardCommand,
  inspectCommand,
  logsCommand,
  stopCommand,
  restartCommand,
  killCommand,
  pruneCommand,
  portsCommand,
  profilesCommand,
];
