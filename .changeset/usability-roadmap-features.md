---
"@kitsunekode/run-cli": patch
---

Implemented usability features:

- Added `run completion <shell> --install` for automated shell-hook setup.
- Enforced a 500-entry LRU cache constraint on lookups and detections to prevent file size bloat.
- Prioritized `process.env.VISUAL` over `process.env.EDITOR` for config editing.
