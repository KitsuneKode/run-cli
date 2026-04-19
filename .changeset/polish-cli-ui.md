---
"@kitsunekode/run-cli": minor
---

Polish CLI UI with memory visibility, colors, and live monitoring

- `run ps` now shows memory usage by default (previously required `--details`)
- Color-coded process status: green (running), yellow (stopped), red (exited)
- Memory threshold warnings: yellow at 512MB, red at 1GB in the MEM column
- `run ps --watch` live-refreshes the process list every 2 seconds
- `run dashboard` shows real total memory across all processes
- Polished startup banners with cleaner arrow and colored labels
- CLI self-memory fail-fast check at 256MB heap usage
