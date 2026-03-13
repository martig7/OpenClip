/**
 * Mock Game Watcher for E2E testing.
 * Provides deterministic game detection without requiring real processes.
 */

const { setGameProcesses, clearMockData } = require('./processDetector-testing');

let mockWatcher = null;
let lastState = { currentGame: null, status: 'idle' };
let onStateChangeCallback = null;
let pollInterval = null;

function detectRunningGame(games) {
  const processes = setGameProcesses.__mock_returns || [];
  const titles = [];

  for (const game of games) {
    if (!game.enabled) continue;

    const priority = game.windowMatchPriority ?? 0;
    const titleStr = (game.selector || '').toLowerCase();
    const exeName = (game.exe || '').toLowerCase();

    if (!exeName && !titleStr) continue;

    if (priority === 2) {
      if (exeName && processes.some((p) => p === exeName)) return game;
    } else if (priority === 1) {
      if (titleStr && titles.some((t) => t.includes(titleStr))) return game;
      if (exeName && processes.some((p) => p === exeName)) return game;
    } else {
      if (titleStr && titles.some((t) => t.includes(titleStr))) return game;
    }
  }

  return null;
}

function setupGameWatcher(store, onStateChange) {
  onStateChangeCallback = onStateChange;

  function poll() {
    const games = store.get('games') || [];
    const detected = detectRunningGame(games);

    if (detected && !lastState.currentGame) {
      lastState = { currentGame: detected.name, status: 'recording' };
      onStateChange(lastState);
    } else if (!detected && lastState.currentGame) {
      lastState = { currentGame: null, status: 'idle' };
      onStateChange(lastState);
    } else if (detected && lastState.currentGame && detected.name !== lastState.currentGame) {
      lastState = { currentGame: detected.name, status: 'recording' };
      onStateChange(lastState);
    }

    if (pollInterval) {
      pollInterval = setTimeout(poll, 1000);
    }
  }

  pollInterval = setTimeout(poll, 1000);

  mockWatcher = {
    stop() {
      if (pollInterval) {
        clearTimeout(pollInterval);
        pollInterval = null;
      }
      lastState = { currentGame: null, status: 'idle' };
      clearMockData();
    },
    getLastState() {
      return lastState;
    },
  };

  return mockWatcher;
}

function simulateGameStart(gameName) {
  setGameProcesses.__mock_returns = [gameName.toLowerCase() + '.exe'];
  if (onStateChangeCallback) {
    lastState = { currentGame: gameName, status: 'recording' };
    onStateChangeCallback(lastState);
  }
}

function simulateGameStop() {
  setGameProcesses.__mock_returns = [];
  if (onStateChangeCallback) {
    lastState = { currentGame: null, status: 'idle' };
    onStateChangeCallback(lastState);
  }
}

function resetWatcher() {
  if (mockWatcher) {
    mockWatcher.stop();
  }
  lastState = { currentGame: null, status: 'idle' };
  clearMockData();
  onStateChangeCallback = null;
}

module.exports = {
  setupGameWatcher,
  detectRunningGame,
  simulateGameStart,
  simulateGameStop,
  resetWatcher,
};
