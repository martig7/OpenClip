const fs = require('fs');
const { RUNTIME_DIR, STATE_FILE, PID_FILE, LOG_FILE } = require('./constants');
const { getRunningProcessNames, getWindowTitles } = require('./processDetector');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf-8'); } catch {}
}

function detectRunningGame(games) {
  const processes = getRunningProcessNames();
  const titles = getWindowTitles();

  for (const game of games) {
    if (!game.enabled) continue;
    const selector = game.selector.toLowerCase();
    if (processes.some(p => p.includes(selector))) return game;
    if (titles.some(t => t.includes(selector))) return game;
  }

  return null;
}

function setupGameWatcher(store, onStateChange) {
  let lastGame = null;
  let stopped = false;

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  try { fs.writeFileSync(LOG_FILE, '', 'utf-8'); } catch {}
  try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8'); } catch {}
  writeGameState('IDLE');
  log(`Watcher started (pid ${process.pid})`);

  function poll() {
    if (stopped) return;

    const games = store.get('games') || [];
    const detected = detectRunningGame(games);

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
        organizeRecordings(store, stoppedGame).catch(err => log(`Organize failed: ${err.stack || err.message}`));
      }, 8000);
    } else if (detected && lastGame && detected.name !== lastGame.name) {
      const stoppedGame = lastGame.name;
      lastGame = detected;
      writeGameState(`RECORDING|${detected.name}|${detected.scene || ''}`);
      log(`Game switched: ${stoppedGame} → ${detected.name}`);
      onStateChange({ currentGame: detected.name, status: 'recording' });

      setTimeout(() => {
        const { organizeRecordings } = require('./fileManager');
        organizeRecordings(store, stoppedGame).catch(err => log(`Organize failed: ${err.stack || err.message}`));
      }, 8000);
    }

    if (!stopped) {
      setTimeout(poll, 2000);
    }
  }

  poll();

  return {
    stop() {
      stopped = true;
      writeGameState('STOPPED');
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
