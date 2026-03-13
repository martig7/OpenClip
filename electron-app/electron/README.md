# Electron Backend

This folder contains the Node.js backend code that runs in the Electron main process.

## Key Files

- **main.js** - Application entry point, window management, and IPC setup
- **ipcHandlers.js** - IPC communication handlers between main and renderer
- **preload.js** - Secure bridge between main and renderer processes
- **obsWebSocket.js** - OBS Studio WebSocket connection and control
- **recordingService.js** - Recording management and lifecycle handling
- **fileManager.js** - File system operations and video file management
- **gameWatcher.js** - Game process detection and monitoring
- **apiServer.js** - Internal REST API server
- **autoUpdater.js** - Application auto-update functionality
- **obsPlugin.js** - OBS plugin integration
- **store.js** - Persistent configuration storage
- **obsEncoding.js** - OBS encoding configuration
- **obsIntegration.js** - General OBS integration utilities
- **qrCodeReader.js** - QR code scanning functionality
- **processDetector.js** - Process detection and monitoring
- **iniParser.js** - INI file parsing utilities
- **constants.js** - Application constants
- **markerService.js** - Video marker management
- **videoMetadata.js** - Video metadata extraction and handling

## Description

The backend handles all native functionality including OBS Studio integration, file management, process monitoring, and system-level operations. It communicates with the renderer process through secure IPC channels.

For detailed information about each module, refer to the individual file implementations.
