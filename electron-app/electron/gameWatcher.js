const fs = require('fs');
const { RUNTIME_DIR, STATE_FILE, PID_FILE, LOG_FILE } = require('./constants');
const { getRunningProcessNames, getWindowTitles } = require('./processDetector');
const { startRecording, stopRecording } = require('./obsPlugin');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf-8'); } catch {}
}

function detectRunningGame(games) {
  const processes = getRunningProcessNames().map(p => p.toLowerCase());
  const titles = getWindowTitles().map(t => t.toLowerCase());

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
      // Requires game.exe to be set; if not set, this game is skipped.
      if (exeName && processes.some(p => p === exeName)) return game;
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

function setupGameWatcher(store, onStateChange, onOrganizeProgress = () => {}) {
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
    organizeRecordings(store, gameName, onOrganizeProgress)
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
      // Tell the OBS plugin to start recording (best-effort, OBS may not be running)
      startRecording(detected.scene || undefined).catch(err =>
        log(`Plugin startRecording failed: ${err.message}`)
      );
    } else if (!detected && lastGame) {
      const stoppedGame = lastGame.name;
      lastGame = null;
      writeGameState('IDLE');
      log(`Game stopped: ${stoppedGame}`);
      onStateChange({ currentGame: null, status: 'idle' });
      // Tell the OBS plugin to stop recording
      stopRecording().catch(err =>
        log(`Plugin stopRecording failed: ${err.message}`)
      );
      scheduleOrganize(stoppedGame);
    } else if (detected && lastGame && detected.name !== lastGame.name) {
      const stoppedGame = lastGame.name;
      lastGame = detected;
      // Force a brief non-RECORDING state so we get a clean stop/start between games.
      writeGameState('IDLE');
      log(`Game switched: ${stoppedGame} → ${detected.name}`);
      onStateChange({ currentGame: null, status: 'idle' });

      // Stop recording for the old game, then start for the new one
      stopRecording()
        .catch(err => log(`Plugin stopRecording failed: ${err.message}`))
        .finally(() => {
          // After a short delay, signal recording for the newly detected game.
          setTimeout(() => {
            if (stopped) return; // watcher was stopped during the delay
            writeGameState(`RECORDING|${detected.name}|${detected.scene || ''}`);
            onStateChange({ currentGame: detected.name, status: 'recording' });
            startRecording(detected.scene || undefined).catch(err =>
              log(`Plugin startRecording failed: ${err.message}`)
            );
          }, 500);
        });

      scheduleOrganize(stoppedGame);
    }

    if (!stopped) {
      setTimeout(poll, 5000);
    }
  }

  poll();

  return {
    stop() {
      stopped = true;
      writeGameState('STOPPED');
      log('Watcher stopped');
      stopRecording().catch(() => {}); // best-effort stop
      try { fs.unlinkSync(PID_FILE); } catch {}
    },
  };
}

let lastWrittenState = null;
function writeGameState(state) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (state !== lastWrittenState) {
    try { fs.writeFileSync(STATE_FILE, state, 'utf-8'); } catch (err) { log(`Failed to write game state: ${err.message}`); }
    lastWrittenState = state;
  }
}

module.exports = { setupGameWatcher, detectRunningGame };
