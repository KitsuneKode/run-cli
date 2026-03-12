import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CONFIG_FILE_NAME } from "../src/constants.ts";
import { writeTextFile } from "../src/fs.ts";

async function createTempProject(prefix: string): Promise<string> {
  return await Bun.$`mktemp -d ${path.join(os.tmpdir(), `${prefix}-XXXXXX`)}`
    .text()
    .then((value) => value.trim());
}

async function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  const command = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: `${import.meta.dir}/..`,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
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
});
