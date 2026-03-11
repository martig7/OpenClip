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

    const priority = game.windowMatchPriority ?? 0;
    const titleStr = (game.selector || '').toLowerCase();
    const exeName  = (game.exe || '').toLowerCase();

    // Skip games with neither a usable selector nor an exe binding.
    if (!exeName && !titleStr) continue;

    // Mirror OBS window_match_priority values:
    //   0 — Match title, otherwise find window of same type  → title match only
    //   1 — Match title, otherwise find window of same exe   → title match, then exe fallback
    //   2 — Match executable                                 → exe only
    if (priority === 2) {
      // Exe-only: exact process name match (same logic OBS uses for "match executable").
      // Requires game.exe to be set; if it isn't, fall through to title/process substring check.
      if (exeName && processes.some(p => p === exeName)) return game;
      if (!exeName && titleStr) {
        // No exe binding — fall back to treating selector as a process/title substring.
        if (processes.some(p => p.includes(titleStr)) || titles.some(t => t.includes(titleStr))) return game;
      }
    } else if (priority === 1) {
      // Title first, exe fallback (OBS priority 1).
      if (titleStr && titles.some(t => t.includes(titleStr))) return game;
      if (exeName && processes.some(p => p === exeName)) return game;
    } else {
      // Default (priority 0): title match only.
      // If no exe binding exists also check process names as a convenience (manual selectors).
      if (titleStr && titles.some(t => t.includes(titleStr))) return game;
      if (!exeName && titleStr && processes.some(p => p.includes(titleStr))) return game;
    }
  }

  return null;
}

function setupGameWatcher(store, onStateChange) {
  let lastGame = null;
  let stopped = false;
  const organizeQueue = [];
  let organizing = false;

  function drainOrganizeQueue() {
    if (organizing || organizeQueue.length === 0) return;
    organizing = true;
    const gameName = organizeQueue.shift();
    const { organizeRecordings } = require('./fileManager');
    // .finally runs as a new microtask, so calling drainOrganizeQueue here is safe (no call-stack buildup).
    organizeRecordings(store, gameName)
      .catch(err => log(`Organize failed: ${err.stack || err.message}`))
      .finally(() => {
        organizing = false;
        drainOrganizeQueue();
      });
  }

  function scheduleOrganize(gameName) {
    setTimeout(() => {
      // Skip if an identical game is already waiting in the queue.
      if (!organizeQueue.includes(gameName)) {
        organizeQueue.push(gameName);
      }
      drainOrganizeQueue();
    }, 8000);
  }

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
      scheduleOrganize(stoppedGame);
    } else if (detected && lastGame && detected.name !== lastGame.name) {
      const stoppedGame = lastGame.name;
      lastGame = detected;
      // Force a brief non-RECORDING state so OBS detects a clean stop/start between games.
      writeGameState('IDLE');
      log(`Game switched: ${stoppedGame} → ${detected.name}`);
      onStateChange({ currentGame: null, status: 'idle' });

      // After a short delay, signal recording for the newly detected game.
      setTimeout(() => {
        writeGameState(`RECORDING|${detected.name}|${detected.scene || ''}`);
        onStateChange({ currentGame: detected.name, status: 'recording' });
      }, 500);

      scheduleOrganize(stoppedGame);
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
