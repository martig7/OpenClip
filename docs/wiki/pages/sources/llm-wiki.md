---
type: source-summary
tags: [wiki, knowledge-base, llm-patterns, meta]
updated: 2026-04-08
sources: 1
---

# Source: LLM Wiki

**File:** `raw/articles/llm-wiki.md`
**Date ingested:** 2026-04-08
**Type:** article

## Key Takeaways

- The LLM wiki pattern is a persistent, compounding knowledge base where an LLM writes and maintains structured markdown wiki pages rather than performing RAG retrieval from raw documents on every query.
- Three layers: immutable raw sources, LLM-maintained wiki pages, and a schema document that governs conventions and workflows.
- The three core operations are Ingest (read a source, update wiki pages), Query (read index then relevant pages, synthesize answer, optionally file the answer back as a new page), and Lint (health-check for orphans, contradictions, stale content).
- `index.md` is a content-oriented catalog; `log.md` is a chronological append-only record of operations. Together they let the LLM navigate the wiki without embedding-based search at moderate scale.
- The schema document (e.g. CLAUDE.md or AGENTS.md) is the key config that makes the LLM a disciplined maintainer rather than a generic chatbot.
- This document is intentionally abstract — it describes the pattern, not any specific implementation. It was the design seed for the OpenClip wiki we are now building.

## Pages Updated

- [[codebase-overview]] (this file informed the wiki structure used throughout)
