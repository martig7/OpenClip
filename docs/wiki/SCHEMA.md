# OpenClip Wiki Schema

Read this file at the start of every session before touching the wiki.
It is the authoritative config for the OpenClip development knowledge base.

---

## Directory Layout

```
docs/wiki/
├── SCHEMA.md              ← you are here
├── index.md               ← catalog of all pages; read first when querying
├── log.md                 ← append-only activity log
├── raw/                   ← immutable source files; never modify these
│   ├── articles/          ← Web Clipper markdown articles, documentation pages
│   ├── conversations/     ← exported chat excerpts, session insights
│   └── bugs/              ← edge case notes, bug reports as .md files
└── pages/                 ← Claude-maintained wiki pages
    ├── modules/           ← one page per major source file
    ├── edge-cases/        ← specific bugs and their resolutions
    ├── decisions/         ← architecture decision records
    ├── concepts/          ← cross-cutting concerns and patterns
    └── sources/           ← one summary page per ingested raw file
```

---

## Frontmatter

Every page must include this YAML frontmatter:

```yaml
---
type: module | edge-case | decision | concept | source-summary
tags: [tag1, tag2]
updated: YYYY-MM-DD
sources: N
---
```

- `type`: one of the five values above
- `tags`: relevant module names, symptom keywords, or topic areas
- `updated`: date this page was last modified
- `sources`: number of raw files that contributed to this page (0 for mid-session pages)

## Cross-References

Use `[[wikilink]]` style for all internal links. The link target is the filename without `.md`.

Example: `[[fileManager]]` links to `pages/modules/fileManager.md`.

---

## Page Templates

### Module Page — `pages/modules/<module-name>.md`

```markdown
---
type: module
tags: [module-name]
updated: YYYY-MM-DD
sources: 0
---

# <ModuleName>

**File:** `electron-app/electron/<filename>.js`
**Responsibility:** One sentence describing what this module owns.

## Key Functions

- `functionName(args)` — what it does and any non-obvious behavior

## Known Quirks

- Non-obvious behaviors, timing dependencies, side effects

## Related

- [[related-module]]
```

### Edge-Case Page — `pages/edge-cases/<slug>.md`

```markdown
---
type: edge-case
tags: [affected-module, symptom-keyword]
updated: YYYY-MM-DD
sources: 0
---

# Edge Case: <Short Description>

**Trigger:** What causes this to occur
**Symptom:** What the developer or user observes
**Root Cause:** Why it happens
**Fix:** What was done to resolve it
**Prevention:** How to avoid it in future work

## Related

- [[affected-module]]
```

### Decision Page — `pages/decisions/<slug>.md`

```markdown
---
type: decision
tags: [area]
updated: YYYY-MM-DD
sources: 0
---

# Decision: <Title>

**Date:** YYYY-MM-DD
**Status:** Active | Superseded by [[other-decision]]

## Context

Why a decision was needed.

## Decision

What was decided, in one or two sentences.

## Reasoning

Why this option over the alternatives considered.

## Consequences

What this means for future work in the area.
```

### Concept Page — `pages/concepts/<slug>.md`

```markdown
---
type: concept
tags: [area]
updated: YYYY-MM-DD
sources: 0
---

# <Concept Name>

One-paragraph description.

## Key Points

- ...

## Related

- [[page1]]
- [[page2]]
```

### Source Summary Page — `pages/sources/<slug>.md`

```markdown
---
type: source-summary
tags: [topic]
updated: YYYY-MM-DD
sources: 1
---

# Source: <Title>

**File:** `raw/<category>/<filename>.md`
**Date ingested:** YYYY-MM-DD
**Type:** article | conversation | bug-note

## Key Takeaways

- ...

## Pages Updated

- [[page1]]
- [[page2]]
```

---

## Autonomous Ingestion

### When to Act Without Being Asked

**1. Session start** — before doing anything else:
- List all files in `raw/` recursively (excluding `.gitkeep`)
- Grep `log.md` for `] ingest |` entries
- For each file in `raw/` with no matching log entry, run the Ingest Workflow below

**2. Mid-session discovery** — file a new page immediately when you encounter:
- A non-obvious bug root cause or edge case
- An architecture decision being made or explained
- A recurring pattern worth naming
- Surprising behavior of Electron, OBS, Node, or any dependency
- A constraint or invariant not obvious from reading the code

**3. Post-query filing** — after answering a question, file the answer as a concept or decision page if it:
- Synthesizes information from multiple sources or modules
- Reveals a non-obvious connection between parts of the codebase
- Would be valuable to recall verbatim in a future session

**Always announce:** `Filing to wiki: pages/<type>/<filename>.md`

---

## Workflows

### Ingest Workflow

For each unprocessed raw file:

1. Read the source file fully
2. Write `pages/sources/<slug>.md` with key takeaways and list of pages to update
3. Add an entry to `index.md` under "Sources"
4. For each relevant existing wiki page, open it and update content or add cross-references
5. Create any new module, edge-case, decision, or concept pages the source warrants
6. Add each new page to `index.md` under the correct category
7. Append to `log.md`:
   `## [YYYY-MM-DD] ingest | <source title>`

Announce a one-line summary when done: "Ingested `<filename>` — created N pages, updated M pages."

### Query Workflow

1. Read `index.md` to identify relevant pages
2. Read those pages fully
3. Synthesize an answer with citations using `[[wikilink]]` references
4. If the answer is valuable (see Autonomous Ingestion rule 3), file it as a new page
5. Append to `log.md`:
   `## [YYYY-MM-DD] query | <brief question description>`

### Lint Workflow

Check for:
- Pages in `pages/` not listed in `index.md`
- Pages with no inbound `[[wikilinks]]` from other pages (orphans)
- Frontmatter missing required fields
- Concepts mentioned in multiple pages but lacking their own page
- Stale content likely superseded by newer sources

Output a numbered list of findings. Append to `log.md`:
`## [YYYY-MM-DD] lint | <N> issues found`

---

## Index Format

`index.md` is organized by page type. Each entry: `- [[slug]] — one-line description`

```markdown
# Wiki Index

## Modules
- [[fileManager]] — File organization, week folders, move operations

## Edge Cases
- [[edge-case-obs-plugin-missing]] — OBS plugin appears missing after OBS update

## Decisions
- [[decision-organize-delay-8s]] — Why the organize delay is 8 seconds

## Concepts
- [[ipc-patterns]] — How IPC handlers are structured in ipcHandlers.js

## Sources
- [[source-electron-ipc-guide]] — Electron IPC patterns article (2026-04-08)
```

## Log Entry Format

```
## [YYYY-MM-DD] ingest | Source Title
## [YYYY-MM-DD] query | Brief question description
## [YYYY-MM-DD] lint | N issues found
## [YYYY-MM-DD] file | pages/edge-cases/foo.md (mid-session)
```
