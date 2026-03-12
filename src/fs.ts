import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(targetPath: string): Promise<string> {
  return await readFile(targetPath, "utf8");
}

export async function writeTextFile(targetPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

export function walkUpDirectories(startDir: string): string[] {
  const directories: string[] = [];
  let currentDir = path.resolve(startDir);

  while (true) {
    directories.push(currentDir);
    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return directories;
    }

    currentDir = parentDir;
  }
}

export async function statFingerprint(targetPath: string): Promise<string | null> {
  try {
    const details = await stat(targetPath);
    return `${details.mtimeMs}:${details.size}`;
  } catch {
    return null;
  }
}

export function normalizeEnv(
  input: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

export function toPosixPath(targetPath: string): string {
  return targetPath.split(path.sep).join(path.posix.sep);
}
