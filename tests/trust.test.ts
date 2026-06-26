import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  hashConfigFile,
  isConfigTrusted,
  listTrustedConfigs,
  revokeConfigTrust,
  trustConfig,
} from "../src/trust.ts";

// Override XDG_STATE_HOME to a temp dir so tests don't pollute real state
let tmpDir: string;
let originalXdgStateHome: string | undefined;

beforeEach(async () => {
  tmpDir = await createTempDir();
  originalXdgStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = tmpDir;
});

afterEach(async () => {
  if (originalXdgStateHome !== undefined) {
    process.env.XDG_STATE_HOME = originalXdgStateHome;
  } else {
    process.env.XDG_STATE_HOME = undefined;
  }
  await cleanup(tmpDir);
});

async function createTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `run-trust-test-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
}

async function writeConfig(
  dir: string,
  content = 'version = 1\ncommand = "echo hi"',
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const configPath = path.join(dir, ".run.toml");
  await writeFile(configPath, content, "utf8");
  return configPath;
}

describe("trust store", () => {
  describe("hashConfigFile", () => {
    it("computes a stable SHA-256 for a given file", async () => {
      const configDir = path.join(tmpDir, "project-hash");
      const configPath = await writeConfig(configDir, "version = 1");

      const hash = await hashConfigFile(configPath);
      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64); // SHA-256 hex = 64 chars

      // Same content → same hash
      const hash2 = await hashConfigFile(configPath);
      expect(hash2).toBe(hash);
    });

    it("produces different hashes for different content", async () => {
      const configDir = path.join(tmpDir, "project-diff");
      await mkdir(configDir, { recursive: true });
      const configPath = path.join(configDir, ".run.toml");

      await writeFile(configPath, "version = 1", "utf8");
      const hash1 = await hashConfigFile(configPath);

      await writeFile(configPath, 'version = 1\ncommand = "bun dev"', "utf8");
      const hash2 = await hashConfigFile(configPath);

      expect(hash1).not.toBe(hash2);
    });

    it("returns null for a non-existent file", async () => {
      const hash = await hashConfigFile(path.join(tmpDir, "nonexistent.toml"));
      expect(hash).toBeNull();
    });

    it("hash matches Node crypto SHA-256", async () => {
      const configDir = path.join(tmpDir, "project-verify");
      const content = 'version = 1\ncommand = "bun dev"';
      const configPath = await writeConfig(configDir, content);

      const expected = crypto.createHash("sha256").update(Buffer.from(content)).digest("hex");
      const actual = await hashConfigFile(configPath);
      expect(actual).toBe(expected);
    });
  });

  describe("trustConfig", () => {
    it("trusts a config and stores a sha256 entry", async () => {
      const configDir = path.join(tmpDir, "project-trust");
      const configPath = await writeConfig(configDir);

      const entry = await trustConfig(configPath);
      expect(entry.sha256).toHaveLength(64);
      expect(entry.trustedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("throws if config file does not exist", async () => {
      await expect(trustConfig(path.join(tmpDir, "missing", ".run.toml"))).rejects.toThrow(
        "Cannot read config file",
      );
    });

    it("updates trust when file content changes", async () => {
      const configDir = path.join(tmpDir, "project-update");
      const configPath = await writeConfig(configDir, "version = 1");
      const entry1 = await trustConfig(configPath);

      await writeFile(configPath, 'version = 1\ncommand = "bun dev"', "utf8");
      const entry2 = await trustConfig(configPath);

      expect(entry2.sha256).not.toBe(entry1.sha256);
    });
  });

  describe("isConfigTrusted", () => {
    it("returns true when config is trusted and unchanged", async () => {
      const configDir = path.join(tmpDir, "project-check-ok");
      const configPath = await writeConfig(configDir);

      await trustConfig(configPath);
      const trusted = await isConfigTrusted(configPath);
      expect(trusted).toBe(true);
    });

    it("returns false when config was never trusted", async () => {
      const configDir = path.join(tmpDir, "project-check-new");
      const configPath = await writeConfig(configDir);

      const trusted = await isConfigTrusted(configPath);
      expect(trusted).toBe(false);
    });

    it("returns false when config is trusted but then modified", async () => {
      const configDir = path.join(tmpDir, "project-check-modified");
      const configPath = await writeConfig(configDir, "version = 1");
      await trustConfig(configPath);

      // Modify the file after trust was granted
      await writeFile(configPath, 'version = 1\ncommand = "evil"\n', "utf8");

      const trusted = await isConfigTrusted(configPath);
      expect(trusted).toBe(false);
    });

    it("returns false when config file is missing", async () => {
      const trusted = await isConfigTrusted(path.join(tmpDir, "ghost.toml"));
      expect(trusted).toBe(false);
    });
  });

  describe("revokeConfigTrust", () => {
    it("removes trust and returns true", async () => {
      const configDir = path.join(tmpDir, "project-revoke");
      const configPath = await writeConfig(configDir);
      await trustConfig(configPath);

      const removed = await revokeConfigTrust(configPath);
      expect(removed).toBe(true);

      const trusted = await isConfigTrusted(configPath);
      expect(trusted).toBe(false);
    });

    it("returns false when config was not trusted", async () => {
      const removed = await revokeConfigTrust(path.join(tmpDir, "nope.toml"));
      expect(removed).toBe(false);
    });
  });

  describe("listTrustedConfigs", () => {
    it("returns all trusted entries", async () => {
      const configA = await writeConfig(path.join(tmpDir, "project-a"));
      const configB = await writeConfig(path.join(tmpDir, "project-b"));

      await trustConfig(configA);
      await trustConfig(configB);

      const entries = await listTrustedConfigs();
      const paths = entries.map((e) => e.configPath);
      expect(paths).toContain(configA);
      expect(paths).toContain(configB);
    });

    it("returns empty array when no configs are trusted", async () => {
      const entries = await listTrustedConfigs();
      expect(entries).toEqual([]);
    });

    it("entries include sha256 and trustedAt", async () => {
      const configDir = path.join(tmpDir, "project-list");
      const configPath = await writeConfig(configDir);
      await trustConfig(configPath);

      const entries = await listTrustedConfigs();
      expect(entries).toHaveLength(1);
      if (!entries[0]) throw new Error("expected an entry");
      const entry = entries[0];
      expect(entry.sha256).toHaveLength(64);
      expect(entry.trustedAt).toBeTruthy();
      expect(entry.configPath).toBe(configPath);
    });
  });

  describe("trust store persistence", () => {
    it("persists across separate reads", async () => {
      const configDir = path.join(tmpDir, "project-persist");
      const configPath = await writeConfig(configDir);
      await trustConfig(configPath);

      // Check trust in a fresh read (trust module re-reads the file)
      const trusted = await isConfigTrusted(configPath);
      expect(trusted).toBe(true);

      // After revoking, fresh read should return false
      await revokeConfigTrust(configPath);
      const trustedAfterRevoke = await isConfigTrusted(configPath);
      expect(trustedAfterRevoke).toBe(false);
    });
  });
});
