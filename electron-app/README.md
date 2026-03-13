# OpenClip Electron App

This is the desktop application component of OpenClip, built with Electron. It provides game recording automation, OBS Studio integration, and video management capabilities.

## Overview

The electron-app contains a complete desktop application with:
- **Backend** - Node.js/Electron main process handling native integrations
- **Frontend** - React-based user interface
- **Testing** - Jest unit tests for core functionality

## Key Subfolders

- **[electron](./electron/README.md)** - Backend code (OBS integration, file management, IPC, recording services)
- **[src](./src/README.md)** - Frontend React application
- **[tests](./tests/README.md)** - Test suite

## Additional Folders

- **assets** - Application icons and resources
- **dist** - Built application files
- **__mocks__** - Mock implementations for testing

## Description

OpenClip is an automated game recording application that integrates with OBS Studio to automatically record gameplay when games are launched. The Electron app provides:

- Game process detection and automatic recording
- OBS Studio WebSocket integration
- Video file management and organization
- Video playback and browsing interface
- Configurable encoding settings
- QR code scanning for mobile pairing

For detailed information about specific areas:
- [electron/README.md](./electron/README.md) - Backend functionality
- [src/README.md](./src/README.md) - Frontend application structure
- [tests/README.md](./tests/README.md) - Testing documentation
