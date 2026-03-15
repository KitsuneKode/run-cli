import { describe, expect, test } from "bun:test";
import path from "node:path";

import { run } from "../src/cli.ts";
import { CONFIG_FILE_NAME } from "../src/constants.ts";
import { pathExists, writeTextFile } from "../src/fs.ts";
import { captureConsole, createTempDir, withEnv } from "./helpers.ts";

describe("default profile and managed process workflow", () => {
  test("uses default_profile to decide what plain run executes and supports explicit profile flag", async () => {
    const projectRoot = await createTempDir("run-cli-default-profile-");

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        'default_profile = "dev"',
        'command = "echo stable"',
        "",
        "[profiles.default]",
        'command = "echo stable"',
        "",
        "[profiles.dev]",
        'command = "echo dev-mode"',
        'description = "preferred local workflow"',
      ].join("\n"),
    );

    const result = await captureConsole(async () => {
      await run(["--cwd", projectRoot, "--dry-run"]);
    });
    const explicitResult = await captureConsole(async () => {
      await run(["--cwd", projectRoot, "-p", "default", "--dry-run"]);
    });
    const profilesResult = await captureConsole(async () => {
      await run(["profiles", "--cwd", projectRoot]);
    });

    expect(result.stdout).toContain("echo dev-mode");
    expect(explicitResult.stdout).toContain("echo stable");
    expect(profilesResult.stdout).toContain("* dev");
    expect(profilesResult.stdout).toContain("preferred local workflow");
  });

  test("manages a background process with ps, inspect, logs, dashboard, and stop", async () => {
    const projectRoot = await createTempDir("run-cli-managed-");
    const stateRoot = path.join(projectRoot, ".state");

    await writeTextFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify(
        {
          name: "dx-app",
        },
        null,
        2,
      ),
    );
    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        "",
        "[profiles.default]",
        String.raw`command = "sh -c 'echo managed-start; sleep 30'"`,
      ].join("\n"),
    );

    await withEnv(
      {
        XDG_STATE_HOME: stateRoot,
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
      async () => {
        const upResult = await captureConsole(async () => {
          await run(["up", "--cwd", projectRoot, "--", "--flag"]);
        });
        const startedName = upResult.stdout.match(/started\s+([^\n]+)/)?.[1]?.trim();

        if (!startedName) {
          throw new Error(`Expected a managed process name in output:\n${upResult.stdout}`);
        }

        await Bun.sleep(200);

        const psResult = await captureConsole(async () => {
          await run(["ps", "--json"]);
        });
        const processes = JSON.parse(psResult.stdout) as Array<{
          name: string;
          projectName: string;
          status: string;
          logPath: string;
          commandArgs: string[];
        }>;
        const processRecord = processes.find((entry) => entry.name === startedName);

        expect(processRecord?.projectName).toBe("dx-app");
        expect(processRecord?.status).toBe("running");
        expect(processRecord?.logPath).toBeDefined();
        expect(processRecord?.commandArgs).toContain("--flag");

        const inspectResult = await captureConsole(async () => {
          await run(["inspect", startedName]);
        });
        expect(inspectResult.stdout).toContain("project: dx-app");
        expect(inspectResult.stdout).toContain("status: running");
        expect(inspectResult.stdout).toContain("args: --flag");

        const logsResult = await captureConsole(async () => {
          await run(["logs", startedName, "--lines", "10"]);
        });
        expect(logsResult.stdout).toContain("managed-start");

        const dashboardResult = await captureConsole(async () => {
          await run(["dashboard"]);
        });
        expect(dashboardResult.stdout).toContain("run dashboard");
        expect(dashboardResult.stdout).toContain("dx-app");
        expect(dashboardResult.stdout).toContain("Next: run inspect <name>");

        const stopResult = await captureConsole(async () => {
          await run(["stop", startedName]);
        });
        expect(stopResult.stdout).toContain(`stopped ${startedName}`);

        const stoppedPsResult = await captureConsole(async () => {
          await run(["ps", "--json"]);
        });
        const stoppedProcesses = JSON.parse(stoppedPsResult.stdout) as Array<{
          name: string;
          status: string;
          logPath: string;
        }>;
        const stoppedRecord = stoppedProcesses.find((entry) => entry.name === startedName);

        expect(stoppedRecord?.status).toBe("stopped");
        expect(await pathExists(stoppedRecord?.logPath ?? "")).toBe(true);
      },
    );
  });
});
