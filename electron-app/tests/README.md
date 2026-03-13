# Tests

This folder contains the test suite for the Electron application.

## Test Structure

- **unit/** - Unit tests for individual modules
- **mocks/** - Mock implementations for testing
- **setup.js** - Test setup and configuration

## Key Test Files

- **bundleDependencies.test.js** - Tests for bundled dependencies
- **release.test.js** - Release process tests
- **autoUpdater.test.js** - Auto-updater functionality tests
- **recordingService.test.js** - Recording service tests
- **gameWatcher.test.js** - Game watcher tests
- **fileManager.test.js** - File manager tests
- **obsWebSocket.test.js** - OBS WebSocket tests
- **obsIntegration.test.js** - OBS integration tests
- **obsPlugin.test.js** - OBS plugin tests
- **iniParser.test.js** - INI parser tests
- **utils.test.js** - Utility function tests

## Description

The test suite uses Jest (configured in package.json) to verify the correctness of backend modules. Tests cover core functionality including recording services, OBS integration, file management, and utility functions.

For detailed information about testing setup and individual tests, refer to the test files in the unit folder.
