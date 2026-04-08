---
type: concept
tags: [obs-plugin, install, modules.json, obs, windows]
updated: 2026-04-08
sources: 1
---

# OBS Plugin Installation

The OpenClip OBS plugin (`openclip-obs`) is a native DLL/SO that OBS discovers by scanning specific directories on startup. No registry-based loader is involved — file placement is all that matters, with one important exception: the `modules.json` state file introduced in OBS v32.

## Key Points

### Install Paths (Windows)

Three locations are valid, with different admin and discovery behaviors:

| Path | Admin required | OBS auto-discovers in modules.json |
|------|---------------|-----------------------------------|
| `C:\Program Files\obs-studio\obs-plugins\64bit\` | Yes | Yes — auto-scanned on next launch |
| `C:\ProgramData\obs-studio\plugins\<name>\obs-plugins\64bit\` | No (OBS v28+) | **No** — entry must be written manually |
| `%AppData%\obs-studio\plugins\<name>\obs-plugins\64bit\` | No | **No** — entry must be written manually |

For the AppData and ProgramData paths, if `modules.json` does not already have an entry for the plugin, OBS will not load it even though the file exists. An installer writing to these paths must also write the 9-field entry to `modules.json` while OBS is not running.

### modules.json (`%AppData%\Roaming\obs-studio\plugin_manager\modules.json`)

- Introduced in OBS v32's Plugin Manager.
- OBS reads this file to track discovered plugins and their enabled/disabled state.
- On install to `Program Files`: OBS auto-adds the entry on next launch.
- On install to AppData/ProgramData: **the installer must write the entry** before OBS launches.
- On uninstall: OBS does not clean up stale entries. Remove the entry from `modules.json` manually (while OBS is closed) to avoid a greyed-out phantom entry in the Plugin Manager.
- Always write/modify `modules.json` while OBS is not running.

### Normal Install Flow

The OpenClip desktop app's setup wizard handles installation automatically. Manual steps:

1. Copy the compiled DLL to the appropriate directory.
2. If using AppData/ProgramData path, write the `modules.json` entry.
3. Restart OBS — the plugin loads automatically.

## Known Gotchas

### "[PLUGIN NOT FOUND]" after OBS Update

**Symptom:** Plugin appears in Plugin Manager as "[PLUGIN NOT FOUND]". The DLL is on disk, loads with `LoadLibraryW`, exports `obs_module_load`, and OBS logs contain no mention of it at all.

**Root cause:** A stale or incorrect `module_path` in `modules.json` causes OBS to report not-found without re-scanning the file. This is a state tracking problem in OBS, not a DLL problem.

**Fix:** While OBS is closed, delete or correct the plugin's entry in `modules.json`, then relaunch OBS. It will re-scan and add a fresh entry.

### Plugin Missing After In-Place OBS Update

**Symptom:** Plugin was working, OBS updates, plugin now appears missing or fails to load.

**Root cause:** In-place OBS updates skip the installer's DLL directory registration step. `obs.dll` and `obs-frontend-api.dll` can no longer be resolved at plugin load time. OBS 32.1.0's new Plugin Manager surfaces these previously-silent failures.

**Fix:** Reinstall OBS fully (not just the plugin). This re-runs the installer's DLL registration. See also the known issue note in `CLAUDE.md`.

## Related

- [[obs-plugin]]
