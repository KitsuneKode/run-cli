#compdef run runx

if command -v run >/dev/null 2>&1; then
  eval "$(run completion zsh)"
fi
