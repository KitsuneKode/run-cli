import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";

import { CacheStore } from "../src/cache.ts";
import { listShortcutNames, resolveProfile, resolveProjectConfig } from "../src/config.ts";
import { CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME } from "../src/constants.ts";
import { parseToml, writeTextFile } from "../src/fs.ts";

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

  test("resolves a profile by its configured alias", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      [
        "version = 1",
        "",
        "[profiles.dev]",
        'command = "bun run dev.ts"',
        'alias = "d"',
        "",
        "[profiles.build]",
        'command = "bun run build.ts"',
        'alias = ["b", "production"]',
      ].join("\n"),
    );

    const resolvedConfig = await resolveProjectConfig({
      cwd: projectRoot,
      useCache: true,
      cacheStore,
    });

    if (!resolvedConfig) {
      throw new Error("Expected a resolved config.");
    }

    const devProfile = resolveProfile(resolvedConfig, "d");
    expect(devProfile.name).toBe("dev");
    expect(devProfile.command).toBe("bun run dev.ts");

    const buildProfile = resolveProfile(resolvedConfig, "b");
    expect(buildProfile.name).toBe("build");
    expect(buildProfile.command).toBe("bun run build.ts");

    const prodProfile = resolveProfile(resolvedConfig, "production");
    expect(prodProfile.name).toBe("build");
    expect(prodProfile.command).toBe("bun run build.ts");
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

  test("resolves legacy config when current config is absent", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, LEGACY_CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo legacy"'].join("\n"),
    );

    const resolvedConfig = await resolveProjectConfig({
      cwd: projectRoot,
      useCache: true,
      cacheStore,
    });

    expect(resolvedConfig?.sourcePath).toBe(path.join(projectRoot, LEGACY_CONFIG_FILE_NAME));
    expect(resolvedConfig?.isLegacyPath).toBe(true);
  });

  test("prefers a newly added nearer config even after a cached ancestor lookup", async () => {
    const projectRoot = await createTempProject();
    const nestedDir = path.join(projectRoot, "apps", "web", "src");
    const nearerDir = path.join(projectRoot, "apps", "web");
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo root"'].join("\n"),
    );
    await writeTextFile(path.join(nestedDir, "placeholder.txt"), "ok\n");

    const firstResolved = await resolveProjectConfig({
      cwd: nestedDir,
      useCache: true,
      cacheStore,
    });
    expect(firstResolved?.sourcePath).toBe(path.join(projectRoot, CONFIG_FILE_NAME));

    await writeTextFile(
      path.join(nearerDir, CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo nearer"'].join("\n"),
    );

    const secondResolved = await resolveProjectConfig({
      cwd: nestedDir,
      useCache: true,
      cacheStore,
    });

    expect(secondResolved?.sourcePath).toBe(path.join(nearerDir, CONFIG_FILE_NAME));
  });

  test("errors on unknown configuration keys", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", 'command = "echo hello"', "unknown_field = 42"].join("\n"),
    );

    await expect(
      resolveProjectConfig({
        cwd: projectRoot,
        useCache: true,
        cacheStore,
      }),
    ).rejects.toThrow("contains unknown configuration key");
  });

  test("errors on unknown profile keys", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, CONFIG_FILE_NAME),
      ["version = 1", "", "[profiles.dev]", 'command = "echo dev"', "typo_field = true"].join("\n"),
    );

    await expect(
      resolveProjectConfig({
        cwd: projectRoot,
        useCache: true,
        cacheStore,
      }),
    ).rejects.toThrow("contains unknown profile key");
  });
});

describe("listShortcutNames", () => {
  test("generates run<name> and run-<name> for each profile", () => {
    const config = {
      version: 1,
      profiles: {
        dev: { command: "bun dev" },
        build: { command: "bun build" },
      },
    };
    const names = listShortcutNames(config);
    expect(names).toContain("rundev");
    expect(names).toContain("run-dev");
    expect(names).toContain("runbuild");
    expect(names).toContain("run-build");
  });

  test("generates names from declared aliases", () => {
    const config = {
      version: 1,
      profiles: {
        dev: { command: "bun dev", alias: "d" },
        build: { command: "bun build", alias: ["b", "prod"] },
      },
    };
    const names = listShortcutNames(config);
    expect(names).toContain("rund");
    expect(names).toContain("run-d");
    expect(names).toContain("runb");
    expect(names).toContain("run-b");
    expect(names).toContain("runprod");
    expect(names).toContain("run-prod");
  });

  test("skips the 'default' profile name to avoid a generic 'rundefault' command", () => {
    const config = {
      version: 1,
      profiles: {
        default: { command: "bun dev" },
        worker: { command: "bun worker" },
      },
    };
    const names = listShortcutNames(config);
    expect(names).not.toContain("rundefault");
    expect(names).not.toContain("run-default");
    expect(names).toContain("runworker");
    expect(names).toContain("run-worker");
  });

  test("skips profiles without a command", () => {
    const config = {
      version: 1,
      profiles: {
        dev: { command: "bun dev" },
        incomplete: {},
      },
    };
    const names = listShortcutNames(config);
    expect(names).toContain("rundev");
    expect(names).not.toContain("runincomplete");
  });

  test("filters out suffixes that collide with reserved commands", () => {
    // A profile named 'up' should not produce 'runup' and 'run-up' since
    // 'up' is a reserved command name as a suffix
    const config = {
      version: 1,
      profiles: {
        myapp: { command: "bun dev", alias: "ps" }, // 'ps' is reserved
      },
    };
    const names = listShortcutNames(config);
    // myapp itself is fine
    expect(names).toContain("runmyapp");
    expect(names).toContain("run-myapp");
    // 'ps' alias is a reserved command — should be filtered
    expect(names).not.toContain("runps");
    expect(names).not.toContain("run-ps");
  });

  test("returns sorted, deduplicated names", () => {
    const config = {
      version: 1,
      profiles: {
        dev: { command: "bun dev", alias: "dev" }, // alias = profile name = same suffix
      },
    };
    const names = listShortcutNames(config);
    const devNames = names.filter((n) => n.includes("dev"));
    // Should be exactly rundev and run-dev, not doubled
    expect(devNames).toEqual(["run-dev", "rundev"]);
  });

  test("returns empty array when no profiles are defined", () => {
    const config = { version: 1 };
    const names = listShortcutNames(config);
    expect(names).toEqual([]);
  });

  test("rejects invalid suffix characters", () => {
    // Profile names with invalid chars should not produce shortcut names
    const config = {
      version: 1,
      profiles: {
        "my app": { command: "bun dev" }, // space is invalid
      },
    };
    // 'my app' has a space, fails SHORTCUT_SUFFIX_RE
    const names = listShortcutNames(config);
    expect(names.some((n) => n.includes(" "))).toBe(false);
  });
});

describe("parseToml", () => {
  test("parses flat keys and values", () => {
    const toml = `
      version = 1
      default_profile = "dev"
      enabled = true
      disabled = false
    `;
    const parsed = parseToml(toml);
    expect(parsed).toEqual({
      version: 1,
      default_profile: "dev",
      enabled: true,
      disabled: false,
    });
  });

  test("parses tables and nested structures", () => {
    const toml = `
      version = 1

      [env]
      PORT = 3000
      HOST = "localhost"

      [profiles.dev]
      command = "bun run dev"
      cwd = "."

      [profiles.dev.env]
      NODE_ENV = "development"
    `;
    const parsed = parseToml(toml);
    expect(parsed).toEqual({
      version: 1,
      env: {
        PORT: 3000,
        HOST: "localhost",
      },
      profiles: {
        dev: {
          command: "bun run dev",
          cwd: ".",
          env: {
            NODE_ENV: "development",
          },
        },
      },
    });
  });

  test("handles single and double quotes, escapes, and arrays", () => {
    const toml = `
      version = 1
      name = 'single-quoted'
      description = "double-quoted with \\"quotes\\" and \\\\ backslash"
      aliases = ["d", 'dev', "development"]
      empty_arr = []
    `;
    const parsed = parseToml(toml);
    expect(parsed).toEqual({
      version: 1,
      name: "single-quoted",
      description: 'double-quoted with "quotes" and \\ backslash',
      aliases: ["d", "dev", "development"],
      empty_arr: [],
    });
  });

  test("handles inline and block comments", () => {
    const toml = `
      # Block comment
      version = 1 # Inline comment with number
      command = "echo #not-a-comment" # Inline comment after string
      [profiles.dev] # Section comment
      # Another block comment
      command = 'bun dev #also-not-a-comment'
    `;
    const parsed = parseToml(toml);
    expect(parsed).toEqual({
      version: 1,
      command: "echo #not-a-comment",
      profiles: {
        dev: {
          command: "bun dev #also-not-a-comment",
        },
      },
    });
  });

  test("handles multiline/triple-quoted strings", () => {
    const toml = `
      version = 1
      multi_double = """
line 1
line 2
"""
      multi_single = '''
line 3
line 4
'''
    `;
    const parsed = parseToml(toml);
    expect(parsed.multi_double).toContain("line 1");
    expect(parsed.multi_double).toContain("line 2");
    expect(parsed.multi_single).toContain("line 3");
    expect(parsed.multi_single).toContain("line 4");
  });
});
