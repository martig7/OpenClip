# Codebase Structure

Current file sizes and guidance for merging branches into the modularized codebase.

## Overview

This repository contains two main applications:

1. **Electron App** (`electron-app/`) — Desktop application for game recording management
2. **OBS Plugin** (`obs-plugin/`) — Native OBS Studio plugin providing HTTP API

---

## Current File Sizes

### OBS Plugin — `obs-plugin/`

The OBS plugin provides a JSON HTTP API for controlling OBS Studio. See [`obs-plugin/README.md`](obs-plugin/README.md) for full documentation.

| File | Lines |
|------|------:|
| `obs-plugin/src/scene-handlers.c` | 362 |
| `obs-plugin/src/audio-handlers.c` | 191 |
| `obs-plugin/src/source-handlers.c` | 173 |
| `obs-plugin/src/http-server.c` | 498 |
| `obs-plugin/src/api-handlers.c` | 136 |
| `obs-plugin/src/api-utils.c` | 113 |
| `obs-plugin/src/recording-handlers.c` | 89 |
| `obs-plugin/src/video-handlers.c` | 25 |

See [`obs-plugin/src/README.md`](obs-plugin/src/README.md) for complete source documentation.

---

### Frontend — `electron-app/src/`

| File | Lines |
|------|------:|
| `src/pages/GamesPage.jsx` | 720 |
| `src/components/OnboardingSteps.jsx` | 498 |
| `src/viewer/pages/StoragePage.jsx` | 584 |
| `src/pages/games/EditGameModal.jsx` | 574 |
| `src/pages/SettingsPage.jsx` | 489 |
| `src/components/OnboardingModal.jsx` | 213 |
| `src/pages/games/AddGameModal.jsx` | 482 |
| `src/viewer/components/VideoPlayer.jsx` | 453 |
| `src/viewer/components/ZoomTimeline.jsx` | 398 |
| `src/viewer/components/StorageTreemap.jsx` | 406 |
| `src/pages/games/SceneAudioSourcesCard.jsx` | 347 |
| `src/pages/EncodingPage.jsx` | 331 |
| `src/viewer/pages/ClipsPage.jsx` | 165 |
| `src/pages/games/audioSourceUtils.jsx` | 153 |
| `src/viewer/components/Timeline.jsx` | 148 |
| `src/viewer/utils/treemapUtils.js` | 145 |
| `src/App.jsx` | 137 |
| `src/pages/games/WatcherStatusCard.jsx` | 131 |
| `src/viewer/pages/RecordingsPage.jsx` | 107 |
| `src/viewer/components/Sidebar.jsx` | 94 |
| `src/pages/games/AudioSourceDropdown.jsx` | 91 |
| `src/viewer/components/ClipControls.jsx` | 84 |
| `src/pages/games/WindowPicker.jsx` | 68 |
| `src/viewer/components/AudioWaveformTrack.jsx` | 79 |
| `src/api.js` | 74 |
| `src/hooks/useAddGameModalState.js` | 55 |
| `src/components/ConfirmDeleteDialog.jsx` | 51 |
| `src/viewer/apiBase.js` | 49 |
| `src/hooks/useAudioSourcesState.js` | 44 |
| `src/viewer/utils/storageColors.js` | 38 |
| `src/viewer/components/ReencodeModal.jsx` | 103 |
| `src/hooks/useTrackState.js` | 29 |
| `src/hooks/useGameWatcherState.js` | 27 |
| `src/hooks/useToastState.js` | 26 |
| `src/viewer/components/Modal.jsx` | 25 |
| `src/main.jsx` | 10 |
| `src/viewer/utils.js` | 6 |

### Backend — `electron-app/electron/`

| File | Lines |
|------|------:|
| `electron/obsWebSocket.js` | 743 |
| `electron/ipcHandlers.js` | 727 |
| `electron/recordingService.js` | 478 |
| `electron/apiServer.js` | 424 |
| `electron/obsPlugin.js` | 365 |
| `electron/fileManager.js` | 335 |
| `electron/autoUpdater.js` | 275 |
| `electron/store.js` | 266 |
| `electron/main.js` | 204 |
| `electron/obsEncoding.js` | 198 |
| `electron/gameWatcher.js` | 167 |
| `electron/preload.js` | 132 |
| `electron/qrCodeReader.js` | 124 |
| `electron/processDetector.js` | 84 |
| `electron/constants.js` | 83 |
| `electron/videoMetadata.js` | 78 |
| `electron/obsIntegration.js` | 59 |
| `electron/iniParser.js` | 26 |
| `electron/markerService.js` | 21 |

### OBS Plugin — `obs-plugin/src/`

| File | Lines |
|------|------:|
| `src/scene-handlers.c` | 362 |
| `src/audio-handlers.c` | 191 |
| `src/source-handlers.c` | 173 |
| `src/api-handlers.c` | 136 |
| `src/api-utils.c` | 113 |
| `src/recording-handlers.c` | 89 |
| `src/video-handlers.c` | 25 |
| `src/api-handlers.h` | 24 |
| `src/scene-handlers.h` | 21 |
| `src/audio-handlers.h` | 13 |
| `src/source-handlers.h` | 11 |
| `src/api-utils.h` | 26 |
| `src/recording-handlers.h` | 16 |
| `src/video-handlers.h` | 9 |

**Target: no file should exceed 800 lines.**

---

## Merging Other Branches into This Refactor

The modularization work lives on `claude/modularize-codebase-RxYHm`. If you have feature branches that branched off `master` or `main` before this refactor, the steps below will bring them up to date.

### 1. Fetch the latest state

```bash
git fetch origin
```

### 2. Rebase your feature branch onto the refactor branch

```bash
git checkout your-feature-branch
git rebase origin/claude/modularize-codebase-RxYHm
```

Rebase is preferred over merge here because it keeps the history linear and surfaces conflicts one commit at a time.

### 3. Resolve conflicts

The most likely conflict sites, and what to expect:

| File | What changed in the refactor |
|------|------------------------------|
| `src/pages/GamesPage.jsx` | Reduced from 1,483 → 759 lines. The add-game modal JSX was moved to `AddGameModal.jsx`, the audio sources card to `SceneAudioSourcesCard.jsx`. If your branch touched either of those sections, move the changes into the new extracted files instead. |
| `src/viewer/pages/StoragePage.jsx` | Reduced from 1,036 → 652 lines. All canvas/treemap rendering moved to `StorageTreemap.jsx`. If your branch touched the canvas drawing logic, apply those changes to `StorageTreemap.jsx`. |
| `electron/main.js` | Previously held store and IPC handler code that was extracted into `electron/store.js` and `electron/ipcHandlers.js` in an earlier commit on this branch. |
| `electron/apiServer.js` | Marker and video-metadata logic extracted to `electron/markerService.js` and `electron/videoMetadata.js`. |

When resolving, keep **your feature's intent** and apply it to whichever new file now owns that responsibility.

### 4. Run the tests after resolving

```bash
cd electron-app && npm test
```

All 351 tests must pass before the branch is considered ready.

### 5. Push your rebased branch

```bash
git push --force-with-lease origin your-feature-branch
```

`--force-with-lease` is safer than `--force`; it refuses to push if someone else has pushed to the branch since you last fetched.

---

## Merging the Refactor into `main` / `master`

Once the refactor branch is reviewed and approved:

```bash
git checkout main
git merge --no-ff origin/claude/modularize-codebase-RxYHm -m "merge: modularize codebase — reduce all files to ≤800 lines"
git push origin main
```

Use `--no-ff` to preserve the merge commit so the refactor is clearly identifiable in history.

---

## Guidelines for Future Development

- **800-line limit**: Keep every file at or below 800 lines. If a file is approaching the limit, extract a focused sub-component or utility before adding more code.
- **Single responsibility**: Each file should have one clear reason to change — a single page, one modal, one hook, one utility module.
- **No barrel re-exports needed**: All existing test imports reference the original file paths, which have not changed. Do not add index.js barrel files unless a genuine public API is being created.
