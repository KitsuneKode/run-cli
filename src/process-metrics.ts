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

export interface BatchMetrics {
  rssKb: number | null;
  startTime: string | null;
}

export function getBatchMetrics(pids: number[]): Map<number, BatchMetrics> {
  const results = new Map<number, BatchMetrics>();

  if (pids.length === 0) {
    return results;
  }

  const result = spawnSync("ps", ["-o", "pid=,rss=,lstart=", "-p", pids.join(",")], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return results;
  }

  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    // Format: "  PID   RSS  STARTED" e.g. "12345 8192 Thu Mar 15 14:10:00 2026"
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);

    if (match) {
      const pid = Number.parseInt(match[1], 10);
      const rssKb = Number.parseInt(match[2], 10);
      results.set(pid, {
        rssKb: Number.isFinite(rssKb) ? rssKb : null,
        startTime: match[3].trim(),
      });
    }
  }

  return results;
}

export function getBatchPorts(pids: number[]): Map<number, number[]> {
  const results = new Map<number, number[]>();

  if (pids.length === 0) {
    return results;
  }

  const result = spawnSync("lsof", ["-Pan", "-p", pids.join(","), "-iTCP", "-sTCP:LISTEN"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return results;
  }

  for (const line of result.stdout.split("\n").slice(1)) {
    // lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const columns = line.trim().split(/\s+/);

    if (columns.length < 2) {
      continue;
    }

    const pid = Number.parseInt(columns[1], 10);
    const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/);

    if (portMatch?.[1]) {
      const port = Number.parseInt(portMatch[1], 10);
      const existing = results.get(pid) ?? [];
      if (!existing.includes(port)) {
        existing.push(port);
      }
      results.set(pid, existing);
    }
  }

  // Sort ports for each PID
  for (const [pid, ports] of results) {
    results.set(
      pid,
      ports.sort((a, b) => a - b),
    );
  }

  return results;
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
