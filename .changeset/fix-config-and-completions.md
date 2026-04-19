---
"@kitsunekode/run-cli": patch
---

Fix dual source of truth for profile commands and repair completions

- Eliminated ambiguity between top-level `command` and `profiles.default.command`
  — profile entries are now the single source of truth
- Removed duplicate `runx` executable (was byte-identical to `run`)
- Fixed shell completions: ANSI code stripping from colorized `run ps` output,
  added `--watch/-w`, `--json/-j`, `--follow/-f` flags, proper subcommand
  dispatch for zsh, value position handling for bash
- Updated `run ps` to always show memory (previously only with `--details`)
