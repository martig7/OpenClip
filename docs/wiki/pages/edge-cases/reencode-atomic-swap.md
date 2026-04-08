---
type: edge-case
tags: [recordingService, reencode, replaceOriginal, atomic, bak]
updated: 2026-04-08
sources: 0
---

# Edge Case: Re-encode Replace-Original Atomic Swap

**Trigger:** User re-encodes a clip/recording with `replaceOriginal: true`.
**Symptom:** (Without the fix) A failed rename could leave the user with no file at all — the original deleted and the temp rename failed.
**Root Cause:** Two separate renames are needed: original → backup, temp → original. Either can fail (EPERM, ENOSPC). If the second fails after the first succeeded, the original is gone.
**Fix:** `reencodeVideo` uses an atomic three-step swap with rollback:

1. `renameSync(original, original.bak)` — backs up original
   - If this fails → abort immediately; original is still at its path
2. `renameSync(tempEncode, original)` — places the new encode
   - If this fails → `renameSync(original.bak, original)` to restore the backup
3. `unlinkSync(original.bak)` — removes the backup
   - If this fails, the `.bak` file lingers but nothing is lost; it is not re-attempted

`renameWithRetry` is used for both renames (3 attempts × 500ms backoff) to handle transient EBUSY from video players briefly holding the file after playback.

**Prevention:** Any code touching `replaceOriginal` must follow this same pattern. The `.bak` file should be included in any future disk-space calculation for re-encode operations.

## Related

- [[recordingService]]
- [[video-processing-pipeline]]
