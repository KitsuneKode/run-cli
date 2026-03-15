import { describe, expect, test } from "bun:test";
import path from "node:path";

import { parseArgs } from "../src/args.ts";
import { CacheStore } from "../src/cache.ts";
import { readGlobalConfig, renderGlobalConfig, renderProjectConfig } from "../src/config.ts";
import { renderDoctorReport } from "../src/doctor.ts";
import { getCacheFilePath, getGlobalConfigPath } from "../src/env-paths.ts";
import {
  listFiles,
  normalizeEnv,
  pathExists,
  statFingerprint,
  toPosixPath,
  walkUpDirectories,
  writeTextFile,
} from "../src/fs.ts";
import { runInit } from "../src/init.ts";
import { createTempDir, withEnv } from "./helpers.ts";

describe("support modules", () => {
  test("parses init flags and deprecated init profile specs", () => {
    const parsed = parseArgs([
      "init",
      "--cwd",
      "/tmp/project",
      "--command",
      "python main.py",
      "--profile",
      "dev=uv run python main.py",
      "--yes",
      "--force",
    ]);

    expect(parsed.positionals).toEqual(["init"]);
    expect(parsed.cwd).toBe("/tmp/project");
    expect(parsed.command).toBe("python main.py");
    expect(parsed.addProfiles).toEqual([
      {
        name: "dev",
        command: "uv run python main.py",
      },
    ]);
    expect(parsed.deprecatedInitProfileFlagUsed).toBe(true);
    expect(parsed.yes).toBe(true);
    expect(parsed.force).toBe(true);
  });

  test("parses run args, profile selection, verbose mode, and passthrough", () => {
    const parsed = parseArgs(["-p", "dev", "--verbose", "--", "--watch", "3000"]);

    expect(parsed.profileName).toBe("dev");
    expect(parsed.verbose).toBe(true);
    expect(parsed.commandArgs).toEqual(["--watch", "3000"]);
    expect(parsed.passthrough).toBe(true);
  });

  test("rejects malformed cli flags", () => {
    expect(() => parseArgs(["--cwd"])).toThrow("--cwd requires a value.");
    expect(() => parseArgs(["init", "--add-profile", "dev"])).toThrow(
      'Invalid profile "dev". Use --add-profile name=command.',
    );
  });

  test("computes config and cache paths from XDG env vars", async () => {
    const rootDir = await createTempDir("run-cli-env-");

    await withEnv(
      {
        XDG_CONFIG_HOME: path.join(rootDir, ".config-home"),
        XDG_CACHE_HOME: path.join(rootDir, ".cache-home"),
      },
      async () => {
        expect(getGlobalConfigPath()).toBe(
          path.join(rootDir, ".config-home", "run", "config.toml"),
        );
        expect(getCacheFilePath()).toBe(path.join(rootDir, ".cache-home", "run", "cache.json"));
      },
    );
  });

  test("covers filesystem helpers and environment normalization", async () => {
    const rootDir = await createTempDir("run-cli-fs-");
    const nestedFile = path.join(rootDir, "nested", "file.txt");

    await writeTextFile(nestedFile, "hello\n");

    expect(await pathExists(nestedFile)).toBe(true);
    expect(await listFiles(path.join(rootDir, "nested"))).toContain("file.txt");
    expect(await statFingerprint(nestedFile)).not.toBeNull();
    expect(walkUpDirectories(path.join(rootDir, "nested")).at(0)).toBe(
      path.join(rootDir, "nested"),
    );
    expect(normalizeEnv({ PORT: 3000, DEBUG: true })).toEqual({
      PORT: "3000",
      DEBUG: "true",
    });
    expect(toPosixPath(path.join("some", "nested", "path"))).toBe("some/nested/path");
  });

  test("renders and reads project and global config content", async () => {
    const rootDir = await createTempDir("run-cli-config-");
    const cacheStore = new CacheStore(path.join(rootDir, ".cache", "run-cache.json"));
    const projectConfigPath = path.join(rootDir, ".run.toml");

    await writeTextFile(
      projectConfigPath,
      renderProjectConfig({
        version: 1,
        command: "bun run index.ts",
        env: {
          PORT: 3000,
        },
        profiles: {
          dev: {
            command: "bun run dev.ts",
            env: {
              DEBUG: true,
            },
          },
        },
      }),
    );

    await withEnv(
      {
        XDG_CONFIG_HOME: path.join(rootDir, ".config-home"),
      },
      async () => {
        await writeTextFile(
          getGlobalConfigPath(),
          renderGlobalConfig({
            shell: "/bin/zsh",
            editor: "code -w",
            cache: false,
          }),
        );

        const globalConfig = await readGlobalConfig();
        const initResult = await runInit({
          cwd: path.join(rootDir, "service"),
          useCache: true,
          force: false,
          yes: true,
          command: "python main.py",
          profiles: [{ name: "dev", command: "uv run python main.py" }],
          cacheStore,
        });
        const doctorReport = renderDoctorReport({
          cwd: rootDir,
          globalConfig,
          projectConfig: null,
          detectedProject: null,
        });

        expect(globalConfig.shell).toBe("/bin/zsh");
        expect(globalConfig.editor).toBe("code -w");
        expect(globalConfig.cache).toBe(false);
        expect(initResult.config.profiles?.dev?.command).toBe("uv run python main.py");
        expect(doctorReport).toContain("global config:");
        expect(doctorReport).toContain("cache enabled: false");
      },
    );
  });
});
