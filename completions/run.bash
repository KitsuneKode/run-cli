_run_profiles() {
  local config_path
  config_path="$(command run config path 2>/dev/null)" || return 0
  sed -n 's/^\[profiles\.\([^]]*\)\]$/\1/p' "$config_path" 2>/dev/null
}

_run_managed_names() {
  command run ps 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | awk 'NR > 1 && NF { print $1 }'
}

_run_complete() {
  local cur prev cmd prev2 profiles managed_names
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  cmd="${COMP_WORDS[1]}"
  prev2="${COMP_WORDS[COMP_CWORD-2]}"
  profiles="$(_run_profiles)"
  managed_names="$(_run_managed_names)"
  local commands="init completion config doctor profiles up ps dashboard inspect logs stop restart kill prune ports help"

  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${commands} --help -h --config --cwd --dry-run --no-cache --verbose -v --json -j --details --watch -w --follow -f --profile -p" -- "$cur"))
    return 0
  fi

  if [[ "$prev" == "--profile" || "$prev" == "-p" ]]; then
    COMPREPLY=($(compgen -W "$profiles" -- "$cur"))
    return 0
  fi

  case "$cmd" in
    init)
      if [[ "$prev" == "--command" || "$prev" == "--default-profile" || "$prev" == "--add-profile" ]]; then
        return 0
      fi
      COMPREPLY=($(compgen -W "--yes --force --command --default-profile --add-profile" -- "$cur"))
      ;;
    completion)
      COMPREPLY=($(compgen -W "zsh bash" -- "$cur"))
      ;;
    config)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "view path edit validate" -- "$cur"))
      else
        COMPREPLY=($(compgen -W "--global" -- "$cur"))
      fi
      ;;
    doctor|profiles)
      COMPREPLY=($(compgen -W "--json" -- "$cur"))
      ;;
    prune)
      COMPREPLY=($(compgen -W "--json --dry-run" -- "$cur"))
      ;;
    up)
      if [[ "$prev" == "--name" ]]; then
        return 0
      fi
      COMPREPLY=($(compgen -W "--name --profile -p" -- "$cur"))
      ;;
    ps)
      COMPREPLY=($(compgen -W "--json --details --watch -w" -- "$cur"))
      ;;
    dashboard|ports)
      ;;
    inspect)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "$managed_names" -- "$cur"))
      else
        COMPREPLY=($(compgen -W "--json" -- "$cur"))
      fi
      ;;
    logs)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "$managed_names" -- "$cur"))
      elif [[ "$prev" == "--lines" ]]; then
        return 0
      else
        COMPREPLY=($(compgen -W "--lines --follow -f" -- "$cur"))
      fi
      ;;
    stop|restart|kill)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "$managed_names" -- "$cur"))
      fi
      ;;
    help)
      ;;
    *)
      COMPREPLY=($(compgen -W "--help -h --config --cwd --dry-run --no-cache --verbose -v --json -j --details --watch -w --follow -f --profile -p" -- "$cur"))
      ;;
  esac
}

complete -F _run_complete run

