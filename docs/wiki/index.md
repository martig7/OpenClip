# Wiki Index

_Updated by Claude on every ingest. Read this first when querying the wiki._

## Modules

- [[obs-plugin]] — OBS plugin HTTP API, C source structure, thread-safety model, Electron transport

## Edge Cases

- [[obs-audio-tracks-no-inputs]] — GetInputAudioTracks tests fail in headless OBS (no audio sources seeded); fix: ctx.skip()

## Decisions

- [[decision-800-line-limit]] — Why files are capped at 800 lines: context window efficiency for LLM agents

## Concepts

- [[codebase-overview]] — Two-app architecture, module inventory, 800-line rule, files currently over limit
- [[e2e-test-architecture]] — Playwright mock strategy, setupApiRoutes helper, --test-mode flag, fixture layout
- [[plugin-integration-harness]] — In-process HTTP mock harness, port override env vars, harness vs real-DLL boundary
- [[obs-plugin-install]] — Install paths, modules.json management, known gotchas (stale entry, OBS update breakage)

## Sources

- [[llm-wiki]] — LLM wiki pattern document used to design this knowledge base (2026-04-08)
