# Plan: Process Hardening, Routing, and Error Handling

## Summary

Implement robust argument routing for completion checks, eliminate process lockfile race conditions, and shield metric collections from uncaught exceptions.

## Motivation

- Silently failing `run trust --check` command disabled completion shortcuts and generated directory change warnings.
- Lockfile reclamation could allow concurrent processes to corrupt the registry database.
- CLI crashed under Bun when executing process dashboard/metrics commands in environments missing helper binaries like `lsof` or `ps`.

## Scope

- Map `--check`, `--revoke`, and `--list` flags in the `trust` subcommand.
- Add owner PID verification inside the lockfile before deletion.
- Introduce try-catch boundaries around process metric command execution.

## Proposed Changes

1. **Routing**: Add check, revoke, and list flags to `ParsedArgs` schema for `trust`. Update routing switch to map boolean options.
2. **Locking**: Write `process.pid` to the lockfile upon acquisition. Update release function to only unlink the file if the active owner matches the PID.
3. **Metric Safety**: Wrap `spawnSync` calls for `ps` and `lsof` in `safeSpawnSync` to handle `ENOENT` gracefully.
4. **Validation**: Add unit tests simulating lockfile reclamation and missing metrics binaries.

## Done Criteria

- Lockfile deletion does not unlink files belonging to newer owners.
- Missing helper binaries fail gracefully without throwing uncaught exceptions.
