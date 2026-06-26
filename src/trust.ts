/**
 * Trust store for run-cli's shell hook security model.
 *
 * Before the shell hook registers profile shortcut functions for a project,
 * the user must explicitly grant trust for that project's .run.toml. Trust is
 * keyed on the absolute path of the config file AND its SHA-256 digest, so
 * that changes to the file invalidate trust automatically.
 *
 * Storage: $XDG_STATE_HOME/run/trusted-configs.json (atomic writes)
 * Hash algorithm: SHA-256 of raw file bytes (via Node crypto)
 */

import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TRUST_REGISTRY_VERSION } from "./constants.ts";
import { getTrustRegistryPath } from "./env-paths.ts";
import { walkUpDirectories } from "./fs.ts";
import type { TrustEntry, TrustRegistry } from "./types.ts";

// ── Internal helpers ──────────────────────────────────────────────────────────

async function readTrustRegistry(): Promise<TrustRegistry> {
  const registryPath = getTrustRegistryPath();
  try {
    const raw = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(raw) as TrustRegistry;
    if (typeof parsed.version === "number" && typeof parsed.entries === "object") {
      return parsed;
    }
  } catch {
    // File doesn't exist or is malformed — start fresh
  }
  return { version: TRUST_REGISTRY_VERSION, entries: {} };
}

async function writeTrustRegistry(registry: TrustRegistry): Promise<void> {
  const registryPath = getTrustRegistryPath();
  const dir = path.dirname(registryPath);
  await mkdir(dir, { recursive: true });

  // Atomic write: temp file → rename (same pattern as process registry)
  const tmp = `${registryPath}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(registry, null, 2), "utf8");
    await rename(tmp, registryPath);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp);
    } catch {
      // Ignore cleanup failure
    }
    throw err;
  }
}

/**
 * Compute SHA-256 hex digest of a file's raw contents.
 * Returns null if the file cannot be read.
 */
export async function hashConfigFile(configPath: string): Promise<string | null> {
  try {
    const contents = await readFile(configPath);
    return crypto.createHash("sha256").update(contents).digest("hex");
  } catch {
    return null;
  }
}

// ── Config file resolution ────────────────────────────────────────────────────

/**
 * Walk upward from `startDir` to find the nearest .run.toml.
 * Returns the absolute path if found, or null.
 * Stops at the filesystem root and also stops at the home directory boundary
 * to avoid picking up unrelated global configs during shell hook resolution.
 */
export function findNearestConfig(startDir: string): string | null {
  const home = os.homedir();
  const dirs = walkUpDirectories(startDir);

  for (const dir of dirs) {
    const candidate = path.join(dir, ".run.toml");
    // We can't do async here (called from sync shell-hook context), but this
    // helper is used from async callers in trust.ts — they always await.
    // Use synchronous fs where needed; this function itself is sync-safe as a
    // path resolver; callers must await their own fs checks.
    if (dir === path.dirname(home) && dir !== startDir) {
      // Don't walk above the parent of home unless we started there
      break;
    }
    // Return the candidate path — callers verify existence asynchronously
    return candidate; // first candidate wins; callers check existence
  }
  return null;
}

/**
 * Walk upward from `startDir` and return the path of the nearest existing
 * .run.toml, or null if none is found.
 */
export async function findNearestExistingConfig(startDir: string): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  const home = os.homedir();
  const dirs = walkUpDirectories(startDir);

  for (const dir of dirs) {
    const candidate = path.join(dir, ".run.toml");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Not found at this level — keep walking
    }
    // Stop one level above home to avoid picking up unrelated configs
    if (dir === home) {
      break;
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Grant trust for a config file. Computes the SHA-256 of the file and stores
 * it in the trust registry. If the file has changed since a previous trust
 * grant, the stored hash is updated.
 *
 * @param configPath Absolute path to the .run.toml to trust
 * @returns The TrustEntry that was stored
 * @throws If the config file cannot be read
 */
export async function trustConfig(configPath: string): Promise<TrustEntry> {
  const sha256 = await hashConfigFile(configPath);
  if (!sha256) {
    throw new Error(`Cannot read config file: ${configPath}`);
  }

  const registry = await readTrustRegistry();
  const entry: TrustEntry = {
    sha256,
    trustedAt: new Date().toISOString(),
  };
  registry.entries[configPath] = entry;
  await writeTrustRegistry(registry);
  return entry;
}

/**
 * Check whether a config file is currently trusted (path exists in registry
 * AND the stored SHA-256 matches the current file contents).
 *
 * @returns true if trusted, false if not found or hash mismatch
 */
export async function isConfigTrusted(configPath: string): Promise<boolean> {
  const registry = await readTrustRegistry();
  const entry = registry.entries[configPath];
  if (!entry) return false;

  const currentHash = await hashConfigFile(configPath);
  if (!currentHash) return false;

  return entry.sha256 === currentHash;
}

/**
 * Revoke trust for a specific config file. No-op if the file was not trusted.
 *
 * @param configPath Absolute path to the .run.toml to revoke
 * @returns true if an entry was removed, false if nothing was found
 */
export async function revokeConfigTrust(configPath: string): Promise<boolean> {
  const registry = await readTrustRegistry();
  if (!registry.entries[configPath]) return false;

  delete registry.entries[configPath];
  await writeTrustRegistry(registry);
  return true;
}

/**
 * List all entries in the trust registry.
 * Entries may refer to files that no longer exist on disk.
 */
export async function listTrustedConfigs(): Promise<Array<{ configPath: string } & TrustEntry>> {
  const registry = await readTrustRegistry();
  return Object.entries(registry.entries).map(([configPath, entry]) => ({
    configPath,
    ...entry,
  }));
}

/**
 * Prune entries from the trust registry whose config files no longer exist on
 * disk or whose hashes no longer match. Returns the paths that were removed.
 */
export async function pruneStaleEntries(): Promise<string[]> {
  const { access } = await import("node:fs/promises");
  const registry = await readTrustRegistry();
  const removed: string[] = [];

  for (const [configPath, entry] of Object.entries(registry.entries)) {
    let stale = false;

    try {
      await access(configPath);
      const currentHash = await hashConfigFile(configPath);
      if (currentHash !== entry.sha256) {
        stale = true; // File changed
      }
    } catch {
      stale = true; // File gone
    }

    if (stale) {
      delete registry.entries[configPath];
      removed.push(configPath);
    }
  }

  if (removed.length > 0) {
    await writeTrustRegistry(registry);
  }

  return removed;
}
