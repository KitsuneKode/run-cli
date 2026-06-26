---
"@kitsunekode/run-cli": patch
---

Refactored the internal CLI structure to use declarative command schemas and WorkspaceContext environment orchestration.

- Unified command flag parsing, validation, and metadata under a centralized schema definition.
- Consolidated project config, global config, caching, and state validation under WorkspaceContext.
- Generated Bash and Zsh auto-completion scripts dynamically from command schemas.
