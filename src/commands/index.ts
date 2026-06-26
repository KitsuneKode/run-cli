import { completionCommand } from "./completion.ts";
import { configCommand } from "./config.ts";
import { dashboardCommand } from "./dashboard.ts";
import { doctorCommand } from "./doctor.ts";
import { initCommand } from "./init.ts";
import { inspectCommand } from "./inspect.ts";
import { killCommand } from "./kill.ts";
import { logsCommand } from "./logs.ts";
import { portsCommand } from "./ports.ts";
import { profilesCommand } from "./profiles.ts";
import { pruneCommand } from "./prune.ts";
import { psCommand } from "./ps.ts";
import { restartCommand } from "./restart.ts";
import { stopCommand } from "./stop.ts";
import { trustCommand } from "./trust.ts";
import type { Command } from "./types.ts";
import { upCommand } from "./up.ts";

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
