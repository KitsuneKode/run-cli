---
"@kitsunekode/run-cli": minor
---

Process hardening, command routing refactor, trust checks, and TOML schema key validations

- **God-Parser Refactoring**: Restructured the God-Parser in `src/args.ts` and `src/cli.ts` into decentralized command modules inside `src/commands/` for superior maintainability and locality.
- **Improved Option Parsing & Routing**: Implemented correct flag schema and routing for `run trust --check` command to support shell hook liveness checks.
- **PID-based Lockfile Verification**: Resolved file locking race conditions by embedding owner PID in the lockfile and validating it before removal.
- **SpawnSync Protection**: Added try-catch protection on process metrics (lsof, ps) to prevent CLI crashes when commands are missing (e.g., Alpine Linux).
- **Clean TOML Layout**: Optimized `run init` output to generate a clean, top-level `command` key instead of nesting it in `[profiles.default]` when no extra profiles are required.
- **Strict TOML Validation**: Added strict validation against unrecognized configuration keys at both project and global levels in `.run.toml` to prevent silent syntax typos.
