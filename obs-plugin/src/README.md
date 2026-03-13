# OpenClip OBS Plugin — Source

This folder contains the C source code for the OpenClip OBS Studio plugin.

## Structure

| File | Lines | Description |
|------|------:|-------------|
| `plugin-main.c` | — | Plugin entry point, OBS hooks |
| `http-server.c` | 498 | HTTP server, JSON-RPC dispatcher |
| `http-server.h` | — | HTTP server declarations |
| `api-handlers.c` | 136 | Main API dispatch, method routing |
| `api-handlers.h` | 24 | Public API dispatch declaration |
| `api-utils.c` | 113 | Shared utilities (JSON helpers, OBS helpers) |
| `api-utils.h` | 26 | Utility declarations |
| `recording-handlers.c` | 89 | Recording control (start/stop/status) |
| `recording-handlers.h` | 16 | Recording handler declarations |
| `scene-handlers.c` | 362 | Scene management (create/delete/switch/duplicate) |
| `scene-handlers.h` | 21 | Scene handler declarations |
| `source-handlers.c` | 173 | Source management (add/remove/transform) |
| `source-handlers.h` | 11 | Source handler declarations |
| `audio-handlers.c` | 191 | Audio routing and track names |
| `audio-handlers.h` | 13 | Audio handler declarations |
| `video-handlers.c` | 25 | Video settings (resolution/FPS) |
| `video-handlers.h` | 9 | Video handler declarations |

## Architecture

```
http-server.c          →  Receives HTTP requests, parses JSON
       ↓
api-handlers.c         →  Dispatches to handler modules
       ↓
recording-handlers.c   →  OBS recording API
scene-handlers.c       →  OBS scene/source API  
source-handlers.c      →  OBS source/item API
audio-handlers.c       →  OBS audio/mixer API
video-handlers.c       →  OBS video API
       ↓
api-utils.c            →  Shared utilities
```

All OBS API calls run on OBS's UI thread via `obs_queue_task()` for thread safety.

## Key Concepts

### Response Format
All handlers return cJSON objects with the structure:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "..." }
```

### Thread Safety
The HTTP server runs on a background thread. All OBS API calls must execute on the UI thread. The `api_dispatch()` function handles this automatically via `obs_queue_task()`.

### Handler Modules
Each handler module (recording, scene, source, audio, video) is self-contained and includes:
- Header file with handler function declarations
- Implementation file with all related handlers

New handlers should be added to the appropriate module based on their function.

## Dependencies

- **OBS Studio SDK** — `obs-module.h`, `obs-frontend-api.h`, `obs.h`
- **cJSON** — JSON parsing and generation

## Building

The plugin is built via CMake. See the parent `README.md` for build instructions.

## See Also

- [Plugin README](../README.md) — Full plugin documentation
- [PluginInstall.md](../PluginInstall.md) — Installation instructions
