---
"@kitsunekode/run-cli": patch
---

Added a Node.js compatibility layer and a custom, zero-dependency TOML parser fallback.

- Implemented fallbacks for Bun-native APIs (`Bun.file`, `Bun.write`, `Bun.sleep`) using standard Node.js module equivalents.
- Added a fast, custom line-based TOML parser to replace `Bun.TOML.parse` when running in a Node.js environment.
- Verified that all unit and integration tests compile and run successfully across both runtimes.
