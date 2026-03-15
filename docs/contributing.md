# Contributing

## Local setup

```bash
bun install
bun run build
bun test
```

Optional global linking during development:

```bash
bun run link:global
bun run relink:global
```

## Repo workflow

Quality commands:

```bash
bun run format
bun run lint
bun test
bun run check
```

Git hooks are managed with Husky:

- `pre-commit` runs `lint-staged`
- `commit-msg` runs Commitlint

## Implementation notes for agents

When extending the CLI:

- keep startup fast and dependencies minimal
- prefer explicit project config over additional inference
- if you add new config fields, update both validation and docs in the same change
- keep diagnostics deterministic so they are easy for both humans and agents to parse
- add tests for both direct module behavior and CLI-level behavior when user-facing output changes
- if you change CLI semantics, update completions, README, docs, `CLAUDE.md`, and `AGENTS.md` in the same change
- keep the default run path quiet and polished; move explainers behind explicit flags like `--verbose`
- preserve one shared command-construction path so dry-run, managed runs, inspect output, and banners never drift

## Release expectations

Before a release or tag:

1. `bun run check`
2. `bun run build`
3. confirm `run help` and `run doctor` still read clearly
4. confirm `bun link` exposes both `run` and `runx`
