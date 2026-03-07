const { execSync } = require('child_process');

function getRunningProcesses() {
  try {
    const output = execSync('tasklist /FO CSV /NH', { encoding: 'utf-8', timeout: 5000 });
    const processes = [];
    for (const line of output.split('\n')) {
      const match = line.match(/"([^"]+)"/);
      if (match) processes.push(match[1].toLowerCase());
    }
    return processes;
  } catch {
    return [];
  }
}

function getWindowTitles() {
  try {
    // Use PowerShell to get window titles
    const cmd = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -ExpandProperty MainWindowTitle"`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
    return output.split('\n').map(t => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function detectRunningGame(games) {
  const processes = getRunningProcesses();
  const titles = getWindowTitles();

  for (const game of games) {
    if (!game.enabled) continue;
    const selector = game.selector.toLowerCase();

    // Check process names
    if (processes.some(p => p.includes(selector))) return game;

    // Check window titles
    if (titles.some(t => t.toLowerCase().includes(selector))) return game;
  }
  return null;
}

function setupGameWatcher(store, onStateChange) {
  let lastGame = null;
  const fs = require('fs');
  const path = require('path');

  const interval = setInterval(() => {
    const games = store.get('games') || [];
    const detected = detectRunningGame(games);

    if (detected && !lastGame) {
      // Game started
      lastGame = detected;
      writeGameState(store, `RECORDING|${detected.name}|${detected.scene || ''}`);
      onStateChange({ currentGame: detected.name, status: 'recording' });
    } else if (!detected && lastGame) {
      // Game stopped
      const stoppedGame = lastGame.name;
      lastGame = null;
      writeGameState(store, 'IDLE');
      onStateChange({ currentGame: null, status: 'idle' });

      // Organize recordings after a delay
      setTimeout(() => {
        const { organizeRecordings } = require('./fileManager');
        organizeRecordings(store, stoppedGame);
      }, 3000);
    }
  }, 2000);

  return { interval };
}

function writeGameState(store, state) {
  const fs = require('fs');
  const path = require('path');
  const runtimeDir = path.join(__dirname, '..', '..', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'game_state'), state, 'utf-8');
}

module.exports = { setupGameWatcher, detectRunningGame };
