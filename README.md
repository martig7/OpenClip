# OpenClip

Automatic recording manager for OBS Studio. Detects when your configured games are running, starts and stops OBS recording automatically, organizes recordings into dated folders, and lets you create clips with a hotkey. Also provides an easy way to create and share clips, completely free and open-source.

![Main Page](assets/Screenshot%202026-05-07%20162254.png)
![Video Player](assets/Screenshot%202026-05-07%20162544.png)
![Clip Creator](assets/Screenshot%202026-05-07%20162921.png)
![Storage Grid](assets/Screenshot%202026-05-07%20162937.png)

## Requirements

- Windows 10 or later (x64)
- [OBS Studio](https://obsproject.com/)

## Installation

1. Download the latest installer (`Open Clip Setup x.x.x.exe`) from [Releases](https://github.com/martig7/OpenClip/releases).
2. Run the installer. Open Clip will be added to your Start Menu and Desktop.
3. Launch **OpenClip** — the setup wizard runs automatically on first launch and walks you through:
   - Detecting your OBS install location
   - Setting your OBS recording folder
   - Installing the OBS plugin (one click — no manual file copying)
   - Setting the organized destination folder

## Features

- **Automatic recording** — starts/stops OBS recording when your games launch or exit
- **Per-game OBS scenes** — switch to a different scene automatically per game
- **Clip hotkey** — press a configurable key during gameplay to mark a moment; clips are extracted automatically when the session ends
- **Recording organizer** — moves raw OBS files into `Game / Week of ...` folders
- **Re-encoder** — batch re-encode recordings with H.264, H.265, or AV1
- **Recordings viewer** — browse, preview, and manage all recordings and clips in-app
- **Storage management** — auto-delete old recordings by age or total size limit
- **Scene management** — add audio sources, tracks, and capture sources automatically
- **Free clip hosting** — use free filehost sites like catbox.moe or uguu.se to share clips

## Building from Source

```bash
cd electron-app
npm install
npm run dev        # development mode (hot reload)
npm run dist       # build NSIS installer into electron-app/dist/
npm run release    # build and publish a draft GitHub Release (requires GH_TOKEN env var)
```

## Repository Structure

```
electron-app/     ← The desktop app (Electron + React + Node.js)
obs-plugin/       ← The OBS plugin for communication between your OBS instance and OpenClip
assets/           ← Screenshots and branding
```

