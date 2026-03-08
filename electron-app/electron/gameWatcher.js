const { exec } = require('child_process');
const fs = require('fs');
const { RUNTIME_DIR, STATE_FILE, PID_FILE, LOG_FILE } = require('./constants');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf-8'); } catch {}
}

function getRunningProcesses() {
  return new Promise((resolve) => {
    exec('tasklist /FO CSV /NH', { encoding: 'utf-8', timeout: 5000 }, (error, stdout) => {
      if (error) return resolve([]);
      const processes = [];
      for (const line of stdout.split('\n')) {
        const match = line.match(/"([^"]+)"/);
        if (match) processes.push(match[1].toLowerCase());
      }
      resolve(processes);
    });
  });
}

function getWindowTitles() {
  return new Promise((resolve) => {
    const cmd = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -ExpandProperty MainWindowTitle"`;
    exec(cmd, { encoding: 'utf-8', timeout: 5000 }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(stdout.split('\n').map(t => t.trim()).filter(Boolean));
    });
  });
}

async function detectRunningGame(games) {
  const [processes, titles] = await Promise.all([
    getRunningProcesses(),
    getWindowTitles(),
  ]);

  for (const game of games) {
    if (!game.enabled) continue;
    const selector = game.selector.toLowerCase();

    if (processes.some(p => p.includes(selector))) return game;
    if (titles.some(t => t.toLowerCase().includes(selector))) return game;
  }
  return null;
}

function setupGameWatcher(store, onStateChange) {
  let lastGame = null;
  let stopped = false;

  // Clear log and write PID on startup (matches Python watcher behaviour)
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  try { fs.writeFileSync(LOG_FILE, '', 'utf-8'); } catch {}
  try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8'); } catch {}
  log(`Watcher started (pid ${process.pid})`);

  async function poll() {
    if (stopped) return;

    const games = store.get('games') || [];
    const detected = await detectRunningGame(games);

    if (detected && !lastGame) {
      lastGame = detected;
      writeGameState(`RECORDING|${detected.name}|${detected.scene || ''}`);
      log(`Game detected: ${detected.name}`);
      onStateChange({ currentGame: detected.name, status: 'recording' });
    } else if (!detected && lastGame) {
      const stoppedGame = lastGame.name;
      lastGame = null;
      writeGameState('IDLE');
      log(`Game stopped: ${stoppedGame}`);
      onStateChange({ currentGame: null, status: 'idle' });

      setTimeout(() => {
        const { organizeRecordings } = require('./fileManager');
        organizeRecordings(store, stoppedGame);
      }, 2000);
    }

    if (!stopped) {
      setTimeout(poll, 1000);
    }
  }

  // Start first poll
  poll();

  return {
    stop() {
      stopped = true;
      log('Watcher stopped');
      try { fs.unlinkSync(PID_FILE); } catch {}
    },
  };
}

function writeGameState(state) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, state, 'utf-8');
}

module.exports = { setupGameWatcher, detectRunningGame };
