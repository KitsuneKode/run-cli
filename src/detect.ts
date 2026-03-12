import path from "node:path";

import type { CacheStore } from "./cache.ts";
import { ENTRYPOINT_CANDIDATES, MARKER_FILES, PYTHON_ENTRYPOINTS } from "./constants.ts";
import { pathExists, readTextFile, statFingerprint, walkUpDirectories } from "./fs.ts";
import type { DetectedProject, DetectionSuggestion } from "./types.ts";

interface PackageJsonShape {
  scripts?: Record<string, string>;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PythonProjectDetails {
  commandPrefix: string;
  reasonPrefix: string;
}

async function detectPackageManager(
  projectRoot: string,
  packageJson: PackageJsonShape | null,
): Promise<string> {
  if (packageJson?.packageManager?.startsWith("bun")) {
    return "bun";
  }

  if (packageJson?.packageManager?.startsWith("pnpm")) {
    return "pnpm";
  }

  if (packageJson?.packageManager?.startsWith("yarn")) {
    return "yarn";
  }

  if (packageJson?.packageManager?.startsWith("npm")) {
    return "npm";
  }

  const lockFiles = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const;

  for (const [fileName, packageManager] of lockFiles) {
    if (await pathExists(path.join(projectRoot, fileName))) {
      return packageManager;
    }
  }

  return "npm";
}

function scriptCommand(packageManager: string, scriptName: string): string {
  switch (packageManager) {
    case "bun":
      return `bun run ${scriptName}`;
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

async function readPackageJson(projectRoot: string): Promise<PackageJsonShape | null> {
  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    return JSON.parse(await readTextFile(packageJsonPath)) as PackageJsonShape;
  } catch {
    return null;
  }
}

async function findExistingFile(projectRoot: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pathExists(path.join(projectRoot, candidate))) {
      return candidate;
    }
  }

  return null;
}

async function readPyProject(projectRoot: string): Promise<string | null> {
  const pyprojectPath = path.join(projectRoot, "pyproject.toml");

  if (!(await pathExists(pyprojectPath))) {
    return null;
  }

  try {
    return await readTextFile(pyprojectPath);
  } catch {
    return null;
  }
}

async function detectPythonCommandPrefix(projectRoot: string): Promise<PythonProjectDetails> {
  const pyprojectText = await readPyProject(projectRoot);

  if (await pathExists(path.join(projectRoot, "uv.lock"))) {
    return {
      commandPrefix: "uv run python",
      reasonPrefix: "Detected uv.lock, so uv should manage the project environment",
    };
  }

  if (pyprojectText?.includes("[tool.uv]")) {
    return {
      commandPrefix: "uv run python",
      reasonPrefix: "Detected uv configuration in pyproject.toml",
    };
  }

  if (await pathExists(path.join(projectRoot, "Pipfile"))) {
    return {
      commandPrefix: "pipenv run python",
      reasonPrefix: "Detected Pipfile, so Pipenv should provide the environment",
    };
  }

  if (
    (await pathExists(path.join(projectRoot, "poetry.lock"))) ||
    pyprojectText?.includes("[tool.poetry]")
  ) {
    return {
      commandPrefix: "poetry run python",
      reasonPrefix: "Detected Poetry project metadata",
    };
  }

  if (await pathExists(path.join(projectRoot, ".venv/bin/python"))) {
    return {
      commandPrefix: ".venv/bin/python",
      reasonPrefix: "Detected a local .venv interpreter",
    };
  }

  if (await pathExists(path.join(projectRoot, "venv/bin/python"))) {
    return {
      commandPrefix: "venv/bin/python",
      reasonPrefix: "Detected a local venv interpreter",
    };
  }

  return {
    commandPrefix: "python",
    reasonPrefix: "Detected a Python entrypoint without a project-specific environment manager",
  };
}

async function buildSuggestions(projectRoot: string): Promise<DetectionSuggestion[]> {
  const suggestions: DetectionSuggestion[] = [];
  const [
    packageJson,
    entrypoint,
    goModuleExists,
    mainGoExists,
    cargoTomlExists,
    pythonEntrypoint,
    makefileExists,
  ] = await Promise.all([
    readPackageJson(projectRoot),
    findExistingFile(projectRoot, ENTRYPOINT_CANDIDATES),
    pathExists(path.join(projectRoot, "go.mod")),
    pathExists(path.join(projectRoot, "main.go")),
    pathExists(path.join(projectRoot, "Cargo.toml")),
    findExistingFile(projectRoot, PYTHON_ENTRYPOINTS),
    pathExists(path.join(projectRoot, "Makefile")),
  ]);
  const packageManager = await detectPackageManager(projectRoot, packageJson);
  const scripts = packageJson?.scripts ?? {};

  if (scripts.start) {
    suggestions.push({
      kind: "default",
      name: "default",
      command: scriptCommand(packageManager, "start"),
      reason: "Detected a package.json start script.",
      ecosystem: "javascript",
      confidence: "high",
    });
  }

  if (scripts.dev) {
    suggestions.push({
      kind: scripts.start ? "profile" : "default",
      name: "dev",
      command: scriptCommand(packageManager, "dev"),
      reason: "Detected a package.json dev script.",
      ecosystem: "javascript",
      confidence: "high",
    });
  }

  if (!scripts.start && !scripts.dev) {
    if (entrypoint) {
      const isTypeScript = entrypoint.endsWith(".ts");
      const command =
        packageManager === "bun"
          ? `bun run ${entrypoint}`
          : isTypeScript
            ? `bunx tsx ${entrypoint}`
            : `node ${entrypoint}`;

      suggestions.push({
        kind: "default",
        name: "default",
        command,
        reason: `Detected ${entrypoint} in the project root.`,
        ecosystem: "javascript",
        confidence: packageManager === "bun" ? "high" : "medium",
      });
    }
  }

  if (goModuleExists) {
    suggestions.push({
      kind: "default",
      name: "default",
      command: "go run .",
      reason: "Detected go.mod.",
      ecosystem: "go",
      confidence: "high",
    });
  } else if (mainGoExists) {
    suggestions.push({
      kind: "default",
      name: "default",
      command: "go run main.go",
      reason: "Detected main.go.",
      ecosystem: "go",
      confidence: "medium",
    });
  }

  if (cargoTomlExists) {
    suggestions.push({
      kind: "default",
      name: "default",
      command: "cargo run",
      reason: "Detected Cargo.toml.",
      ecosystem: "rust",
      confidence: "high",
    });
  }

  if (pythonEntrypoint) {
    const pythonCommand = await detectPythonCommandPrefix(projectRoot);

    suggestions.push({
      kind: "default",
      name: "default",
      command: `${pythonCommand.commandPrefix} ${pythonEntrypoint}`,
      reason: `${pythonCommand.reasonPrefix} and ${pythonEntrypoint}.`,
      ecosystem: "python",
      confidence: pythonCommand.commandPrefix === "python" ? "medium" : "high",
    });
  }

  if (makefileExists) {
    suggestions.push({
      kind: "default",
      name: "default",
      command: "make run",
      reason: "Detected a Makefile and a conventional make run target is likely.",
      ecosystem: "make",
      confidence: "low",
    });
  }

  const uniqueSuggestions = new Map<string, DetectionSuggestion>();

  for (const suggestion of suggestions) {
    uniqueSuggestions.set(
      `${suggestion.kind}:${suggestion.name}:${suggestion.command}`,
      suggestion,
    );
  }

  const deduped = [...uniqueSuggestions.values()];

  deduped.sort((left, right) => {
    const score = (entry: DetectionSuggestion) => {
      const confidenceScore =
        entry.confidence === "high" ? 3 : entry.confidence === "medium" ? 2 : 1;
      const defaultScore = entry.kind === "default" ? 2 : 1;
      return confidenceScore * 10 + defaultScore;
    };

    return score(right) - score(left);
  });

  return deduped;
}

async function findProjectRoot(
  startDir: string,
): Promise<{ root: string; markers: string[] } | null> {
  for (const directory of walkUpDirectories(startDir)) {
    const markerChecks = await Promise.all(
      MARKER_FILES.map(async (marker) =>
        (await pathExists(path.join(directory, marker))) ? marker : null,
      ),
    );
    const markers = markerChecks.filter((marker): marker is string => marker !== null);

    if (markers.length > 0) {
      return {
        root: directory,
        markers,
      };
    }
  }

  return null;
}

export async function detectProject(options: {
  cwd: string;
  useCache: boolean;
  cacheStore: CacheStore;
}): Promise<DetectedProject | null> {
  const project = await findProjectRoot(options.cwd);

  if (!project) {
    return null;
  }

  const fingerprints = Object.fromEntries(
    (
      await Promise.all(
        project.markers.map(async (marker) => {
          const markerPath = path.join(project.root, marker);
          return [marker, await statFingerprint(markerPath)] as const;
        }),
      )
    ).filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );

  if (options.useCache) {
    const cached = await options.cacheStore.getDetection(project.root, fingerprints);

    if (cached) {
      return {
        root: project.root,
        markers: cached.markers,
        suggestions: cached.suggestions,
        cacheHit: true,
      };
    }
  }

  const suggestions = await buildSuggestions(project.root);

  if (options.useCache) {
    await options.cacheStore.setDetection(project.root, fingerprints, project.markers, suggestions);
  }

  return {
    root: project.root,
    markers: project.markers,
    suggestions,
    cacheHit: false,
  };
}
