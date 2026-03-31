import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempDir(prefix = "run-cli-"): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previousEntries = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previousEntries)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function captureConsole(
  callback: () => Promise<void>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdoutMessages: string[] = [];
  const stderrMessages: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";

  console.log = (...args: unknown[]) => {
    stdoutMessages.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    stderrMessages.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderrMessages.push(args.map(String).join(" "));
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutMessages.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrMessages.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.exitCode = 0;

  try {
    await callback();
    const exitCode = process.exitCode ?? 0;
    return {
      stdout: stdoutMessages.join("\n"),
      stderr: stderrMessages.join("\n"),
      exitCode,
    };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.env.NO_COLOR = originalNoColor;
    process.exitCode = 0;
  }
}
