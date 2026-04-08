---
type: edge-case
tags: [recordingService, trim, eperm, video-element, finalizeTrim]
updated: 2026-04-08
sources: 0
---

# Edge Case: Trim Fails to Rename Temp File (Two-Phase Design)

**Trigger:** User trims a clip while the Electron `<video>` element is still displaying it.
**Symptom:** `finalizeTrim` gets EPERM / EBUSY when trying to rename `.tmp.mp4` over the original.
**Root Cause:** The HTML `<video>` element holds an OS read handle on the file it is streaming. On Windows, a file with an open read handle cannot be renamed over another file (EPERM).
**Fix:** Trim is deliberately two-phase:
1. `trimClip` — ffmpeg writes to `{source}.tmp.mp4`. Returns when ffmpeg exits.
2. Frontend receives the `ready` signal, clears its `<video src="">`, waits for the element to release the handle.
3. `finalizeTrim` — renames `.tmp.mp4` over the original. Polls on EPERM/EBUSY with 50ms gaps. **No attempt cap** — the OS will always eventually release the handle once the element's src is cleared.

After the rename, the original mtime is restored via `fs.utimesSync` so the trimmed clip doesn't sort to the top of same-day listings.

**Prevention:** Never call `finalizeTrim` before the frontend has cleared its `<video>` src. If the main process restarts between phases, the `.tmp.mp4` orphan must be cleaned up manually — there is no recovery on restart.

## Related

- [[recordingService]]
- [[video-processing-pipeline]]
