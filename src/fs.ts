import { statSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(targetPath: string): Promise<boolean> {
  if (typeof Bun !== "undefined" && typeof Bun.file === "function") {
    return await Bun.file(targetPath).exists();
  }
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(targetPath: string): Promise<string> {
  if (typeof Bun !== "undefined" && typeof Bun.file === "function") {
    return await Bun.file(targetPath).text();
  }
  return await readFile(targetPath, "utf8");
}

export async function writeTextFile(targetPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (typeof Bun !== "undefined" && typeof Bun.write === "function") {
    await Bun.write(targetPath, content);
    return;
  }
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
  if (typeof Bun !== "undefined" && typeof Bun.file === "function") {
    const file = Bun.file(targetPath);
    if (!(await file.exists())) {
      return null;
    }
    const mtime = file.lastModified;
    if (mtime === 0 || Number.isNaN(mtime)) {
      return null;
    }
    return `${mtime}:${file.size}`;
  }
  try {
    const stats = statSync(targetPath);
    const mtime = stats.mtimeMs;
    if (mtime === 0 || Number.isNaN(mtime)) {
      return null;
    }
    return `${mtime}:${stats.size}`;
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

export function sleep(ms: number): Promise<void> {
  if (typeof Bun !== "undefined" && typeof Bun.sleep === "function") {
    return Bun.sleep(ms);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseToml(text: string): Record<string, unknown> {
  if (typeof Bun !== "undefined" && Bun.TOML && typeof Bun.TOML.parse === "function") {
    return Bun.TOML.parse(text) as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  let currentSection: string[] = [];

  let i = 0;
  const len = text.length;

  function skipWhitespace() {
    while (i < len && (text[i] === " " || text[i] === "\t")) {
      i++;
    }
  }

  function skipWhitespaceAndNewline() {
    while (
      i < len &&
      (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")
    ) {
      i++;
    }
  }

  function readLineComment() {
    if (text[i] === "#") {
      while (i < len && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
    }
  }

  function parseString(quoteChar: string, isTriple: boolean): string {
    let str = "";
    const quoteLen = isTriple ? 3 : 1;
    i += quoteLen; // skip opening quote

    while (i < len) {
      if (isTriple) {
        if (text.startsWith(quoteChar.repeat(3), i)) {
          i += 3;
          return str;
        }
      } else {
        if (text[i] === quoteChar) {
          i++;
          return str;
        }
      }

      const char = text[i];
      if (char === "\\") {
        i++;
        if (i >= len) throw new Error("Unterminated string escape");
        const escapeChar = text[i];
        if (escapeChar === "n") str += "\n";
        else if (escapeChar === "r") str += "\r";
        else if (escapeChar === "t") str += "\t";
        else if (escapeChar === '"') str += '"';
        else if (escapeChar === "'") str += "'";
        else if (escapeChar === "\\") str += "\\";
        else str += escapeChar;
      } else {
        str += char;
      }
      i++;
    }

    throw new Error("Unterminated string");
  }

  function parseArray(): unknown[] {
    i++; // skip '['
    const arr: unknown[] = [];
    while (i < len) {
      skipWhitespaceAndNewline();
      readLineComment();
      skipWhitespaceAndNewline();

      if (i >= len) {
        throw new Error("Unterminated array");
      }

      if (text[i] === "]") {
        i++;
        return arr;
      }

      const val = parseValue();
      arr.push(val);

      skipWhitespaceAndNewline();
      readLineComment();
      skipWhitespaceAndNewline();

      if (text[i] === ",") {
        i++;
      } else if (text[i] === "]") {
        i++;
        return arr;
      } else if (i < len) {
        throw new Error(`Expected ',' or ']' in array, got: ${text[i]}`);
      }
    }
    throw new Error("Unterminated array");
  }

  function parseValue(): unknown {
    skipWhitespace();
    if (i >= len) {
      throw new Error("Expected value");
    }

    const char = text[i];
    if (char === '"' || char === "'") {
      const isTriple = text.startsWith(char.repeat(3), i);
      return parseString(char, isTriple);
    }

    if (char === "[") {
      return parseArray();
    }

    // Read until end of value
    let valStr = "";
    while (i < len) {
      const c = text[i];
      if (
        c === "\n" ||
        c === "\r" ||
        c === "," ||
        c === "]" ||
        c === "}" ||
        c === "#" ||
        c === " " ||
        c === "\t"
      ) {
        break;
      }
      valStr += c;
      i++;
    }

    if (valStr === "true") return true;
    if (valStr === "false") return false;
    if (valStr === "null") return null;

    const num = Number(valStr);
    if (!Number.isNaN(num)) {
      return num;
    }

    return valStr;
  }

  while (i < len) {
    skipWhitespaceAndNewline();
    if (i >= len) break;

    if (text[i] === "#") {
      readLineComment();
      continue;
    }

    if (text[i] === "[") {
      i++; // skip '['
      let sectionName = "";
      while (i < len && text[i] !== "]") {
        if (text[i] === "\n" || text[i] === "\r") {
          throw new Error("Unterminated section header");
        }
        sectionName += text[i];
        i++;
      }
      if (i >= len) {
        throw new Error("Unterminated section header");
      }
      i++; // skip ']'
      currentSection = sectionName
        .trim()
        .split(".")
        .map((s) => s.trim());
      continue;
    }

    // Key-value pair
    let key = "";
    while (i < len && text[i] !== "=") {
      if (text[i] === "\n" || text[i] === "\r") {
        throw new Error(`Invalid line without '=': ${key}`);
      }
      key += text[i];
      i++;
    }
    if (i >= len) {
      throw new Error(`Expected '=' after key: ${key}`);
    }
    i++; // skip '='

    key = key.trim();
    const value = parseValue();

    let target = result;
    for (let j = 0; j < currentSection.length; j++) {
      const sectionKey = currentSection[j];
      if (sectionKey === undefined) {
        continue;
      }
      if (target[sectionKey] === undefined) {
        target[sectionKey] = {};
      }
      target = target[sectionKey] as Record<string, unknown>;
    }
    target[key] = value;
  }

  return result;
}
