/**
 * Mock Process Detector for E2E testing.
 * Returns deterministic process/window lists for testing game detection.
 */

const mockProcesses = new Set();
const mockWindowTitles = new Set();

function addMockProcess(name) {
  mockProcesses.add(name.toLowerCase());
}

function addMockWindowTitle(title) {
  mockWindowTitles.add(title.toLowerCase());
}

function clearMockData() {
  mockProcesses.clear();
  mockWindowTitles.clear();
}

function getRunningProcessNames() {
  return Array.from(mockProcesses);
}

function getWindowTitles() {
  return Array.from(mockWindowTitles);
}

function setGameProcesses(games) {
  clearMockData();
  if (!games || !Array.isArray(games)) return;

  for (const game of games) {
    if (game.exe) {
      addMockProcess(game.exe);
    }
    if (game.selector) {
      addMockWindowTitle(game.selector);
    }
  }
}

clearMockData();

addMockProcess('explorer.exe');
addMockProcess('electron.exe');
addMockProcess('code.exe');

module.exports = {
  getRunningProcessNames,
  getWindowTitles,
  addMockProcess,
  addMockWindowTitle,
  clearMockData,
  setGameProcesses,
};
