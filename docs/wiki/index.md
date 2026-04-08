# Wiki Index

_Updated by Claude on every ingest. Read this first when querying the wiki._

## Modules

- [[obs-plugin]] — OBS plugin HTTP API, C source structure, thread-safety model, Electron transport
- [[recordingService]] — FFmpeg clip/trim/reencode operations, scan cache, auto-delete
- [[fileManager]] — Organize flow: OBS file unlock, remux, auto-clips, waveform trigger

## Edge Cases

- [[obs-audio-tracks-no-inputs]] — GetInputAudioTracks tests fail in headless OBS (no audio sources seeded); fix: ctx.skip()
- [[mkv-track-titles-lost]] — MKV audio stream titles not preserved during MP4 remux; fix: .tracks.json sidecar
- [[trim-two-phase-eperm]] — Trim rename fails while video element holds the file; fix: two-phase trimClip/finalizeTrim
- [[multi-track-clip-three-pass]] — Multi-track clip A/V drift; fix: base-cut intermediate → three ffmpeg passes
- [[reencode-atomic-swap]] — replaceOriginal reencode data loss; fix: .bak atomic swap with rollback
- [[trim-resume-position]] — Playback position lost after trim; fix: resumePositionRef translated into new timeline + path-equality guard
- [[trim-strictmode-double-finalize]] — React StrictMode fires trim-finalize effect twice; fix: cancelled flag + setTimeout(0) gate

## Decisions

- [[decision-800-line-limit]] — Why files are capped at 800 lines: context window efficiency for LLM agents

## Concepts

- [[codebase-overview]] — Two-app architecture, module inventory, 800-line rule, files currently over limit
- [[e2e-test-architecture]] — Playwright mock strategy, setupApiRoutes helper, --test-mode flag, fixture layout
- [[plugin-integration-harness]] — In-process HTTP mock harness, port override env vars, harness vs real-DLL boundary
- [[obs-plugin-install]] — Install paths, modules.json management, known gotchas (stale entry, OBS update breakage)
- [[video-processing-pipeline]] — Full pipeline: organize → auto-clip → clip creation → trim → reencode; all edge cases
- [[waveform-pipeline]] — Waveform pre-cache timing, deleteFullRecording ordering, cache key design
- [[frontend-clip-trim-flow]] — VideoPlayer clip/trim state machines, audio track selection logic, virtual trim UX
- [[frontend-waveform-loading]] — Chunked waveform delivery, viewport-priority queue, background cache population

## Sources

- [[llm-wiki]] — LLM wiki pattern document used to design this knowledge base (2026-04-08)
