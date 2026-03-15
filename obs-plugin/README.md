# OpenClip OBS Plugin

Native OBS Studio plugin that provides an HTTP API for the OpenClip desktop app.
Replaces the previous Lua script + WebSocket approach with a single, zero-config
integration point.

## What it does

- **Recording control** — start/stop recording, automatic scene switching per game
- **Scene management** — create, delete, duplicate scenes and sources
- **Audio routing** — manage audio inputs, track routing, and track names
- **Video info** — canvas resolution and FPS for source fitting

All functionality is exposed via a JSON API on `http://127.0.0.1:28756/api`.

## Building

### Prerequisites

| Tool | Version |
|------|---------|
| CMake | 3.16+ |
| C compiler | MSVC 2019+, GCC 11+, or Clang 14+ |
| OBS Studio SDK | 30.0+ (headers + libraries) |

### Windows (MSVC)

```powershell
# Point OBS_DIR to your OBS Studio install (or build output)
cmake -B build -S . -DOBS_DIR="C:\Program Files\obs-studio" -G "Visual Studio 17 2022"
cmake --build build --config Release
```

The output DLL is at `build/Release/openclip-obs.dll`.

### Linux

```bash
cmake -B build -S . -DOBS_DIR=/usr/include/obs
cmake --build build
```

### macOS

```bash
cmake -B build -S . -DOBS_DIR=/Applications/OBS.app/Contents/Resources
cmake --build build
```

## Installing

### Automatic (via OpenClip onboarding)

The OpenClip desktop app's setup wizard automatically copies the plugin DLL to
the correct OBS directory. No manual steps needed.

### Manual

Copy the built DLL into the OBS user plugins directory:

**Windows:**
```
%APPDATA%\obs-studio\plugins\openclip-obs\bin\64bit\openclip-obs.dll
```

**Linux:**
```
~/.config/obs-studio/plugins/openclip-obs/bin/64bit/openclip-obs.so
```

**macOS:**
```
~/Library/Application Support/obs-studio/plugins/openclip-obs/bin/openclip-obs.so
```

Restart OBS — the plugin loads automatically.

## API Reference

All requests are `POST /api` with a JSON body:

```json
{
  "method": "<methodName>",
  "params": { ... }
}
```

Responses:

```json
{
  "success": true,
  "data": { ... }
}
```

### Methods

| Method | Params | Description |
|--------|--------|-------------|
| `getStatus` | — | Plugin version, OBS version, recording state |
| `startRecording` | `sceneName?` | Start recording, optionally switch scene |
| `stopRecording` | — | Stop recording, restore previous scene |
| `getRecordingStatus` | — | Whether OBS is currently recording |
| `getScenes` | — | List all scene names |
| `createScene` | `sceneName` | Create an empty scene |
| `createSceneFromTemplate` | `sceneName`, `templateSceneName` | Create scene, copy sources from template |
| `createSceneFromScratch` | `sceneName`, `addWindowCapture?`, `windowTitle?`, `exe?`, `windowClass?`, `captureKind?`, `addDesktopAudio?`, `addMicAudio?` | Create scene with sources |
| `deleteScene` | `sceneName` | Delete a scene |
| `switchScene` | `sceneName` | Switch active scene |
| `getSceneItems` | `sceneName` | List items in a scene |
| `duplicateSceneItem` | `fromScene`, `sceneItemId`, `toScene` | Duplicate item between scenes |
| `addSource` | `sceneName`, `inputName`, `inputKind`, `inputSettings?`, `fitToCanvas?` | Add a source to a scene |
| `removeSceneItem` | `sceneName`, `sceneItemId` | Remove an item from a scene |
| `setItemTransform` | `sceneName`, `sceneItemId`, `transform` | Set item position/bounds |
| `getAudioInputs` | — | List all audio input sources |
| `getSceneAudioSources` | `sceneName` | List audio sources in a scene |
| `getInputAudioTracks` | `inputName` | Get track routing for an input |
| `setInputAudioTracks` | `inputName`, `tracks` | Set track routing. `tracks` is an object with string keys (track indexes `"1"`–`"6"`) and boolean values indicating whether routing is enabled, e.g. `{"1": true, "2": true, "3": false, "4": false, "5": false, "6": false}` |
| `getTrackNames` | — | Get profile track names (array of 6 strings) |
| `setTrackNames` | `names` | Set profile track names |
| `getVideoSettings` | — | Canvas resolution and FPS |

## Health Check

`GET /` or `GET /health` returns the plugin status (same as `getStatus`).

## Architecture

```
┌──────────────┐        HTTP (localhost)        ┌──────────────────┐
│  OpenClip    │  ──────────────────────────►   │  openclip-obs    │
│  Electron    │  POST /api { method, params }  │  OBS Plugin      │
│  Desktop App │  ◄──────────────────────────   │                  │
│              │  { success, data }              │  OBS C API calls │
└──────────────┘                                └──────────────────┘
```

The plugin runs an HTTP server on a background thread, bound to `127.0.0.1`.
API requests are dispatched to OBS's UI thread via `obs_queue_task()` to ensure
thread-safe access to all OBS APIs.

## Source Code

See [`src/README.md`](src/README.md) for the source code structure and documentation.

### Dependencies

| Folder | Description |
|--------|-------------|
| `src/` | Plugin source code |
| `include/` | OBS Studio SDK headers |
| `build/` | CMake build output |
