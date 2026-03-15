import { describe, expect, test } from "bun:test";
import path from "node:path";

import { run } from "../src/cli.ts";
import { CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME } from "../src/constants.ts";
import { writeTextFile } from "../src/fs.ts";
import { captureConsole, createTempDir, withEnv } from "./helpers.ts";

describe("direct cli run()", () => {
  test("prints help without setting a failure exit code", async () => {
    const result = await captureConsole(async () => {
      await run(["help"]);
    });

    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("run init");
    expect(result.stdout).toContain('plain "run" = default command');
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

  test("shows legacy config migration hint in normal output", async () => {
    const projectRoot = await createTempDir("run-cli-legacy-hint-");

    await writeTextFile(
      path.join(projectRoot, LEGACY_CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo legacy-run"'].join("\n"),
    );

    await withEnv(
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
      async () => {
        const result = await captureConsole(async () => {
          await run(["--cwd", projectRoot]);
        });

        expect(result.stdout).toContain("run // echo legacy-run");
        expect(result.stdout).toContain("Rename it to .run.toml");
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

  test("renders doctor json output", async () => {
    const projectRoot = await createTempDir("run-cli-doctor-json-");

    await writeTextFile(path.join(projectRoot, "main.py"), "print('hello')\n");

    await withEnv(
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
      async () => {
        const result = await captureConsole(async () => {
          await run(["doctor", "--json", "--cwd", projectRoot, "--no-cache"]);
        });

        const parsed = JSON.parse(result.stdout);
        expect(parsed.cwd).toBe(projectRoot);
        expect(parsed.detectedProject.root).toBe(projectRoot);
      },
    );
  });

  test("validates config through config validate", async () => {
    const projectRoot = await createTempDir("run-cli-validate-");
    const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

    await writeTextFile(configPath, ["version = 1", 'command = "echo ok"'].join("\n"));

    const result = await captureConsole(async () => {
      await run(["config", "validate", "--cwd", projectRoot]);
    });

    expect(result.stdout).toContain(`valid ${configPath}`);
  });

  test("prints completion scripts for zsh and bash", async () => {
    const zshResult = await captureConsole(async () => {
      await run(["completion", "zsh"]);
    });
    const bashResult = await captureConsole(async () => {
      await run(["completion", "bash"]);
    });

    expect(zshResult.stdout).toContain("#compdef run runx");
    expect(zshResult.stdout).toContain("compdef _run run runx");
    expect(zshResult.stdout).toContain("--profile[Select a named profile]");
    expect(zshResult.stdout).toContain(
      "--details[Show detailed managed-process metrics where supported]",
    );
    expect(zshResult.stdout).toContain("if (( ${words[(I)--]} )); then");
    expect(bashResult.stdout).toContain("complete -F _run_complete run runx");
    expect(bashResult.stdout).toContain("--verbose -v --details --profile -p");
  });
});
