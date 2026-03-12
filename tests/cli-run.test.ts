import { describe, expect, test } from "bun:test";
import path from "node:path";

import { run } from "../src/cli.ts";
import { CONFIG_FILE_NAME } from "../src/constants.ts";
import { writeTextFile } from "../src/fs.ts";
import { captureConsole, createTempDir, withEnv } from "./helpers.ts";

describe("direct cli run()", () => {
  test("prints help without setting a failure exit code", async () => {
    const result = await captureConsole(async () => {
      await run(["help"]);
    });

    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("run init");
    expect(result.exitCode).toBe(0);
  });

  test("prints config path and dry-runs through the exported entrypoint", async () => {
    const projectRoot = await createTempDir("run-cli-direct-");
    const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

    await writeTextFile(configPath, ["version = 1", 'command = "echo direct-run"'].join("\n"));

    await withEnv(
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
      async () => {
        const pathResult = await captureConsole(async () => {
          await run(["config", "path", "--cwd", projectRoot]);
        });
        const dryRunResult = await captureConsole(async () => {
          await run(["--cwd", projectRoot, "--dry-run"]);
        });

        expect(pathResult.stdout).toContain(configPath);
        expect(dryRunResult.stdout).toContain("echo direct-run");
        expect(dryRunResult.exitCode).toBe(0);
      },
    );
  });

  test("renders doctor output when no config is present", async () => {
    const projectRoot = await createTempDir("run-cli-doctor-");

    await writeTextFile(path.join(projectRoot, "main.py"), "print('hello')\n");
    await writeTextFile(
      path.join(projectRoot, ".venv", "bin", "python"),
      "#!/usr/bin/env python\n",
    );

    await withEnv(
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
      async () => {
        const result = await captureConsole(async () => {
          await run(["doctor", "--cwd", projectRoot, "--no-cache"]);
        });

        expect(result.stdout).toContain("config lookup: not found");
        expect(result.stdout).toContain(".venv/bin/python main.py");
        expect(result.stdout).toContain("ecosystem=python");
      },
    );
  });
});
