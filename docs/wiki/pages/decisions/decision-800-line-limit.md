---
type: decision
tags: [architecture, file-size, agents, context-window]
updated: 2026-04-08
sources: 0
---

# Decision: 800-Line File Size Limit

**Date:** 2026-04-08  
**Status:** Active

## Context

OpenClip is developed with LLM agents as first-class contributors. Every file an agent reads consumes tokens from its context window. A large file forces the agent to either load the whole thing (burning context that could hold other relevant files) or work with a partial view and miss important details. Both outcomes degrade quality.

Beyond agent ergonomics, large files are harder for humans to navigate and tend to accumulate mixed responsibilities — a file that does too much is a file that's hard to change safely.

## Decision

No source file should exceed **800 lines**. Files approaching this threshold are candidates for extraction; files over it are technical debt to be paid down.

The limit is a soft rule, not a hard build gate. Violations don't fail CI — but they are tracked and should be addressed when touching those files.

## Reasoning

- **Context window efficiency:** An 800-line file is roughly 20–25 KB of source — manageable in a single agent read without crowding out other context. Files like `VideoPlayer.jsx` at 1,207 lines consume nearly 3× more context budget than necessary and often force agents to re-read sections or lose track of earlier code.
- **Single responsibility:** Large files reliably indicate mixed concerns. `fileManager.js` at 950 lines manages file organization, week-folder logic, move operations, and recording metadata — responsibilities that could be separated. Splitting forces clearer interfaces.
- **Reliable edits:** Agents produce more accurate edits on focused files. When a file can be held in context in its entirety, the agent can reason about interactions between all its parts. Partial context leads to missed side effects.
- **The ipcHandlers.js refactor is the model:** `ipcHandlers.js` was reduced from ~659 lines to 89 by extracting per-domain handlers (`gameHandlers.js`, `obsHandlers.js`, `recordingHandlers.js`, `shareHandlers.js`, `watcherHandlers.js`, `windowHandlers.js`). The result is a thin dispatcher with focused, independently-understandable handler files.

## Current Violations (as of 2026-04-08)

| File | Lines | Notes |
|------|------:|-------|
| `src/viewer/components/VideoPlayer.jsx` | 1,207 | Highest priority — video player + trim timeline + waveform + playback state all in one file |
| `electron/fileManager.js` | 950 | File ops, week-folder logic, recording metadata — separable concerns |
| `electron/recordingService.js` | 932 | Recording lifecycle, clip numbering, timestamp handling |

Files near the limit (700–800):
| File | Lines |
|------|------:|
| `src/pages/SettingsPage.jsx` | 707 |
| `src/pages/GamesPage.jsx` | 677 |
| `electron/winUtils.js` | 655 |

## Consequences

- When adding new functionality to a file already over 800 lines, prefer to extract first, then add — rather than growing the file further.
- The `shrink-codebase` skill is available in Claude Code to assist with extraction refactors.
- `VideoPlayer.jsx` is the most urgent candidate: at 1,207 lines it contains trim timeline logic, waveform rendering, playback state management, and UI controls — all extractable to focused components.

## Related

- [[codebase-overview]]
- [[VideoPlayer]] _(not yet created)_
- [[fileManager]] _(not yet created)_
