import path from "node:path";

import { pathExists, readTextFile } from "./fs.ts";

function basenameName(projectRoot: string): string {
  return path.basename(projectRoot) || "project";
}

export async function detectProjectName(projectRoot: string): Promise<string> {
  const packageJsonPath = path.join(projectRoot, "package.json");

  if (await pathExists(packageJsonPath)) {
    try {
      const parsed = JSON.parse(await readTextFile(packageJsonPath)) as { name?: string };

      if (typeof parsed.name === "string" && parsed.name.trim() !== "") {
        return parsed.name;
      }
    } catch {
      // Fall through to the next strategy.
    }
  }

  const pyprojectPath = path.join(projectRoot, "pyproject.toml");

  if (await pathExists(pyprojectPath)) {
    const pyprojectText = await readTextFile(pyprojectPath);
    const projectNameMatch = pyprojectText.match(/^\s*name\s*=\s*"([^"]+)"/m);

    if (projectNameMatch?.[1]) {
      return projectNameMatch[1];
    }
  }

  const cargoTomlPath = path.join(projectRoot, "Cargo.toml");

  if (await pathExists(cargoTomlPath)) {
    const cargoText = await readTextFile(cargoTomlPath);
    const cargoNameMatch = cargoText.match(/^\s*name\s*=\s*"([^"]+)"/m);

    if (cargoNameMatch?.[1]) {
      return cargoNameMatch[1];
    }
  }

  const goModPath = path.join(projectRoot, "go.mod");

  if (await pathExists(goModPath)) {
    const goModText = await readTextFile(goModPath);
    const moduleMatch = goModText.match(/^\s*module\s+([^\s]+)/m);

    if (moduleMatch?.[1]) {
      return path.basename(moduleMatch[1]);
    }
  }

  return basenameName(projectRoot);
}
