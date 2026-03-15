import { spawnSync } from "node:child_process";

export function getProcessStartTime(pid: number): string | null {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const trimmed = result.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isProcessRunning(pid: number, expectedStartTime?: string): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  if (expectedStartTime) {
    const actualStartTime = getProcessStartTime(pid);

    if (actualStartTime && actualStartTime !== expectedStartTime) {
      return false;
    }
  }

  return true;
}

export function getProcessMemoryRssKb(pid: number): number | null {
  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const parsed = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getProcessPorts(pid: number): number[] {
  const result = spawnSync("lsof", ["-Pan", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return [];
  }

  const ports = new Set<number>();

  for (const line of result.stdout.split("\n").slice(1)) {
    const match = line.match(/:(\d+)\s+\(LISTEN\)/);

    if (match?.[1]) {
      ports.add(Number.parseInt(match[1], 10));
    }
  }

  return [...ports].sort((left, right) => left - right);
}

export function formatMemory(memoryRssKb: number | null): string {
  if (memoryRssKb === null) {
    return "-";
  }

  if (memoryRssKb >= 1024 * 1024) {
    return `${(memoryRssKb / (1024 * 1024)).toFixed(1)} GB`;
  }

  if (memoryRssKb >= 1024) {
    return `${(memoryRssKb / 1024).toFixed(1)} MB`;
  }

  return `${memoryRssKb} KB`;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
