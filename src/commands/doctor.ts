import type { WorkspaceContext } from "../context.ts";
import type { ParsedArgs } from "../args.ts";
import type { Command } from "./types.ts";
import { detectProject } from "../detect.ts";
import { doctorReportData, renderDoctorReport } from "../doctor.ts";
import { info } from "../output.ts";

export const doctorCommand: Command = {
  name: "doctor",
  description: "Diagnose configuration and project status",
  flags: {
    json: { type: "boolean", description: "Format output as JSON" },
  },
  execute: async (ctx, parsed) => {
    const projectConfig = await ctx.getProjectConfig();
    const useCache = await ctx.useCache();
    const detectedProject = await detectProject({
      cwd: ctx.cwd,
      useCache,
      cacheStore: ctx.cacheStore,
    });
    const globalConfig = await ctx.getGlobalConfig();

    if (parsed.json) {
      info(
        `${JSON.stringify(
          doctorReportData({
            cwd: ctx.cwd,
            globalConfig,
            projectConfig,
            detectedProject,
          }),
          null,
          2,
        )}\n`,
      );
    } else {
      info(
        renderDoctorReport({
          cwd: ctx.cwd,
          globalConfig,
          projectConfig,
          detectedProject,
        }),
      );
    }

    await ctx.saveCacheIfNeeded();
  },
};
