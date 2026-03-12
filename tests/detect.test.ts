import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";

import { CacheStore } from "../src/cache.ts";
import { detectProject } from "../src/detect.ts";
import { writeTextFile } from "../src/fs.ts";

async function createTempProject(): Promise<string> {
  return await Bun.$`mktemp -d ${path.join(os.tmpdir(), "run-cli-detect-XXXXXX")}`
    .text()
    .then((value) => value.trim());
}

describe("project detection", () => {
  test("prefers package scripts and exposes a dev profile suggestion", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify(
        {
          packageManager: "bun@1.3.9",
          scripts: {
            start: "bun run src/index.ts",
            dev: "bun --hot src/index.ts",
          },
        },
        null,
        2,
      ),
    );
    await writeTextFile(path.join(projectRoot, "bun.lock"), "lock\n");

    const detected = await detectProject({
      cwd: projectRoot,
      useCache: true,
      cacheStore,
    });

    expect(detected?.root).toBe(projectRoot);
    expect(detected?.suggestions[0]?.command).toBe("bun run start");
    expect(detected?.suggestions[0]?.ecosystem).toBe("javascript");
    expect(
      detected?.suggestions.some((entry) => entry.kind === "profile" && entry.name === "dev"),
    ).toBe(true);
  });

  test("prefers uv for python projects when uv.lock is present", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(path.join(projectRoot, "main.py"), "print('hello')\n");
    await writeTextFile(path.join(projectRoot, "uv.lock"), "version = 1\n");
    await writeTextFile(
      path.join(projectRoot, "pyproject.toml"),
      ["[project]", 'name = "demo"', 'version = "0.1.0"'].join("\n"),
    );

    const detected = await detectProject({
      cwd: projectRoot,
      useCache: true,
      cacheStore,
    });

    expect(detected?.suggestions[0]?.command).toBe("uv run python main.py");
    expect(detected?.suggestions[0]?.ecosystem).toBe("python");
    expect(detected?.suggestions[0]?.confidence).toBe("high");
  });

  test("prefers a local .venv interpreter when present", async () => {
    const projectRoot = await createTempProject();
    const cacheStore = new CacheStore(path.join(projectRoot, ".cache", "run-cache.json"));

    await writeTextFile(path.join(projectRoot, "app.py"), "print('hello')\n");
    await writeTextFile(
      path.join(projectRoot, ".venv", "bin", "python"),
      "#!/usr/bin/env python\n",
    );

    const detected = await detectProject({
      cwd: projectRoot,
      useCache: true,
      cacheStore,
    });

    expect(detected?.suggestions[0]?.command).toBe(".venv/bin/python app.py");
    expect(detected?.suggestions[0]?.ecosystem).toBe("python");
  });
});
