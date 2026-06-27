import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME } from "../src/constants.ts";
import { writeTextFile } from "../src/fs.ts";

async function createTempProject(prefix: string): Promise<string> {
  return await Bun.$`mktemp -d ${path.join(os.tmpdir(), `${prefix}-XXXXXX`)}`
    .text()
    .then((value) => value.trim());
}

async function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  const stateHome = extraEnv.XDG_STATE_HOME ?? path.join(cwd, ".state");
  const cacheHome = extraEnv.XDG_CACHE_HOME ?? path.join(cwd, ".cache");
  const configHome = extraEnv.XDG_CONFIG_HOME ?? path.join(cwd, ".config");

  const command = Bun.spawn(["bun", "src/bin/run.ts", ...args], {
    cwd: `${import.meta.dir}/..`,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      XDG_STATE_HOME: stateHome,
      XDG_CACHE_HOME: cacheHome,
      XDG_CONFIG_HOME: configHome,
      ...extraEnv,
      RUN_TEST_CWD: cwd,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

describe("cli integration", () => {
  test("prints a dry-run command from the nearest config", async () => {
    const projectRoot = await createTempProject("run-cli");
    const nestedDir = path.join(projectRoot, "packages", "api");

    await mkdir(nestedDir, { recursive: true });
    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo from-root"'].join("\n"),
    );

    const result = await runCli(["--cwd", nestedDir, "--dry-run"], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("echo from-root");
  });

  test("forwards args to the default command and renders a minimal banner", async () => {
    const projectRoot = await createTempProject("run-cli-args");

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo hello"'].join("\n"),
    );

    const result = await runCli(["--cwd", projectRoot, "--dry-run", "world"], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("echo hello 'world'");
  });

  test("resolves profile from binary name or invoked-as parameter", async () => {
    const projectRoot = await createTempProject("run-cli-invoked");

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        "",
        "[profiles.dev]",
        'command = "echo dev-mode"',
        'alias = "d"',
        "",
        "[profiles.build]",
        'command = "echo build-mode"',
        'alias = "b"',
      ].join("\n"),
    );

    const result1 = await runCli(
      ["--cwd", projectRoot, "--dry-run", "--invoked-as", "rund"],
      projectRoot,
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
    );
    expect(result1.exitCode).toBe(0);
    expect(result1.stdout).toContain("echo dev-mode");

    const result2 = await runCli(["--cwd", projectRoot, "--dry-run"], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      RUN_INVOKED_AS: "runb",
    });
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).toContain("echo build-mode");
  });

  test("shows a migration error for old positional profile usage", async () => {
    const projectRoot = await createTempProject("run-cli-migrate");

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        'default_profile = "default"',
        "",
        "[profiles.default]",
        'command = "echo stable"',
        "",
        "[profiles.dev]",
        'command = "echo dev"',
      ].join("\n"),
    );

    const result = await runCli(["--cwd", projectRoot, "dev"], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("positional profiles were removed");
    expect(result.stderr).toContain("run -p dev");
  });

  test("shows a migration error for old positional profile usage with extra args", async () => {
    const projectRoot = await createTempProject("run-cli-migrate-extra");

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        'default_profile = "default"',
        "",
        "[profiles.default]",
        'command = "echo stable"',
        "",
        "[profiles.dev]",
        'command = "echo dev"',
      ].join("\n"),
    );

    const result = await runCli(["--cwd", projectRoot, "dev", "--watch"], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("positional profiles were removed");
    expect(result.stderr).toContain("run -p dev");
    // --watch is a CLI flag, not a child arg, so message shows just "dev"
    expect(result.stderr).toContain("run -- dev");
  });

  test("continues parsing flags before passthrough boundary", async () => {
    const projectRoot = await createTempProject("run-cli-flags");

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        'default_profile = "default"',
        "",
        "[profiles.default]",
        'command = "echo stable"',
        "",
        "[profiles.dev]",
        'command = "echo dev"',
      ].join("\n"),
    );

    const result = await runCli(
      ["--cwd", projectRoot, "-p", "dev", "--dry-run", "foo"],
      projectRoot,
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("echo dev 'foo'");
  });

  test("suggests init when no config exists", async () => {
    const projectRoot = await createTempProject("run-cli-empty");

    await writeTextFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify(
        {
          packageManager: "bun@1.3.9",
          scripts: {
            start: "bun run index.ts",
          },
        },
        null,
        2,
      ),
    );
    await writeTextFile(path.join(projectRoot, "bun.lock"), "lock\n");

    const result = await runCli(["--cwd", projectRoot], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("run init");
    expect(result.stdout).toContain("bun run start");
    expect(result.stdout).toContain("--command");
  });

  test("creates config via non-interactive init", async () => {
    const projectRoot = await createTempProject("run-cli-init");

    await writeTextFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify(
        {
          packageManager: "bun@1.3.9",
          scripts: {
            start: "bun run index.ts",
            dev: "bun run dev.ts",
          },
        },
        null,
        2,
      ),
    );
    await writeTextFile(path.join(projectRoot, "bun.lock"), "lock\n");

    const result = await runCli(["init", "--yes", "--cwd", projectRoot], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.exitCode).toBe(0);
    expect(await Bun.file(path.join(projectRoot, CONFIG_FILE_NAME)).text()).toContain(
      'command = "bun run start"',
    );
    expect(result.stdout).toContain("created");
  });

  test("creates python config using uv-aware detection", async () => {
    const projectRoot = await createTempProject("run-cli-python");

    await writeTextFile(path.join(projectRoot, "main.py"), "print('hello')\n");
    await writeTextFile(path.join(projectRoot, "uv.lock"), "version = 1\n");
    await writeTextFile(
      path.join(projectRoot, "pyproject.toml"),
      ["[project]", 'name = "demo"', 'version = "0.1.0"'].join("\n"),
    );

    const result = await runCli(["init", "--yes", "--cwd", projectRoot], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.exitCode).toBe(0);
    expect(await Bun.file(path.join(projectRoot, CONFIG_FILE_NAME)).text()).toContain(
      'command = "uv run python main.py"',
    );
  });

  test("prefers .run.toml over legacy config and shows legacy doctor status", async () => {
    const projectRoot = await createTempProject("run-cli-legacy");

    await writeTextFile(
      path.join(projectRoot, LEGACY_CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo legacy"'].join("\n"),
    );
    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo current"'].join("\n"),
    );

    const result = await runCli(["--cwd", projectRoot, "--dry-run"], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
    });

    expect(result.stdout).toContain("echo current");
    expect(result.stdout).not.toContain("echo legacy");
  });

  test("forwards unknown flags directly to child command without double dashes", async () => {
    const projectRoot = await createTempProject("run-cli-forward-flags");

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", "", "[profiles.test]", 'command = "bun run test"', 'alias = "t"'].join("\n"),
    );

    // Invoke as runt --cli
    const result1 = await runCli(["--cwd", projectRoot, "--dry-run", "--cli"], projectRoot, {
      XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
      XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      RUN_INVOKED_AS: "runt",
    });
    expect(result1.exitCode).toBe(0);
    expect(result1.stdout.trim()).toBe("bun run test '--cli'");

    // Invoke as run -p test --cli --mode=prod
    const result2 = await runCli(
      ["--cwd", projectRoot, "-p", "test", "--dry-run", "--cli", "--mode=prod"],
      projectRoot,
      {
        XDG_CACHE_HOME: path.join(projectRoot, ".cache"),
        XDG_CONFIG_HOME: path.join(projectRoot, ".config"),
      },
    );
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout.trim()).toBe("bun run test '--cli' '--mode=prod'");
  });

  test("prints shell hook completion scripts without syntax errors", async () => {
    const resultZsh = await runCli(["completion", "zsh", "--shell-hook"], os.tmpdir());
    expect(resultZsh.exitCode).toBe(0);
    expect(resultZsh.stdout).toContain("_run_hook_chpwd");

    const resultBash = await runCli(["completion", "bash", "--shell-hook"], os.tmpdir());
    expect(resultBash.exitCode).toBe(0);
    expect(resultBash.stdout).toContain("_run_hook_update");
  });
});
