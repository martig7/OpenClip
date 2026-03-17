# Codebase Structure

Two applications: `electron-app/` (Electron + React desktop app) and `obs-plugin/` (native OBS Studio C plugin).

**Target: no file should exceed 800 lines.**

---

## Backend — `electron-app/electron/`

| File | Lines |
|------|------:|
| `fileManager.js` | 646 |
| `ipcHandlers.js` | 548 |
| `recordingService.js` | 520 |
| `obsWebSocket.js` | 452 |
| `apiServer.js` | 427 |
| `obsPlugin.js` | 365 |
| `obsWsAudio.js` | 349 |
| `store.js` | 284 |
| `autoUpdater.js` | 280 |
| `main.js` | 262 |
| `obsEncoding.js` | 199 |
| `gameWatcher.js` | 172 |
| `preload.js` | 165 |
| `qrCodeReader.js` | 124 |
| `processDetector.js` | 84 |
| `constants.js` | 83 |
| `winUtils.js` | 577 |
| `elevatedHelper.js` | 69 |
| `videoMetadata.js` | 70 |
| `obsIntegration.js` | 59 |
| `runElevated.js` | 23 |
| `iniParser.js` | 26 |
| `markerService.js` | 21 |

Testing stubs (required by Jest module mapping — not imported by production code):

| File | Lines |
|------|------:|
| `store-testing.js` | 247 |
| `obsPlugin-testing.js` | 288 |
| `ipcHandlers-testing.js` | 213 |
| `apiServer-testing.js` | 130 |
| `gameWatcher-testing.js` | 119 |
| `processDetector-testing.js` | 57 |
| `obsIntegration-testing.js` | 39 |

---

## Frontend — `electron-app/src/`

| File | Lines |
|------|------:|
| `pages/GamesPage.jsx` | 723 |
| `pages/games/EditGameModal.jsx` | 579 |
| `pages/SettingsPage.jsx` | 515 |
| `viewer/components/VideoPlayer.jsx` | 489 |
| `pages/games/AddGameModal.jsx` | 487 |
| `viewer/components/StorageTreemap.jsx` | 440 |
| `viewer/pages/StoragePage.jsx` | 431 |
| `viewer/components/StorageList.jsx` | 418 |
| `viewer/components/ZoomTimeline.jsx` | 398 |
| `pages/games/SceneAudioSourcesCard.jsx` | 347 |
| `pages/EncodingPage.jsx` | 331 |
| `viewer/components/Sidebar.jsx` | 191 |
| `viewer/pages/ClipsPage.jsx` | 177 |
| `pages/games/audioSourceUtils.jsx` | 153 |
| `viewer/components/Timeline.jsx` | 148 |
| `viewer/utils/treemapUtils.js` | 145 |
| `viewer/pages/RecordingsPage.jsx` | 137 |
| `pages/games/WatcherStatusCard.jsx` | 132 |
| `App.jsx` | 263 |
| `api.js` | 107 |
| `viewer/components/ReencodeModal.jsx` | 103 |
| `pages/games/AudioSourceDropdown.jsx` | 91 |
| `viewer/components/ClipControls.jsx` | 84 |
| `viewer/components/AudioWaveformTrack.jsx` | 79 |
| `pages/games/WindowPicker.jsx` | 68 |
| `viewer/apiBase.js` | 49 |
| `hooks/useAddGameModalState.js` | 55 |
| `hooks/useAudioSourcesState.js` | 44 |
| `hooks/useTrackState.js` | 29 |
| `hooks/useGameWatcherState.js` | 27 |
| `hooks/useToastState.js` | 26 |
| `viewer/utils/storageColors.js` | 38 |
| `viewer/components/Modal.jsx` | 25 |
| `main.jsx` | 10 |
| `viewer/utils.js` | 6 |

---

## OBS Plugin — `obs-plugin/src/`

See [`obs-plugin/README.md`](obs-plugin/README.md) for the full API reference.

| File | Lines |
|------|------:|
| `http-server.c` | 498 |
| `scene-handlers.c` | 366 |
| `audio-handlers.c` | 194 |
| `source-handlers.c` | 173 |
| `plugin-main.c` | 155 |
| `api-handlers.c` | 136 |
| `api-utils.c` | 122 |
| `recording-handlers.c` | 69 |
| `video-handlers.c` | 27 |
| `http-server.h` | 46 |
| `api-utils.h` | 30 |
| `api-handlers.h` | 24 |
| `scene-handlers.h` | 23 |
| `audio-handlers.h` | 21 |
| `recording-handlers.h` | 18 |
| `source-handlers.h` | 17 |
| `video-handlers.h` | 15 |

---

## Tests — `electron-app/tests/`

| File | Lines |
|------|------:|
| `unit/obsWebSocket.test.js` | 999 |
| `unit/fileManager.test.js` | 844 |
| `unit/recordingService.test.js` | 544 |
| `unit/elevatedHelper.test.js` | 300 |
| `unit/moveFileSafe.test.js` | 283 |
| `unit/autoUpdater.test.js` | 278 |
| `unit/obsPlugin.test.js` | 244 |
| `unit/gameWatcher.test.js` | 214 |
| `unit/obsIntegration.test.js` | 168 |
| `unit/bundleDependencies.test.js` | 133 |
| `unit/release.test.js` | 130 |
| `unit/winUtils.smoke.test.js` | 118 |
| `unit/runElevated.test.js` | 87 |
| `unit/resilience.test.js` | 83 |
| `unit/iniParser.test.js` | 83 |
| `unit/ipc.test.js` | 60 |
| `unit/utils.test.js` | 44 |

See [`tests/e2e/README.md`](electron-app/tests/e2e/README.md) for E2E test mock architecture.
