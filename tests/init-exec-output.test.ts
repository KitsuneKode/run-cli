import { describe, expect, test } from "bun:test";
import path from "node:path";

import { CacheStore } from "../src/cache.ts";
import { CONFIG_FILE_NAME } from "../src/constants.ts";
import { runResolvedProfile } from "../src/exec.ts";
import { writeTextFile } from "../src/fs.ts";
import { runInit } from "../src/init.ts";
import { bold, info, red, warn, yellow } from "../src/output.ts";
import type { GlobalConfig, ResolvedProfile } from "../src/types.ts";
import { captureConsole, createTempDir } from "./helpers.ts";

function testGlobalConfig(): GlobalConfig {
  return {
    version: 1,
    cache: true,
    detection: "suggest",
    shell: "/bin/sh",
  };
}

function testProfile(command: string): ResolvedProfile {
  return {
    name: "default",
    command,
    cwd: process.cwd(),
    env: {},
    sourcePath: "test",
    configDir: process.cwd(),
  };
}

describe("init, exec, and output helpers", () => {
  test("runInit rejects existing config without force", async () => {
    const projectRoot = await createTempDir("run-cli-init-existing-");
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      'version = 1\ncommand = "echo hi"\n',
    );

    await expect(
      runInit({
        cwd: projectRoot,
        useCache: true,
        force: false,
        yes: true,
        command: "echo updated",
        profiles: [],
        cacheStore,
      }),
    ).rejects.toThrow("already exists");
  });

  test("runInit rejects when nothing can be inferred and no command is provided", async () => {
    const projectRoot = await createTempDir("run-cli-init-empty-");
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await expect(
      runInit({
        cwd: projectRoot,
        useCache: true,
        force: false,
        yes: true,
        profiles: [],
        cacheStore,
      }),
    ).rejects.toThrow("No command could be inferred");
  });

  test("runResolvedProfile propagates shell exit codes", async () => {
    const exitCode = await runResolvedProfile(testProfile("exit 3"), testGlobalConfig(), {
      dryRun: false,
    });

    expect(exitCode).toBe(3);
  });

  test("output helpers emit human-readable text", async () => {
    const result = await captureConsole(async () => {
      info(bold("run"));
      warn(yellow("careful"));
      console.error(red("problem"));
    });

    expect(result.stdout).toContain("run");
    expect(result.stderr).toContain("careful");
    expect(result.stderr).toContain("problem");
  });
});
