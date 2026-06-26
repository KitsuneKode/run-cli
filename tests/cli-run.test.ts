import { describe, expect, test } from "bun:test";
import os from "node:os";
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

        expect(result.stdout).toContain("run → echo legacy-run");
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

    expect(zshResult.stdout).toContain("#compdef run");
    expect(zshResult.stdout).toContain("compdef _run run");
    expect(zshResult.stdout).toContain("--profile[Select a named profile]");
    expect(zshResult.stdout).toContain("--watch[Live-refresh ps every 2s]");
    expect(zshResult.stdout).toContain("--follow[Follow log output]");
    // Strips ANSI codes from ps output before parsing managed names
    expect(zshResult.stdout).toContain("sed");
    expect(zshResult.stdout).toContain("x1b");
    expect(zshResult.stdout).toContain("if (( ${words[(I)--]} )); then");
    expect(bashResult.stdout).toContain("complete -F _run_complete run");
    expect(bashResult.stdout).toContain("--watch -w");
    expect(bashResult.stdout).toContain("x1b");
  });

  test("installs completion hooks to zsh rc file", async () => {
    const projectRoot = await createTempDir("run-cli-install-");
    const originalHomedir = os.homedir;

    os.homedir = () => projectRoot;

    try {
      const zshrcPath = path.join(projectRoot, ".zshrc");

      const installResult = await captureConsole(async () => {
        await run(["completion", "zsh", "--install"]);
      });

      expect(installResult.stdout).toContain("Successfully installed shell hook to ~/.zshrc");

      const content = await Bun.file(zshrcPath).text();
      expect(content).toContain("# run-cli completion hook");
      expect(content).toContain('eval "$(run completion zsh --shell-hook)"');

      const reinstallResult = await captureConsole(async () => {
        await run(["completion", "zsh", "--install"]);
      });

      expect(reinstallResult.stdout).toContain("Shell hook is already present in ~/.zshrc");
    } finally {
      os.homedir = originalHomedir;
    }
  });

  test("trust lifecycle and flag routing", async () => {
    const projectRoot = await createTempDir("run-cli-trust-");
    const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

    await writeTextFile(configPath, ["version = 1", 'command = "echo ok"'].join("\n"));

    await withEnv(
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
      async () => {
        // 1. run trust --check exit code is 1 when the config is untrusted.
        const checkResult1 = await captureConsole(async () => {
          await run(["trust", "--check", "--cwd", projectRoot]);
        });
        expect(checkResult1.exitCode).toBe(1);

        // Also test check as a positional for backward compatibility
        const checkPosResult1 = await captureConsole(async () => {
          await run(["trust", "check", "--cwd", projectRoot]);
        });
        expect(checkPosResult1.exitCode).toBe(1);

        // 2. run trust works, and then run trust --check exits with 0.
        const trustResult = await captureConsole(async () => {
          await run(["trust", "--cwd", projectRoot]);
        });
        expect(trustResult.stdout).toContain("Trusted");
        expect(trustResult.exitCode).toBe(0);

        const checkResult2 = await captureConsole(async () => {
          await run(["trust", "--check", "--cwd", projectRoot]);
        });
        expect(checkResult2.exitCode).toBe(0);

        // 4. run trust --list lists the trusted configuration paths.
        const listResult = await captureConsole(async () => {
          await run(["trust", "--list", "--cwd", projectRoot]);
        });
        expect(listResult.stdout).toContain(configPath);
        expect(listResult.exitCode).toBe(0);

        // Also check JSON option
        const listJsonResult = await captureConsole(async () => {
          await run(["trust", "--list", "--json", "--cwd", projectRoot]);
        });
        const listData = JSON.parse(listJsonResult.stdout.trim());
        expect(listData.length).toBeGreaterThan(0);
        expect(listData[0].configPath).toBe(configPath);

        // 3. run trust --revoke makes the config untrusted again.
        const revokeResult = await captureConsole(async () => {
          await run(["trust", "--revoke", "--cwd", projectRoot]);
        });
        expect(revokeResult.stdout).toContain("Revoked trust");
        expect(revokeResult.exitCode).toBe(0);

        const checkResult3 = await captureConsole(async () => {
          await run(["trust", "--check", "--cwd", projectRoot]);
        });
        expect(checkResult3.exitCode).toBe(1);
      },
    );
  });
});
