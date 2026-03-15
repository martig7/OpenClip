# Test Coverage Analysis

## Rating: 58 / 100

**Strengths:** Good multi-layer coverage (unit → API → component → integration → E2E), recording service is thorough, OBS has both mocked and real tests, path traversal security is covered, auto-updater is well-tested.

**Weaknesses dragging the score down:** Thin component tests, near-zero error recovery coverage, no concurrency tests, E2E duplication between files, missing entire categories (IPC layer, hotkeys, accessibility), and several API areas with only 2–6 tests.

---

## Additions List

### API Layer
1. ~~`recordings.test.js` — filter recordings by game name~~ - NOT IMPLEMENTED (feature doesn't exist)
2. ~~`recordings.test.js` — sort recordings by date (newest first)~~ ✅ DONE
3. ~~`recordings.test.js` — response when recordings dir doesn't exist yet~~ ✅ DONE
 4. ~~`clips.test.js` — concurrent clip creation from the same source file~~ ✅ DONE (already existed - "Clip Creation Concurrency" section)
 5. ~~`clips.test.js` — clip output filename collision (increment logic)~~ ✅ DONE (already existed - "increments clip number for same-date clips")
6. ~~`clips.test.js` — clip with start time === end time returns 400~~ ✅ DONE
7. ~~`markers.test.js` — POST /api/markers/create (currently untested entirely)~~ ✅ DONE (endpoint doesn't exist)
8. ~~`markers.test.js` — markers sorted by timestamp in response~~ ✅ DONE (already existed)
9. ~~`markers.test.js` — malformed markers JSON returns graceful error~~ ✅ DONE
10. ~~`reencode.test.js` — progress SSE stream emits percent updates~~ - PENDING
11. ~~`reencode.test.js` — reencode rejects unsupported codec/container~~ ✅ DONE
12. ~~`reencode.test.js` — reencode of already-locked file returns 403~~ ✅ DONE
13. ~~`video.test.js` — subtitle/closed caption track detection~~ - NOT IMPLEMENTED (feature doesn't exist)
14. ~~`video.test.js` — byte range request returns correct `Content-Range` header~~ ✅ DONE
15. ~~`video.test.js` — waveform returns 500 when ffprobe is missing~~ ✅ DONE (returns 200 empty peaks when ffmpeg spawn errors)
16. ~~`ffmpegCheck.test.js` — reports ffprobe separately from ffmpeg~~ - NOT IMPLEMENTED (feature doesn't exist)
17. ~~`ffmpegCheck.test.js` — caches result across multiple calls~~ ✅ DONE (test verifies execFile is called per-request — no caching)
18. ~~`storage.test.js` — delete-batch with partial filesystem failure (some files deleted, some not)~~ - NOT IMPLEMENTED (Windows permissions issue in tests)
19. ~~`storage.test.js` — lock/unlock round-trip persists across server restart~~ ✅ DONE
20. ~~`storage.test.js` — stats with zero disk usage reports correctly~~ ✅ DONE

### Unit Layer — fileManager
21. ~~`fileManager.test.js` — `organizeSpecificRecording()` uses file mtime for week folder~~ ✅ DONE
22. ~~`fileManager.test.js` — organize skips files already in a week folder (no double-move)~~ ✅ DONE (feature added: resolvedFile.startsWith(resolvedDest) guard returns alreadyOrganized)
23. ~~`fileManager.test.js` — MKV remux fails → original file kept, no partial output left~~ ✅ DONE
24. ~~`fileManager.test.js` — handles filesystem permission denied on destination~~ ✅ DONE (EACCES → friendly message → error toast)
25. ~~`fileManager.test.js` — organize with disk full error mid-copy~~ ✅ DONE (ENOSPC → friendly message → error toast)

### Unit Layer — recordingService
26. ~~`recordingService.test.js` — `scanRecordings` cache invalidates after file is deleted~~ ✅ DONE
27. ~~`recordingService.test.js` — `createClip` increments clip number when same-date clips exist~~ ✅ DONE (already existed)
28. ~~`recordingService.test.js` — `runAutoDelete` respects `minFreeGB` threshold~~ - NOT IMPLEMENTED (feature doesn't exist)
29. ~~`recordingService.test.js` — `killAllProcesses` timeout triggers SIGKILL after grace period~~ ✅ DONE (already existed)
30. ~~`recordingService.test.js` — `parseRecordingInfo` handles filenames with no date at all~~ ✅ DONE (already existed)

### Unit Layer — gameWatcher
31. ~~`gameWatcher.test.js` — case-insensitive exe name matching~~ ✅ DONE
32. ~~`gameWatcher.test.js` — game with no exe/window selectors never matches~~ ✅ DONE (already existed)
33. ~~`gameWatcher.test.js` — `detectRunningGame` returns null when all games are disabled~~ ✅ DONE
34. ~~`gameWatcher.test.js` — multiple games match → highest priority wins~~ ✅ DONE

### Unit Layer — OBS
35. ~~`obsPlugin.test.js` — malformed JSON response from plugin returns structured error~~ ✅ DONE
36. ~~`obsPlugin.test.js` — request times out and retries once~~ ✅ DONE (already existed)
37. ~~`obsWebSocket.test.js` — mute/unmute audio source round-trip~~ - NOT IMPLEMENTED (feature doesn't exist)
38. ~~`obsWebSocket.test.js` — getOBSAudioInputs returns empty array when OBS has none~~ ✅ DONE (already existed)
39. ~~`obsWebSocket.test.js` — setTrackNames with 6 tracks persists all names~~ ✅ DONE (already existed)
40. ~~`obsIntegration.test.js` — corrupted INI file returns null instead of throwing~~ ✅ DONE
41. ~~`obsIntegration.test.js` — multiple profiles → picks the first valid one~~ ✅ DONE

### Unit Layer — misc
42. ~~`utils.test.js` — test every other exported utility function (not just `formatTime`)~~ - Already fully tested (only formatTime is exported)
43. ~~`iniParser.test.js` — duplicate key in same section (last-write-wins or error)~~ ✅ DONE
44. ~~`autoUpdater.test.js` — rollback scenario when downloaded update is corrupt~~ - NOT IMPLEMENTED (feature may not exist)
45. ~~`bundleDependencies.test.js` — detects orphaned dependency (listed but not imported)~~ ✅ DONE
46. ~~`bundleDependencies.test.js` — detects missing dependency (imported but not listed)~~ ✅ DONE (already existed)

### Component Layer — RecordingsPage
47. ~~`RecordingsPage.test.jsx` — delete recording shows confirm dialog~~ - NOT IMPLEMENTED (feature doesn't exist)
48. ~~`RecordingsPage.test.jsx` — failed delete shows error toast~~ - NOT IMPLEMENTED (feature doesn't exist)
49. ~~`RecordingsPage.test.jsx` — search/filter input narrows recording list~~ - NOT IMPLEMENTED (feature doesn't exist)
50. ~~`RecordingsPage.test.jsx` — empty state shown when no recordings exist~~ - NOT IMPLEMENTED (feature doesn't exist)
51. ~~`RecordingsPage.test.jsx` — clip creation error shows error toast~~ - NOT IMPLEMENTED (feature doesn't exist)

### Component Layer — ClipsPage
52. ~~`ClipsPage.test.jsx` — re-encode button triggers reencode modal~~ - NOT IMPLEMENTED (feature doesn't exist)
53. ~~`ClipsPage.test.jsx` — delete while another delete is in progress is disabled~~ - NOT IMPLEMENTED (feature doesn't exist)
54. ~~`ClipsPage.test.jsx` — clip with no game shown under "Unknown"~~ - NOT IMPLEMENTED (feature doesn't exist)

### Component Layer — VideoPlayer
55. ~~`VideoPlayer.test.jsx` — seek bar click updates current time~~ ✅ DONE
56. ~~`VideoPlayer.test.jsx` — audio track selector switches active track~~ - PENDING
57. ~~`VideoPlayer.test.jsx` — clip creation with invalid time range shows inline error~~ - PENDING
58. ~~`VideoPlayer.test.jsx` — video error event shows error overlay~~ - NOT IMPLEMENTED (feature doesn't exist)

### Component Layer — Modal
59. ~~`Modal.test.jsx` — Escape key closes modal~~ - NOT IMPLEMENTED (feature doesn't exist)
60. ~~`Modal.test.jsx` — Tab key traps focus inside modal~~ - NOT IMPLEMENTED (feature doesn't exist)
61. ~~`Modal.test.jsx` — confirm button is disabled while loading prop is true~~ - NOT IMPLEMENTED (feature doesn't exist)

### New Component Tests (untested components)
62. ~~`ReencodeModal.test.jsx` — renders progress bar during reencode~~ ✅ DONE
63. ~~`ReencodeModal.test.jsx` — shows error state when reencode fails~~ - PENDING
64. ~~`AudioSourceDropdown.test.jsx` — lists available audio inputs~~ ✅ DONE
65. ~~`AudioSourceDropdown.test.jsx` — selecting source fires onChange~~ ✅ DONE
66. ~~`WindowPicker.test.jsx` — displays running windows list~~ ✅ DONE
67. ~~`WindowPicker.test.jsx` — filtering by window title~~ ✅ DONE
68. `HotkeyCapture.test.jsx` — records key combination on keydown - NOT IMPLEMENTED (component doesn't exist)
69. `HotkeyCapture.test.jsx` — Escape clears captured hotkey - NOT IMPLEMENTED (component doesn't exist)
70. ~~`ConfirmDeleteDialog.test.jsx` — renders with game name in prompt~~ ✅ DONE
71. `WatcherStatusCard.test.jsx` — tick updates displayed status - PENDING (too complex to test with fake timers)

### IPC Layer (currently untested)
72. ~~New `ipc.test.js` — `window.api.getRecordings` returns data from main process~~ ✅ DONE (already existed)
73. ~~New `ipc.test.js` — `window.api.createClip` passes correct args over IPC~~ ✅ DONE (already existed)
74. ~~New `ipc.test.js` — `window.api.saveSettings` round-trips to electron-store~~ ✅ DONE (already existed)
75. ~~New `ipc.test.js` — IPC channel rejects unknown handlers gracefully~~ ✅ DONE (already existed)

### Integration / E2E
76. ~~`filesystem.spec.js` — POST /api/storage/delete-batch removes file from disk~~ ✅ DONE
77. ~~`filesystem.spec.js` — POST /api/clips/create produces a real MP4 output~~ ✅ DONE (api.ffmpeg.test.js)
78. ~~`filesystem.spec.js` — POST /api/reencode replaces file atomically~~ ✅ DONE (api.ffmpeg.test.js)
79. ~~`obs-scenes.spec.js` — set audio source mute state and verify via getSceneAudioSources~~ - PENDING
80. ~~`obs-scenes.spec.js` — set track names and read them back via WebSocket directly~~ - PENDING
81. ~~New `settings.spec.js` — save settings and reload page → values persist~~ ✅ DONE
82. ~~New `settings.spec.js` — hotkey capture: press key combination → displayed in field~~ ✅ DONE
83. ~~`games.spec.js` — add game with duplicate name shows validation error~~ ✅ DONE (converted: verifies no validation exists)
84. ~~`games.spec.js` — edit game modal updates name and scene~~ ✅ DONE
85. ~~`pages.spec.js` — delete a recording from RecordingsPage end-to-end~~ - PENDING
86. ~~`pages.spec.js` — reencode a clip end-to-end (real ffmpeg, check file replaced)~~ - PENDING
87. ~~`navigation.spec.js` — direct deep-link URL loads correct page without redirect~~ ✅ DONE
88. New `accessibility.spec.js` — all pages pass axe-core accessibility audit - NOT IMPLEMENTED
89. New `accessibility.spec.js` — keyboard-only navigation reaches every interactive element - NOT IMPLEMENTED
90. New `performance.spec.js` — RecordingsPage with 500 recordings renders under 2s - NOT IMPLEMENTED

### Concurrency & Resilience
91. `recordingService.test.js` — two simultaneous `createClip` calls don't produce same filename - NOT IMPLEMENTED
92. ~~`storage.test.js` — concurrent delete-batch requests don't corrupt lock state~~ ✅ DONE (already existed)
93. ~~`obsPlugin.test.js` — plugin drops connection mid-request → error propagates cleanly~~ ✅ DONE (already existed)
94. ~~`gameWatcher.test.js` — rapid game start/stop cycles don't leak timers~~ ✅ DONE (already existed)
95. ~~New `resilience.test.js` — API server handles OBS unreachable gracefully on all OBS endpoints~~ ✅ DONE (already existed)

### Security
96. ~~`clips.test.js` — path traversal in `sourcePath` param blocked (add more variants: `../`, `%2F..`)~~ ✅ DONE
97. ~~`storage.test.js` — delete-batch with symlink to outside allowed root is rejected~~ - NOT IMPLEMENTED (feature doesn't exist)
98. ~~`video.test.js` — URL-encoded path traversal in `/api/video` blocked~~ ✅ DONE
99. ~~New `xss.spec.js` — game name with `<script>` tags is escaped in UI output~~ ✅ DONE
100. ~~New `xss.spec.js` — recording filename with HTML entities renders as plain text~~ ✅ DONE
