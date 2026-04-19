#compdef run

_run_profiles() {
  local config_path
  config_path="$(command run config path 2>/dev/null)" || return 0
  sed -n 's/^\[profiles\.\([^]]*\)\]$/\1/p' "$config_path" 2>/dev/null
}

_run_managed_names() {
  command run ps 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | awk 'NR > 1 && NF { print $1 }'
}

_run() {
  emulate -L zsh
  local context curcontext="$curcontext" state line ret=1
  typeset -A opt_args
  local -a profiles managed_names
  profiles=(${(f)"$(_run_profiles 2>/dev/null)"})
  managed_names=(${(f)"$(_run_managed_names 2>/dev/null)"})

  _arguments -C -s -S \
    "--help[Show help]" \
    "-h[Show help]" \
    "--config[Use a specific config file]:config:_files" \
    "--cwd[Run as if started from this directory]:directory:_files -/" \
    "--dry-run[Print the resolved command without executing it]" \
    "--no-cache[Disable metadata cache]" \
    "--verbose[Show profile, cwd, and config metadata]" \
    "-v[Show profile, cwd, and config metadata]" \
    "--json[Print JSON output]" \
    "-j[Print JSON output]" \
    "--details[Show ports alongside metrics]" \
    "--watch[Live-refresh ps every 2s]" \
    "-w[Live-refresh ps every 2s]" \
    "--follow[Follow log output]" \
    "-f[Follow log output]" \
    "--profile[Select a named profile]:profile:(${(j: :)profiles})" \
    "-p[Select a named profile]:profile:(${(j: :)profiles})" \
    "1: :->command" \
    "*:: :->args" && ret=0

  case "$state" in
    command)
      _values "run command" \
        "init[Create a local .run.toml]" \
        "completion[Print shell completion scripts]" \
        "config[View or edit config files]" \
        "doctor[Inspect project resolution]" \
        "profiles[List available profiles]" \
        "up[Start a managed background process]" \
        "ps[List managed processes]" \
        "dashboard[Show the managed process overview]" \
        "inspect[Show detailed process metadata]" \
        "logs[Show process logs]" \
        "stop[Stop a managed process]" \
        "restart[Restart a managed process]" \
        "kill[Force kill a managed process]" \
        "prune[Remove dead processes from the registry]" \
        "ports[Show listening ports for managed processes]" \
        "help[Show help]" && ret=0
      ;;
    args)
      if (( ${words[(I)--]} )); then
        _files && ret=0
        return ret
      fi
      case "${line[1]}" in
        init)
          _arguments -s -S \
            "--yes[Skip prompts and accept detected defaults]" \
            "--force[Overwrite an existing config file]" \
            "--command[Use a specific default command]:command:" \
            "--default-profile[Choose the profile plain run should execute]:profile:(${(j: :)profiles})" \
            "--add-profile[Add a named profile as name=command]:" && ret=0
          ;;
        completion)
          _values "shell" zsh bash && ret=0
          ;;
        config)
          _arguments -s -S \
            "1:action:(view path edit validate)" \
            "--global[Use the global config file]" && ret=0
          ;;
        up)
          _arguments -s -S \
            "--name[Override the managed process name]:" \
            "--profile[Select a named profile]:profile:(${(j: :)profiles})" \
            "-p[Select a named profile]:profile:(${(j: :)profiles})" \
            "*::arg:" && ret=0
          ;;
        doctor|ports|profiles)
          _arguments -s -S "--json[Print JSON output]" && ret=0
          ;;
        prune)
          _arguments -s -S \
            "--json[Print JSON output]" \
            "--dry-run[Show what would be pruned without removing]" && ret=0
          ;;
        ps)
          _arguments -s -S \
            "--json[Print JSON output]" \
            "--details[Show ports alongside metrics]" \
            "--watch[Live-refresh every 2s]" && ret=0
          ;;
        dashboard)
          ;;
        inspect)
          _arguments -s -S \
            "--json[Print JSON output]" \
            "1:name or id:(${(j: :)managed_names})" && ret=0
          ;;
        logs)
          _arguments -s -S \
            "--lines[Show only the last N lines]:" \
            "--follow[Follow log output]" \
            "-f[Follow log output]" \
            "1:name or id:(${(j: :)managed_names})" && ret=0
          ;;
        stop|restart|kill)
          _arguments -s -S "1:name or id:(${(j: :)managed_names})" && ret=0
          ;;
        help)
          ;;
        *)
          _arguments -s -S \
            "--profile[Select a named profile]:profile:(${(j: :)profiles})" \
            "-p[Select a named profile]:profile:(${(j: :)profiles})" \
            "--verbose[Show profile, cwd, and config metadata]" \
            "-v[Show profile, cwd, and config metadata]" \
            "*::arg:" && ret=0
          ;;
      esac
      ;;
  esac

  return ret
}

if [ "$funcstack[1]" = "_run" ]; then
  _run "$@"
elif (( $+functions[compdef] )); then
  compdef _run run
fi

