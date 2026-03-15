import path from "node:path";
import { createInterface } from "node:readline/promises";

import type { CacheStore } from "./cache.ts";
import { renderProjectConfig } from "./config.ts";
import { CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME } from "./constants.ts";
import { detectProject } from "./detect.ts";
import { pathExists, writeTextFile } from "./fs.ts";
import type { DetectionSuggestion, RunConfigFile } from "./types.ts";

export interface InitOptions {
  cwd: string;
  useCache: boolean;
  force: boolean;
  yes: boolean;
  command?: string;
  defaultProfile?: string;
  profiles: Array<{ name: string; command: string }>;
  cacheStore: CacheStore;
}

function suggestionForDefault(suggestions: DetectionSuggestion[]): DetectionSuggestion | undefined {
  return suggestions.find((entry) => entry.kind === "default") ?? suggestions[0];
}

function suggestionLabel(
  suggestion: DetectionSuggestion,
  index: number,
  isRecommended: boolean,
): string {
  const profilePrefix = suggestion.kind === "profile" ? `[${suggestion.name}] ` : "";
  const recommendation = isRecommended ? " (recommended)" : "";
  return `  ${index + 1}. ${profilePrefix}${suggestion.command}${recommendation}\n     ${suggestion.reason}`;
}

function parseCustomProfile(rawValue: string): { name: string; command: string } | null {
  const trimmed = rawValue.trim();

  if (trimmed === "") {
    return null;
  }

  const [name, ...commandParts] = trimmed.split("=");
  const command = commandParts.join("=").trim();

  if (!name || !command) {
    throw new Error('Profiles must use the form "name=command".');
  }

  return {
    name: name.trim(),
    command,
  };
}

export async function runInit(options: InitOptions): Promise<{
  path: string;
  config: RunConfigFile;
  detected: DetectionSuggestion[];
}> {
  const configPath = path.join(options.cwd, CONFIG_FILE_NAME);
  const legacyConfigPath = path.join(options.cwd, LEGACY_CONFIG_FILE_NAME);

  if ((await pathExists(configPath)) && !options.force) {
    throw new Error(`${configPath} already exists. Re-run with --force to overwrite it.`);
  }

  if ((await pathExists(legacyConfigPath)) && !options.force) {
    throw new Error(
      `${legacyConfigPath} already exists. Rename it to ${CONFIG_FILE_NAME} or re-run with --force to overwrite it.`,
    );
  }

  const detected = await detectProject({
    cwd: options.cwd,
    useCache: options.useCache,
    cacheStore: options.cacheStore,
  });
  const detectedSuggestions = detected?.suggestions ?? [];
  const detectedDefault = suggestionForDefault(detectedSuggestions);
  let command = options.command ?? detectedDefault?.command;
  let defaultProfile = options.defaultProfile ?? "default";
  const extraProfiles = [...options.profiles];

  if (!options.yes && process.stdout.isTTY && process.stdin.isTTY) {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (detectedSuggestions.length > 0) {
      const renderedSuggestions = detectedSuggestions
        .map((suggestion, index) =>
          suggestionLabel(suggestion, index, suggestion === detectedDefault),
        )
        .join("\n");

      console.log(`Detected commands for this project:\n${renderedSuggestions}\n`);

      const selectedCommand = await prompt.question(
        "Choose a default command by number or type a custom command [1]: ",
      );
      const trimmedSelection = selectedCommand.trim();

      if (trimmedSelection === "") {
        command = detectedDefault?.command;
      } else {
        const selectedIndex = Number.parseInt(trimmedSelection, 10);

        if (
          Number.isInteger(selectedIndex) &&
          selectedIndex >= 1 &&
          selectedIndex <= detectedSuggestions.length
        ) {
          const selectedSuggestion = detectedSuggestions[selectedIndex - 1];
          command = selectedSuggestion?.command;
          if (selectedSuggestion?.kind === "profile") {
            defaultProfile = selectedSuggestion.name;
          } else {
            defaultProfile = "default";
          }
        } else {
          command = trimmedSelection;
          defaultProfile = "default";
        }
      }
    } else {
      const resolvedCommand = await prompt.question("Default command (required): ");

      if (resolvedCommand.trim() !== "") {
        command = resolvedCommand.trim();
        defaultProfile = "default";
      }
    }

    const suggestedProfiles = detectedSuggestions.filter(
      (entry) =>
        entry.kind === "profile" && !extraProfiles.some((profile) => profile.name === entry.name),
    );

    for (const suggestedProfile of suggestedProfiles) {
      const includeProfile = await prompt.question(
        `Add profile "${suggestedProfile.name}" using "${suggestedProfile.command}"? [Y/n/custom]: `,
      );
      const normalizedAnswer = includeProfile.trim().toLowerCase();

      if (normalizedAnswer === "" || normalizedAnswer === "y" || normalizedAnswer === "yes") {
        extraProfiles.push({
          name: suggestedProfile.name,
          command: suggestedProfile.command,
        });
        continue;
      }

      if (normalizedAnswer === "custom") {
        const customProfileValue = await prompt.question(
          `Enter ${suggestedProfile.name}=command: `,
        );
        const parsedProfile = parseCustomProfile(customProfileValue);

        if (parsedProfile) {
          extraProfiles.push(parsedProfile);
        }
      }
    }

    while (true) {
      const customProfileValue = await prompt.question(
        'Add another profile as "name=command" or press Enter to finish: ',
      );
      const parsedProfile = parseCustomProfile(customProfileValue);

      if (!parsedProfile) {
        break;
      }

      extraProfiles.push(parsedProfile);
    }

    await prompt.close();
  }

  if (!command) {
    throw new Error(
      "No command could be inferred. Pass --command or run init in a project with detectable markers.",
    );
  }

  if (
    defaultProfile !== "default" &&
    !extraProfiles.some((profile) => profile.name === defaultProfile)
  ) {
    const matchingSuggestion = detectedSuggestions.find(
      (suggestion) => suggestion.kind === "profile" && suggestion.name === defaultProfile,
    );

    if (matchingSuggestion) {
      extraProfiles.push({
        name: matchingSuggestion.name,
        command: matchingSuggestion.command,
      });
    } else {
      throw new Error(
        `Default profile "${defaultProfile}" must be provided as a named profile command.`,
      );
    }
  }

  const config: RunConfigFile = {
    version: 1,
    defaultProfile,
    profiles: {
      default: {
        command,
      },
    },
  };
  if (!config.profiles) {
    config.profiles = {};
  }

  const profiles = config.profiles;

  for (const profile of extraProfiles) {
    if (profile.name === "default") {
      profiles.default = {
        command: profile.command,
      };
      continue;
    }

    profiles[profile.name] = {
      command: profile.command,
    };
  }

  if (defaultProfile === "default" && profiles.default?.command) {
    config.command = profiles.default.command;
  }

  await writeTextFile(configPath, renderProjectConfig(config));

  return {
    path: configPath,
    config,
    detected: detectedSuggestions,
  };
}
