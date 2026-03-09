# Open Clip

Automatic recording manager for OBS Studio. Detects when your configured games are running, starts and stops OBS recording automatically, organizes recordings into dated folders, and lets you create clips with a hotkey.

## Requirements

- Windows 10 or later (x64)
- [OBS Studio](https://obsproject.com/) with the **WebSocket Server** enabled *(Tools → WebSocket Server Settings)*

## Installation

1. Download the latest installer (`Open Clip Setup x.x.x.exe`) from [Releases](https://github.com/martig7/OpenClip/releases).
2. Run the installer. Open Clip will be added to your Start Menu and Desktop.
3. Launch **Open Clip** and complete the one-time setup:
   - Set your OBS recording folder and organized destination folder under **Settings → Recording Paths**.
   - Add your games under the **Games** tab (pick the process name or window title).
   - Add the OBS Lua script to OBS (see below).

## OBS Lua Script Setup (one-time)

The app communicates with OBS via a small Lua script that auto-starts/stops recording when a game is detected.

1. In the app, go to **Settings → OBS Script Setup** and copy the script path shown there.
2. Open OBS → **Tools → Scripts → "+"** and select that file.
3. The path is pre-filled automatically — click **Close**. Done.

## Features

- **Automatic recording** — starts/stops OBS recording when your games launch or exit
- **Per-game OBS scenes** — switch to a different scene automatically per game
- **Clip hotkey** — press a configurable key during gameplay to mark a moment; clips are extracted automatically when the session ends
- **Recording organizer** — moves raw OBS files into `Game / Week of ...` folders
- **Re-encoder** — batch re-encode recordings with H.264, H.265, or AV1
- **Recordings viewer** — browse, preview, and manage all recordings and clips in-app
- **Storage management** — auto-delete old recordings by age or total size limit
- **OBS WebSocket** — connect via host/port/password or scan the QR code from OBS

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
DEPRECATED/       ← Archived Python-era tooling (no longer maintained)
assets/           ← Screenshots and branding
```

