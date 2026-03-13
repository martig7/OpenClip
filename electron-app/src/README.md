# Frontend Source

This folder contains the React frontend source code for the Electron application.

## Key Subfolders

- **[viewer](./viewer/README.md)** - Video viewer module for browsing and playing recordings
- **[pages](./pages/README.md)** - Main application pages (Games, Settings, Encoding)
- **[hooks](./hooks/README.md)** - Custom React hooks for state management
- **components** - Shared components used across the application

## Additional Files

- **App.jsx** - Main application component
- **App.css** - Application styles
- **main.jsx** - Application entry point
- **index.css** - Global styles
- **api.js** - API client for backend communication

## Description

The frontend is built with React and provides the user interface for game recording management, video viewing, and application settings. It communicates with the backend through IPC handlers and REST APIs.

For detailed information about specific modules, see the README files in the respective subfolders:
- [viewer/README.md](./viewer/README.md) - Video viewer functionality
- [pages/README.md](./pages/README.md) - Main application pages
- [hooks/README.md](./hooks/README.md) - Custom React hooks
