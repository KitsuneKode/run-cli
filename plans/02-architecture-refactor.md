# Plan: Decentralized Command Architecture Refactoring

## Summary

Migrate the monolithic CLI argument parser and routing switch-case into modular, self-contained command definitions.

## Motivation

- Adding or modifying commands required editing 4 different files: `args.ts`, `cli.ts`, `constants.ts`, and `completion.ts`.
- Reducing vertical sprawl improves codebase maintainability and AI navigability.

## Scope

- Define a generic `Command` interface.
- Move subcommand definitions and execution handlers into `src/commands/`.
- Derive subcommands schemas and reserved names dynamically.

## Proposed Changes

1. **Registry**: Create `src/commands/types.ts` defining the `Command` layout.
2. **Migration**: Extract logic for all 15 subcommands into files under `src/commands/`.
3. **Integration**: Update `src/args.ts` to build parser schemas dynamically from the command list.
4. **Dispatcher**: Replace the giant switch-case in `src/cli.ts` with a dynamic command registry lookup and dispatcher.

## Done Criteria

- Command definition and logic reside in a single place under `src/commands/`.
- All integration and completion tests remain passing.
