# Codebase Structure

Two applications: `electron-app/` (Electron + React desktop app) and `obs-plugin/` (native OBS Studio C plugin).

**Target: no file should exceed 800 lines.**

---

## Backend — `electron-app/electron/`

| File | Lines |
|------|------:|
| `fileManager.js` | 784 |
| `ipcHandlers.js` | 659 |
| `recordingService.js` | 597 |
| `obsWebSocket.js` | 490 |
| `apiServer.js` | 473 |
| `obsPlugin.js` | 365 |
| `obsWsAudio.js` | 349 |
| `store.js` | 284 |
| `autoUpdater.js` | 280 |
| `main.js` | 299 |
| `obsEncoding.js` | 199 |
| `gameWatcher.js` | 172 |
| `preload.js` | 165 |
| `qrCodeReader.js` | 124 |
| `processDetector.js` | 84 |
| `constants.js` | 83 |
| `winUtils.js` | 619 |
| `elevatedHelper.js` | 69 |
| `videoMetadata.js` | 70 |
| `obsIntegration.js` | 59 |
| `runElevated.js` | 23 |
| `iniParser.js` | 26 |
| `markerService.js` | 21 |

Testing stubs (required by Jest module mapping — not imported by production code):

| File | Lines |
|------|------:|
| `tests/e2e/integration/global-setup.js` | 66 |
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
| `pages/GamesPage.jsx` | 790 |
| `pages/games/GameList.jsx` | 59 |
| `pages/games/GamesPageBody.jsx` | 92 |
| `pages/games/EditGameModal.jsx` | 327 |
| `pages/games/SceneAudioSourcesSection.jsx` | 602 |
| `pages/SettingsPage.jsx` | 621 |
| `viewer/components/VideoPlayer.jsx` | 727 |
| `pages/games/AddGameModal.jsx` | 619 |
| `viewer/components/StorageTreemap.jsx` | 520 |
| `viewer/pages/StoragePage.jsx` | 501 |
| `viewer/components/StorageList.jsx` | 480 |
| `viewer/components/ZoomTimeline.jsx` | 398 |
| `pages/games/SceneAudioSourcesCard.jsx` | 656 |
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
| `unit/obsWebSocket.testHelper.js` | 127 |
| `unit/obsWebSocket.createSceneFromScratch.test.js` | 358 |
| `unit/obsWebSocket.addAudioSourceToScenes.test.js` | 106 |
| `unit/obsWebSocket.getOBSScenes.test.js` | 25 |
| `unit/obsWebSocket.createSceneFromTemplate.test.js` | 107 |
| `unit/obsWebSocket.testOBSConnection.test.js` | 22 |
| `unit/obsWebSocket.getOBSAudioInputs.test.js` | 41 |
| `unit/obsWebSocket.getSceneAudioSources.test.js` | 68 |
| `unit/obsWebSocket.getInputAudioTracks.test.js` | 33 |
| `unit/obsWebSocket.setInputAudioTracks.test.js` | 33 |
| `unit/obsWebSocket.getTrackNames.test.js` | 41 |
| `unit/obsWebSocket.setTrackNames.test.js` | 35 |
| `unit/obsWebSocket.removeAudioSourceFromScenes.test.js` | 49 |
| `unit/obsWebSocket.deleteOBSScene.test.js` | 36 |
| `unit/fileManager.getWeekFolder.test.js` | 54 |
| `unit/fileManager.organizeRecordings.test.js` | 376 |
| `unit/fileManager.organizeSpecificRecording.test.js` | 412 |
| `unit/fileManager.setupFileManager.test.js` | 87 |
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
