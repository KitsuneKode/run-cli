import { COMMAND_SCHEMAS } from "./args.ts";

function shellScriptPrelude(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export function renderZshCompletion(): string {
  const commandNames = Object.keys(COMMAND_SCHEMAS).filter((name) => name !== "run");

  const subcommandsHelp: Record<string, string> = {
    init: "Create a local .run.toml",
    completion: "Print shell completion scripts",
    config: "View or edit config files",
    doctor: "Inspect project resolution",
    profiles: "List available profiles",
    trust: "Manage shell hook trust for .run.toml files",
    up: "Start a managed background process",
    ps: "List managed processes",
    dashboard: "Show the managed process overview",
    inspect: "Show detailed process metadata",
    logs: "Show process logs",
    stop: "Stop a managed process",
    restart: "Restart a managed process",
    kill: "Force kill a managed process",
    prune: "Remove dead processes from the registry",
    ports: "Show listening ports for managed processes",
    help: "Show help",
  };

  const subcommandValues = commandNames
    .map((name) => {
      const desc = subcommandsHelp[name] || `Run ${name}`;
      return `        "${name}[${desc}]"`;
    })
    .join(" \\\n");

  const caseBranches = commandNames
    .map((name) => {
      const schema = COMMAND_SCHEMAS[name];
      if (!schema) {
        throw new Error(`Schema not found: ${name}`);
      }
      const argSpecs: string[] = [];

      if (schema.flags) {
        for (const [flagName, flagDef] of Object.entries(schema.flags)) {
          const desc = flagDef.description.replace(/"/g, '\\"');
          let specStr = `"--${flagName}[${desc}]"`;
          if (flagDef.type !== "boolean") {
            let completionSource = "";
            if (flagName === "profile" || flagName === "default-profile") {
              completionSource = "profile:(${(j: :)profiles})";
            }
            specStr = `"--${flagName}[${desc}]:${completionSource}"`;
          }
          argSpecs.push(specStr);

          if (flagDef.short) {
            let shortSpec = `"-${flagDef.short}[${desc}]"`;
            if (flagDef.type !== "boolean") {
              let completionSource = "";
              if (flagName === "profile" || flagName === "default-profile") {
                completionSource = "profile:(${(j: :)profiles})";
              }
              shortSpec = `"-${flagDef.short}[${desc}]:${completionSource}"`;
            }
            argSpecs.push(shortSpec);
          }
        }
      }

      if (
        name === "inspect" ||
        name === "logs" ||
        name === "stop" ||
        name === "restart" ||
        name === "kill"
      ) {
        argSpecs.push('"1:name or id:(${(j: :)managed_names})"');
      } else if (name === "completion") {
        argSpecs.push('"1:shell:(zsh bash)"');
      } else if (name === "config") {
        argSpecs.push('"1:action:(view path edit validate)"');
      }

      if (schema.allowForwardedArgs) {
        argSpecs.push('"*::arg:"');
      }

      if (argSpecs.length === 0) {
        return `        ${name})\n          ;;\n`;
      }

      const specLines = argSpecs.map((spec) => `            ${spec}`).join(" \\\n");
      return `        ${name})\n          _arguments -s -S \\\n${specLines} && ret=0\n          ;;`;
    })
    .join("\n");

  const runSchema = COMMAND_SCHEMAS.run;
  if (!runSchema) {
    throw new Error("Run schema not found");
  }
  const runSpecs: string[] = [];
  if (runSchema.flags) {
    for (const [flagName, flagDef] of Object.entries(runSchema.flags)) {
      const desc = flagDef.description.replace(/"/g, '\\"');
      let specStr = `"--${flagName}[${desc}]"`;
      if (flagDef.type !== "boolean") {
        let completionSource = "";
        if (flagName === "profile" || flagName === "default-profile") {
          completionSource = "profile:(${(j: :)profiles})";
        }
        specStr = `"--${flagName}[${desc}]:${completionSource}"`;
      }
      runSpecs.push(specStr);

      if (flagDef.short) {
        let shortSpec = `"-${flagDef.short}[${desc}]"`;
        if (flagDef.type !== "boolean") {
          let completionSource = "";
          if (flagName === "profile" || flagName === "default-profile") {
            completionSource = "profile:(${(j: :)profiles})";
          }
          shortSpec = `"-${flagDef.short}[${desc}]:${completionSource}"`;
        }
        runSpecs.push(shortSpec);
      }
    }
  }

  runSpecs.push(
    '"--verbose[Show profile, cwd, and config metadata]"',
    '"-v[Show profile, cwd, and config metadata]"',
    '"--config[Use a specific config file]:config:_files"',
    '"--cwd[Run as if started from this directory]:directory:_files -/"',
    '"--no-cache[Disable metadata cache]"',
    '"--help[Show help]"',
    '"-h[Show help]"',
    '"--invoked-as[Implicitly map suffix command to profile]:invoked_as:"',
    '"*::arg:"',
  );
  const runSpecLines = runSpecs.map((spec) => `            ${spec}`).join(" \\\n");
  const fallbackBranch = `        *)\n          _arguments -s -S \\\n${runSpecLines} && ret=0\n          ;;`;

  return shellScriptPrelude([
    "#compdef run",
    "",
    "_run_profiles() {",
    "  local config_path",
    '  config_path="$(command run config path 2>/dev/null)" || return 0',
    "  sed -n 's/^\\[profiles\\.\\([^]]*\\)\\]$/\\1/p' \"$config_path\" 2>/dev/null",
    "}",
    "",
    "_run_managed_names() {",
    "  command run ps 2>/dev/null | sed 's/\\x1b\\[[0-9;]*m//g' | awk 'NR > 1 && NF { print $1 }'",
    "}",
    "",
    "_run() {",
    "  emulate -L zsh",
    '  local context curcontext="$curcontext" state line ret=1',
    "  typeset -A opt_args",
    "  local -a profiles managed_names",
    '  profiles=(${(f)"$(_run_profiles 2>/dev/null)"})',
    '  managed_names=(${(f)"$(_run_managed_names 2>/dev/null)"})',
    "",
    "  _arguments -C -s -S \\",
    '    "--help[Show help]" \\',
    '    "-h[Show help]" \\',
    '    "--config[Use a specific config file]:config:_files" \\',
    '    "--cwd[Run as if started from this directory]:directory:_files -/" \\',
    '    "--dry-run[Print the resolved command without executing it]" \\',
    '    "--no-cache[Disable metadata cache]" \\',
    '    "--verbose[Show profile, cwd, and config metadata]" \\',
    '    "-v[Show profile, cwd, and config metadata]" \\',
    '    "--json[Print JSON output]" \\',
    '    "-j[Print JSON output]" \\',
    '    "--details[Show ports alongside metrics]" \\',
    '    "--watch[Live-refresh ps every 2s]" \\',
    '    "-w[Live-refresh ps every 2s]" \\',
    '    "--follow[Follow log output]" \\',
    '    "-f[Follow log output]" \\',
    '    "--profile[Select a named profile]:profile:(${(j: :)profiles})" \\',
    '    "-p[Select a named profile]:profile:(${(j: :)profiles})" \\',
    '    "--invoked-as[Implicitly map suffix command to profile]:invoked_as:" \\',
    '    "1: :->command" \\',
    '    "*:: :->args" && ret=0',
    "",
    '  case "$state" in',
    "    command)",
    '      _values "run command" \\',
    `${subcommandValues} && ret=0`,
    "      ;;",
    "    args)",
    "      if (( ${words[(I)--]} )); then",
    "        _files && ret=0",
    "        return ret",
    "      fi",
    '      case "${line[1]}" in',
    caseBranches,
    fallbackBranch,
    "      esac",
    "      ;;",
    "  esac",
    "",
    "  return ret",
    "}",
    "",
    'if [ "$funcstack[1]" = "_run" ]; then',
    '  _run "$@"',
    "elif (( $+functions[compdef] )); then",
    "  compdef _run run",
    "fi",
  ]);
}

export function renderBashCompletion(): string {
  const commandNames = Object.keys(COMMAND_SCHEMAS).filter((name) => name !== "run");
  const commandsList = commandNames.join(" ");

  const caseBranches = commandNames
    .map((name) => {
      const schema = COMMAND_SCHEMAS[name];
      if (!schema) {
        throw new Error(`Schema not found: ${name}`);
      }
      const flagNames: string[] = [];
      const valueFlags: string[] = [];

      if (schema.flags) {
        for (const [flagName, flagDef] of Object.entries(schema.flags)) {
          flagNames.push(`--${flagName}`);
          if (flagDef.short) flagNames.push(`-${flagDef.short}`);
          if (flagDef.type !== "boolean") {
            valueFlags.push(`--${flagName}`);
            if (flagDef.short) valueFlags.push(`-${flagDef.short}`);
          }
        }
      }

      const flagListStr = flagNames.join(" ");

      let prevCheck = "";
      if (valueFlags.length > 0) {
        const prevConditions = valueFlags.map((vf) => `"$prev" == "${vf}"`).join(" || ");
        prevCheck = `      if [[ ${prevConditions} ]]; then\n        return 0\n      fi\n`;
      }

      if (name === "completion") {
        return `    completion)\n      COMPREPLY=($(compgen -W "zsh bash --shell-hook" -- "$cur"))\n      ;;`;
      }

      if (name === "config") {
        return `    config)\n      if [[ \${COMP_CWORD} -eq 2 ]]; then\n        COMPREPLY=($(compgen -W "view path edit validate" -- "$cur"))\n      else\n        COMPREPLY=($(compgen -W "--global" -- "$cur"))\n      fi\n      ;;`;
      }

      if (name === "inspect") {
        return `    inspect)\n      if [[ \${COMP_CWORD} -eq 2 ]]; then\n        COMPREPLY=($(compgen -W "$managed_names" -- "$cur"))\n      else\n        COMPREPLY=($(compgen -W "--json" -- "$cur"))\n      fi\n      ;;`;
      }

      if (name === "stop" || name === "restart" || name === "kill") {
        return `    ${name})\n      if [[ \${COMP_CWORD} -eq 2 ]]; then\n        COMPREPLY=($(compgen -W "$managed_names --all" -- "$cur"))\n      else\n        COMPREPLY=($(compgen -W "--all" -- "$cur"))\n      fi\n      ;;`;
      }

      if (name === "logs") {
        return `    logs)\n      if [[ \${COMP_CWORD} -eq 2 ]]; then\n        COMPREPLY=($(compgen -W "$managed_names" -- "$cur"))\n      elif [[ "$prev" == "--lines" ]]; then\n        return 0\n      else\n        COMPREPLY=($(compgen -W "--lines --follow -f" -- "$cur"))\n      fi\n      ;;`;
      }

      return `    ${name})\n${prevCheck}      COMPREPLY=($(compgen -W "${flagListStr}" -- "$cur"))\n      ;;`;
    })
    .join("\n");

  return shellScriptPrelude([
    "_run_profiles() {",
    "  local config_path",
    '  config_path="$(command run config path 2>/dev/null)" || return 0',
    "  sed -n 's/^\\[profiles\\.\\([^]]*\\)\\]$/\\1/p' \"$config_path\" 2>/dev/null",
    "}",
    "",
    "_run_managed_names() {",
    "  command run ps 2>/dev/null | sed 's/\\x1b\\[[0-9;]*m//g' | awk 'NR > 1 && NF { print $1 }'",
    "}",
    "",
    "_run_complete() {",
    "  local cur prev cmd prev2 profiles managed_names",
    "  COMPREPLY=()",
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  cmd="${COMP_WORDS[1]}"',
    '  prev2="${COMP_WORDS[COMP_CWORD-2]}"',
    '  profiles="$(_run_profiles)"',
    '  managed_names="$(_run_managed_names)"',
    `  local commands="${commandsList}"`,
    "",
    "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
    '    COMPREPLY=($(compgen -W "${commands} --help -h --config --cwd --dry-run --no-cache --verbose -v --json -j --details --watch -w --follow -f --profile -p --invoked-as" -- "$cur"))',
    "    return 0",
    "  fi",
    "",
    '  if [[ "$prev" == "--profile" || "$prev" == "-p" ]]; then',
    '    COMPREPLY=($(compgen -W "$profiles" -- "$cur"))',
    "    return 0",
    "  fi",
    "",
    '  case "$cmd" in',
    caseBranches,
    "    *)",
    '      COMPREPLY=($(compgen -W "--help -h --config --cwd --dry-run --no-cache --verbose -v --json -j --details --watch -w --follow -f --profile -p --invoked-as" -- "$cur"))',
    "      ;;",
    "  esac",
    "}",
    "",
    "complete -F _run_complete run",
  ]);
}

/**
 * Generate the Zsh shell hook script.
 *
 * Install with: eval "$(run completion --shell-hook zsh)"
 *
 * Design:
 * - Static output: no config reading, no forks at login time
 * - chpwd hook fires on directory change, not at startup (except once for cwd)
 * - Shell-native directory walk to find .run.toml (no fork)
 * - sha256sum / shasum / stat fallback for file hashing (no fork)
 * - Hash-based cache: if config path + hash unchanged, return immediately
 * - Trust gate: one fork to "run trust --check" only when config is new/changed
 * - Name validation regex before eval (defence-in-depth)
 * - compdef wires profile functions to existing _run completion function
 */
export function renderZshShellHook(): string {
  return shellScriptPrelude([
    "# run-cli shell hook — Zsh",
    '# Install: eval "$(run completion --shell-hook zsh)"',
    "# Requires: run >= 0.0.1 with shell hook support",
    "",
    "# ── State ─────────────────────────────────────────────────────────────────",
    'typeset -g _RUN_HOOK_CONFIG=""',
    'typeset -g _RUN_HOOK_HASH=""',
    'typeset -g _RUN_HOOK_FNS=""',
    "",
    "# ── Unload registered profile functions ───────────────────────────────────",
    "_run_hook_unload() {",
    '  [[ -z "$_RUN_HOOK_FNS" ]] && return 0',
    "  local fn",
    "  for fn in ${(z)_RUN_HOOK_FNS}; do",
    '    (( $+functions[$fn] )) && unfunction "$fn"',
    '    (( $+functions[compdef] )) && compdef -d "$fn" 2>/dev/null',
    "  done",
    '  _RUN_HOOK_FNS=""',
    "}",
    "",
    "# ── Hash a file without forking run (use system sha256sum/shasum) ─────────",
    "_run_hook_hash() {",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    sha256sum < \"$1\" 2>/dev/null | cut -d' ' -f1",
    "  elif command -v shasum >/dev/null 2>&1; then",
    "    shasum -a 256 < \"$1\" 2>/dev/null | cut -d' ' -f1",
    "  else",
    "    # Fallback: mtime:size — not cryptographically strong but prevents forks",
    "    stat -c '%Y:%s' \"$1\" 2>/dev/null || stat -f '%m:%z' \"$1\" 2>/dev/null",
    "  fi",
    "}",
    "",
    "# ── Find nearest .run.toml (shell-native walk, no fork) ───────────────────",
    "_run_hook_find_config() {",
    '  local dir="$PWD"',
    '  local home="$HOME"',
    '  while [[ "$dir" != "/" ]]; do',
    '    if [[ -f "$dir/.run.toml" ]]; then',
    "      printf '%s/.run.toml\\n' \"$dir\"",
    "      return 0",
    "    fi",
    "    # Stop walking above $HOME to avoid picking up unrelated global configs",
    '    [[ "$dir" == "$home" ]] && break',
    '    dir="${dir:h}"',
    "  done",
    "  return 1",
    "}",
    "",
    "# ── Main hook: runs on every cd ────────────────────────────────────────────",
    "_run_hook_chpwd() {",
    "  local config",
    '  config="$(_run_hook_find_config)" || {',
    "    # No .run.toml anywhere above — unload if we had one",
    '    if [[ -n "$_RUN_HOOK_CONFIG" ]]; then',
    "      _run_hook_unload",
    '      _RUN_HOOK_CONFIG=""',
    '      _RUN_HOOK_HASH=""',
    "    fi",
    "    return 0",
    "  }",
    "",
    "  # Fast path: same config file, same hash → nothing to do",
    "  local hash",
    '  hash="$(_run_hook_hash "$config")"',
    '  if [[ "$config" == "$_RUN_HOOK_CONFIG" && "$hash" == "$_RUN_HOOK_HASH" && -n "$hash" ]]; then',
    "    return 0",
    "  fi",
    "",
    "  # Config changed or new — unload previous functions",
    "  _run_hook_unload",
    '  _RUN_HOOK_CONFIG=""',
    '  _RUN_HOOK_HASH=""',
    "",
    "  # Trust gate: one fork to run trust --check",
    "  if ! command run trust --check 2>/dev/null; then",
    '    print -P "%F{yellow}[run]%f .run.toml is new or changed." \\',
    '      "Run %F{cyan}run trust%f to enable profile shortcuts." >&2',
    "    return 0",
    "  fi",
    "",
    "  # Load shortcuts from trusted config (second fork, only when needed)",
    "  local shortcut fns=()",
    "  while IFS= read -r shortcut; do",
    "    # Validate name: must be run + safe suffix (defence-in-depth)",
    '    [[ "$shortcut" =~ ^run-?[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$ ]] || continue',
    "    # Define the function (eval is safe: name is validated above)",
    '    eval "${shortcut}() { command run --invoked-as \\"${shortcut}\\" \\"\\$@\\"; }"',
    "    # Wire tab completion: profile functions complete identically to 'run'",
    '    (( $+functions[compdef] )) && compdef _run "$shortcut"',
    '    fns+=("$shortcut")',
    "  done < <(command run profiles --shortcuts 2>/dev/null)",
    "",
    '  _RUN_HOOK_CONFIG="$config"',
    '  _RUN_HOOK_HASH="$hash"',
    '  _RUN_HOOK_FNS="${fns[*]}"',
    "}",
    "",
    "# ── Register with zsh hook system ─────────────────────────────────────────",
    "autoload -Uz add-zsh-hook",
    "add-zsh-hook chpwd _run_hook_chpwd",
    "# Run once immediately for the current directory",
    "_run_hook_chpwd",
  ]);
}

/**
 * Generate the Bash shell hook script.
 *
 * Install with: eval "$(run completion --shell-hook bash)"
 *
 * Uses PROMPT_COMMAND (prepended) instead of chpwd.
 * All other semantics match the Zsh variant.
 */
export function renderBashShellHook(): string {
  return shellScriptPrelude([
    "# run-cli shell hook — Bash",
    '# Install: eval "$(run completion --shell-hook bash)"',
    "",
    "# ── State ─────────────────────────────────────────────────────────────────",
    '_RUN_HOOK_CONFIG=""',
    '_RUN_HOOK_HASH=""',
    '_RUN_HOOK_FNS=""',
    "",
    "# ── Unload registered profile functions ───────────────────────────────────",
    "_run_hook_unload() {",
    '  [[ -z "$_RUN_HOOK_FNS" ]] && return 0',
    "  local fn",
    "  for fn in $_RUN_HOOK_FNS; do",
    '    unset -f "$fn" 2>/dev/null',
    '    complete -r "$fn" 2>/dev/null',
    "  done",
    '  _RUN_HOOK_FNS=""',
    "}",
    "",
    "# ── Hash a file (shell-native, no run fork) ────────────────────────────────",
    "_run_hook_hash() {",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    sha256sum < \"$1\" 2>/dev/null | cut -d' ' -f1",
    "  elif command -v shasum >/dev/null 2>&1; then",
    "    shasum -a 256 < \"$1\" 2>/dev/null | cut -d' ' -f1",
    "  else",
    "    stat -c '%Y:%s' \"$1\" 2>/dev/null",
    "  fi",
    "}",
    "",
    "# ── Find nearest .run.toml (no fork) ──────────────────────────────────────",
    "_run_hook_find_config() {",
    '  local dir="$PWD"',
    '  local home="$HOME"',
    '  while [[ "$dir" != "/" ]]; do',
    '    if [[ -f "$dir/.run.toml" ]]; then',
    "      printf '%s/.run.toml\\n' \"$dir\"",
    "      return 0",
    "    fi",
    '    [[ "$dir" == "$home" ]] && break',
    '    dir="${dir%/*}"',
    '    [[ -z "$dir" ]] && dir="/"',
    "  done",
    "  return 1",
    "}",
    "",
    "# ── Main hook ──────────────────────────────────────────────────────────────",
    "_run_hook_update() {",
    "  local config",
    '  config="$(_run_hook_find_config)" || {',
    '    if [[ -n "$_RUN_HOOK_CONFIG" ]]; then',
    "      _run_hook_unload",
    '      _RUN_HOOK_CONFIG=""',
    '      _RUN_HOOK_HASH=""',
    "    fi",
    "    return 0",
    "  }",
    "",
    "  local hash",
    '  hash="$(_run_hook_hash "$config")"',
    '  if [[ "$config" == "$_RUN_HOOK_CONFIG" && "$hash" == "$_RUN_HOOK_HASH" && -n "$hash" ]]; then',
    "    return 0",
    "  fi",
    "",
    "  _run_hook_unload",
    '  _RUN_HOOK_CONFIG=""',
    '  _RUN_HOOK_HASH=""',
    "",
    "  if ! command run trust --check 2>/dev/null; then",
    "    printf '\\033[33m[run]\\033[0m .run.toml is new or changed. Run \\033[36mrun trust\\033[0m to enable profile shortcuts.\\n' >&2",
    "    return 0",
    "  fi",
    "",
    '  local shortcut fns=""',
    "  while IFS= read -r shortcut; do",
    '    [[ "$shortcut" =~ ^run-?[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$ ]] || continue',
    '    eval "${shortcut}() { command run --invoked-as \\"${shortcut}\\" \\"\\$@\\"; }"',
    '    complete -F _run_complete "$shortcut"',
    '    fns="$fns $shortcut"',
    "  done < <(command run profiles --shortcuts 2>/dev/null)",
    "",
    '  _RUN_HOOK_CONFIG="$config"',
    '  _RUN_HOOK_HASH="$hash"',
    '  _RUN_HOOK_FNS="${fns# }"  # trim leading space',
    "}",
    "",
    "# ── Register with PROMPT_COMMAND ───────────────────────────────────────────",
    'if [[ -z "$PROMPT_COMMAND" ]]; then',
    '  PROMPT_COMMAND="_run_hook_update"',
    "else",
    '  PROMPT_COMMAND="_run_hook_update; $PROMPT_COMMAND"',
    "fi",
    "# Run once immediately for the current directory",
    "_run_hook_update",
  ]);
}
