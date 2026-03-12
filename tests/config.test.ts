import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";

import { CacheStore } from "../src/cache.ts";
import { resolveProfile, resolveProjectConfig } from "../src/config.ts";
import { CONFIG_FILE_NAME } from "../src/constants.ts";
import { writeTextFile } from "../src/fs.ts";

async function createTempProject(): Promise<string> {
  return await Bun.$`mktemp -d ${path.join(os.tmpdir(), "run-cli-config-XXXXXX")}`
    .text()
    .then((value) => value.trim());
}

describe("config resolution", () => {
  test("finds the nearest ancestor config and resolves cwd from config directory", async () => {
    const projectRoot = await createTempProject();
    const nestedDir = path.join(projectRoot, "packages", "api");
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        'command = "bun run index.ts"',
        'cwd = "."',
        "",
        "[profiles.dev]",
        'command = "bun run dev.ts"',
      ].join("\n"),
    );
    await writeTextFile(path.join(nestedDir, "placeholder.txt"), "ready\n");

    const resolvedConfig = await resolveProjectConfig({
      cwd: nestedDir,
      useCache: true,
      cacheStore,
    });

    expect(resolvedConfig?.sourcePath).toBe(path.join(projectRoot, CONFIG_FILE_NAME));
    if (!resolvedConfig) {
      throw new Error("Expected a resolved config.");
    }

    const profile = resolveProfile(resolvedConfig, "dev");
    expect(profile.command).toBe("bun run dev.ts");
    expect(profile.cwd).toBe(projectRoot);
  });

  test("errors when an explicit profile is missing", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo hello"'].join("\n"),
    );

    const resolvedConfig = await resolveProjectConfig({
      cwd: projectRoot,
      useCache: true,
      cacheStore,
    });

    if (!resolvedConfig) {
      throw new Error("Expected a resolved config.");
    }

    expect(() => resolveProfile(resolvedConfig, "dev")).toThrow('Profile "dev" is not defined');
  });
});
