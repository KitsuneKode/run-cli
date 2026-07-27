import { resolveProfile } from "./config.ts";
import type { WorkspaceContext } from "./context.ts";

export async function checkProcessManagementEnabled(
  ctx: WorkspaceContext,
  profileName?: string,
): Promise<void> {
  const globalConfig = await ctx.getGlobalConfig();
  const resolvedConfig = await ctx.getProjectConfig();

  let enabled = true;
  if (resolvedConfig) {
    try {
      const profile = resolveProfile(resolvedConfig, profileName, undefined, globalConfig);
      enabled = profile.process_management;
    } catch {
      enabled = resolvedConfig.config.process_management ?? globalConfig.process_management ?? true;
    }
  } else {
    enabled = globalConfig.process_management ?? true;
  }

  if (!enabled) {
    throw new Error(
      "Process management is disabled by configuration (process_management = false).",
    );
  }
}
