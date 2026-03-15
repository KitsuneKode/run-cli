import { CONFIG_FILE_NAME } from "./constants.ts";
import { FALLBACK_SHELL } from "./constants.ts";
import { getCacheFilePath, getGlobalConfigPath } from "./env-paths.ts";
import type { DetectedProject, GlobalConfig, ResolvedConfig } from "./types.ts";

export function doctorReportData(input: {
  cwd: string;
  globalConfig: GlobalConfig;
  projectConfig: ResolvedConfig | null;
  detectedProject: DetectedProject | null;
}) {
  return {
    cwd: input.cwd,
    configLookup: input.projectConfig
      ? {
          sourcePath: input.projectConfig.sourcePath,
          cacheHit: input.projectConfig.cacheHit,
          legacy: input.projectConfig.isLegacyPath,
        }
      : null,
    globalConfigPath: getGlobalConfigPath(),
    cacheFilePath: getCacheFilePath(),
    shell: input.globalConfig.shell ?? process.env.SHELL ?? FALLBACK_SHELL,
    cacheEnabled: input.globalConfig.cache,
    detectedProject: input.detectedProject
      ? {
          root: input.detectedProject.root,
          markers: input.detectedProject.markers,
          cacheHit: input.detectedProject.cacheHit,
          suggestions: input.detectedProject.suggestions,
        }
      : null,
  };
}

export function renderDoctorReport(input: {
  cwd: string;
  globalConfig: GlobalConfig;
  projectConfig: ResolvedConfig | null;
  detectedProject: DetectedProject | null;
}): string {
  const report = doctorReportData(input);
  const lines = [
    `cwd: ${report.cwd}`,
    `config lookup: ${
      report.configLookup
        ? `${report.configLookup.sourcePath}${report.configLookup.legacy ? " (legacy)" : ""}${report.configLookup.cacheHit ? " (cache hit)" : ""}`
        : `not found (${CONFIG_FILE_NAME})`
    }`,
    `global config: ${report.globalConfigPath}`,
    `cache file: ${report.cacheFilePath}`,
    `shell: ${report.shell}`,
    `cache enabled: ${String(report.cacheEnabled)}`,
  ];

  if (report.detectedProject) {
    lines.push(
      `detected root: ${report.detectedProject.root}${report.detectedProject.cacheHit ? " (cache hit)" : ""}`,
    );
    lines.push(`detected markers: ${report.detectedProject.markers.join(", ")}`);

    if (report.detectedProject.suggestions.length > 0) {
      lines.push("suggestions:");

      for (const suggestion of report.detectedProject.suggestions) {
        const prefix = suggestion.kind === "profile" ? `${suggestion.name}: ` : "";
        lines.push(
          `  - ${prefix}${suggestion.command} (${suggestion.reason}; ecosystem=${suggestion.ecosystem}; confidence=${suggestion.confidence})`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
