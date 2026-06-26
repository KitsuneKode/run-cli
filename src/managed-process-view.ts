import { cyan, dim, green, red, stripAnsi, yellow } from "./output.ts";
import { formatDuration, formatMemory } from "./process-metrics.ts";
import type { ManagedProcessSnapshot } from "./types.ts";

function padRows(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(stripAnsi(header).length, ...rows.map((row) => stripAnsi(row[index] ?? "").length)),
  );

  const renderRow = (row: string[]) =>
    row
      .map((cell, index) => {
        const visibleLength = stripAnsi(cell).length;
        const targetWidth = widths[index] ?? visibleLength;
        const padding = targetWidth - visibleLength;
        return cell + " ".repeat(Math.max(0, padding));
      })
      .join("  ");

  return [renderRow(headers), ...rows.map(renderRow)].join("\n");
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return green(status);
    case "stopped":
      return yellow(status);
    case "exited":
      return red(status);
    default:
      return dim(status);
  }
}

function memoryLabel(
  memoryRssKb: number | null,
  thresholdWarn = 512 * 1024,
  thresholdCritical = 1024 * 1024,
): string {
  if (memoryRssKb === null) {
    return dim("-");
  }

  const formatted = formatMemory(memoryRssKb);

  if (memoryRssKb >= thresholdCritical) {
    return red(formatted);
  }

  if (memoryRssKb >= thresholdWarn) {
    return yellow(formatted);
  }

  return formatted;
}

export function renderManagedProcessList(
  processes: ManagedProcessSnapshot[],
  options?: {
    showPorts?: boolean;
  },
): string {
  if (processes.length === 0) {
    return dim("No managed processes.\n");
  }

  const showPorts = options?.showPorts ?? false;
  const rawHeaders = showPorts
    ? ["NAME", "PROFILE", "STATUS", "PID", "UPTIME", "MEM", "PORTS", "PROJECT"]
    : ["NAME", "PROFILE", "STATUS", "PID", "UPTIME", "MEM", "PROJECT"];
  const headers = rawHeaders.map((h) => dim(h));
  const rows = processes.map((processRecord) =>
    showPorts
      ? [
          processRecord.name,
          processRecord.profile,
          statusLabel(processRecord.status),
          String(processRecord.pid),
          formatDuration(processRecord.uptimeMs),
          memoryLabel(processRecord.memoryRssKb),
          processRecord.ports.length > 0 ? cyan(processRecord.ports.join(",")) : dim("-"),
          processRecord.projectName,
        ]
      : [
          processRecord.name,
          processRecord.profile,
          statusLabel(processRecord.status),
          String(processRecord.pid),
          formatDuration(processRecord.uptimeMs),
          memoryLabel(processRecord.memoryRssKb),
          processRecord.projectName,
        ],
  );

  return `${padRows(headers, rows)}\n`;
}

export function renderManagedDashboard(processes: ManagedProcessSnapshot[]): string {
  const runningCount = processes.filter(
    (processRecord) => processRecord.status === "running",
  ).length;
  const stoppedCount = processes.filter(
    (processRecord) => processRecord.status !== "running",
  ).length;
  const totalMemoryKb = processes.reduce((sum, p) => sum + (p.memoryRssKb ?? 0), 0);

  return [
    "run dashboard",
    `${green(String(runningCount))} running  ${yellow(String(stoppedCount))} stopped  ${dim("total=")}${processes.length}  ${dim("mem=")}${totalMemoryKb > 0 ? formatMemory(totalMemoryKb) : "-"}`,
    "",
    renderManagedProcessList(processes, { showPorts: false }).trimEnd(),
    "",
    dim(
      "Next: run inspect <name> | run logs <name> --follow | run ports | run stop <name> | run restart <name>",
    ),
    "",
  ].join("\n");
}

export function renderManagedProcessDetails(processRecord: ManagedProcessSnapshot): string {
  return [
    `name: ${processRecord.name}`,
    `project: ${processRecord.projectName}`,
    `profile: ${processRecord.profile}`,
    `status: ${statusLabel(processRecord.status)}`,
    `pid: ${processRecord.pid}`,
    `uptime: ${formatDuration(processRecord.uptimeMs)}`,
    `memory: ${memoryLabel(processRecord.memoryRssKb)}`,
    `ports: ${processRecord.ports.length > 0 ? cyan(processRecord.ports.join(", ")) : dim("-")}`,
    `args: ${processRecord.commandArgs.length > 0 ? processRecord.commandArgs.join(" ") : dim("-")}`,
    `base command: ${processRecord.baseCommand}`,
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
