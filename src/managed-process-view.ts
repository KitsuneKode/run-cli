import { formatDuration, formatMemory } from "./process-metrics.ts";
import type { ManagedProcessSnapshot } from "./types.ts";

function padRows(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );

  const renderRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");

  return [renderRow(headers), ...rows.map(renderRow)].join("\n");
}

export function renderManagedProcessList(processes: ManagedProcessSnapshot[]): string {
  if (processes.length === 0) {
    return "No managed processes.\n";
  }

  const headers = ["NAME", "PROFILE", "STATUS", "PID", "UPTIME", "MEM", "PORTS", "PROJECT"];
  const rows = processes.map((processRecord) => [
    processRecord.name,
    processRecord.profile,
    processRecord.status,
    String(processRecord.pid),
    formatDuration(processRecord.uptimeMs),
    formatMemory(processRecord.memoryRssKb),
    processRecord.ports.length > 0 ? processRecord.ports.join(",") : "-",
    processRecord.projectName,
  ]);

  return `${padRows(headers, rows)}\n`;
}

export function renderManagedDashboard(processes: ManagedProcessSnapshot[]): string {
  const runningCount = processes.filter(
    (processRecord) => processRecord.status === "running",
  ).length;
  const stoppedCount = processes.filter(
    (processRecord) => processRecord.status !== "running",
  ).length;
  const totalMemory = processes.reduce(
    (sum, processRecord) => sum + (processRecord.memoryRssKb ?? 0),
    0,
  );
  const uniquePorts = new Set(processes.flatMap((processRecord) => processRecord.ports));

  return [
    "run dashboard",
    `running=${runningCount} stopped=${stoppedCount} total=${processes.length} memory=${formatMemory(totalMemory)} ports=${uniquePorts.size}`,
    "",
    renderManagedProcessList(processes).trimEnd(),
    "",
    "Manage with: run inspect <name>, run logs <name>, run stop <name>, run restart <name>, run kill <name>",
    "",
  ].join("\n");
}

export function renderManagedProcessDetails(processRecord: ManagedProcessSnapshot): string {
  return [
    `name: ${processRecord.name}`,
    `project: ${processRecord.projectName}`,
    `profile: ${processRecord.profile}`,
    `status: ${processRecord.status}`,
    `pid: ${processRecord.pid}`,
    `uptime: ${formatDuration(processRecord.uptimeMs)}`,
    `memory: ${formatMemory(processRecord.memoryRssKb)}`,
    `ports: ${processRecord.ports.length > 0 ? processRecord.ports.join(", ") : "-"}`,
    `command: ${processRecord.command}`,
    `cwd: ${processRecord.cwd}`,
    `project root: ${processRecord.projectRoot}`,
    `config: ${processRecord.configPath}`,
    `log: ${processRecord.logPath}`,
    `started: ${processRecord.startedAt}`,
    `updated: ${processRecord.updatedAt}`,
    `restarts: ${String(processRecord.restartCount)}`,
    "",
  ].join("\n");
}
