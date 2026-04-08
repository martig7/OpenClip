---
type: edge-case
tags: [VideoPlayer, trim, react, strictmode, finalize]
updated: 2026-04-08
sources: 0
---

# Edge Case: React StrictMode Fires Trim-Finalize Effect Twice

**Trigger:** Development mode with React StrictMode enabled; `trimFinalizePath` and `suppressVideoSrc` are set, triggering the finalize effect.
**Symptom:** Two simultaneous `POST /api/clips/trim-finalize` requests fire. The second one arrives while the backend's rename loop is still running (or after it has already succeeded), causing a confusing error or double-state-clear.
**Root Cause:** React StrictMode intentionally mounts/unmounts effects twice in development to surface side-effect bugs. The finalize effect (`useEffect` on `[trimFinalizePath, suppressVideoSrc]`) would run, be cleaned up, and run again — dispatching two concurrent fetch calls.

**Fix:** The effect captures a `cancelled` boolean in its closure and sets it in the cleanup function:
```js
let cancelled = false
// ...
await new Promise(resolve => setTimeout(resolve, 0)) // one tick
if (cancelled) return  // StrictMode second invocation aborts here
```
The one-tick delay (`setTimeout(0)`) before the fetch gives React time to invoke the cleanup (setting `cancelled = true`) if a re-mount is happening. In production there is no double-mount, so the delay is harmless.

**Prevention:** Any effect that triggers a destructive one-shot IPC call (rename, delete, finalize) must guard with a `cancelled` flag and check it *after* any async wait, not just at the start.

## Related

- [[frontend-clip-trim-flow]]
- [[edge-case-trim-two-phase]]
