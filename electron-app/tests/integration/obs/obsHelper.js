/**
 * obsHelper.js
 *
 * Manages the lifecycle of a headless OBS Studio process for integration
 * testing.  Each call to startOBS():
 *
 *   1. Finds a free TCP port for the OBS WebSocket server.
 *   2. Creates an isolated, temporary OBS configuration directory so the test
 *      instance never touches the developer's real OBS settings.
 *   3. Spawns `obs --headless` (or the binary set via $OBS_BINARY) with
 *      XDG_CONFIG_HOME pointing at that temporary directory.
 *   4. Waits until the WebSocket server is accepting connections.
 *   5. Returns an object with the wsSettings and a stop() function that kills
 *      the process and removes the temp directory.
 *
 * isOBSAvailable() returns false when OBS is not installed, allowing test
 * suites to call describe.skipIf(!isOBSAvailable()) so they are silently
 * skipped in environments without OBS (e.g. local developer machines).
 */

import { spawnSync, spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';

const OBS_BINARY = process.env.OBS_BINARY || 'obs';

// ------------------------------------------------------------------
// Public helpers
// ------------------------------------------------------------------

/**
 * Returns true when the OBS binary can be executed (cross-platform check).
 */
export function isOBSAvailable() {
  try {
    const result = spawnSync(OBS_BINARY, ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Start a headless OBS instance with a test-specific isolated configuration.
 *
 * @param {object}   [options]
 * @param {string[]} [options.initialScenes=['Scene']]
 *   Scene names to seed in the test scene collection.  At least one scene is
 *   required; OBS will not start cleanly with an empty collection.
 * @param {number}   [options.startupTimeoutMs=45000]
 *   How long (ms) to wait for the WebSocket server to become reachable.
 *
 * @returns {Promise<{
 *   wsSettings: { host: string, port: number },
 *   stop: () => void
 * }>}
 */
export async function startOBS({
  initialScenes = ['Scene'],
  startupTimeoutMs = 45_000,
} = {}) {
  const wsPort = await findFreePort();
  const tmpBase = mkdtempSync(join(tmpdir(), 'openclip-obs-test-'));
  const obsConfigDir = join(tmpBase, 'obs-studio');

  _writeOBSConfig(obsConfigDir, wsPort, initialScenes);

  let stopping = false;
  let exited = false;

  // When no X display is available (e.g. CI without Xvfb), tell Qt to use the
  // offscreen platform so OBS does not abort on startup trying to connect to a
  // display server.  When DISPLAY is already set (e.g. by xvfb-run), we leave
  // QT_QPA_PLATFORM alone so Qt can use the real virtual display.
  const extraEnv = process.env.DISPLAY
    ? {}
    : { QT_QPA_PLATFORM: 'offscreen' };

  const obsProcess = spawn(OBS_BINARY, ['--headless'], {
    env: {
      ...process.env,
      ...extraEnv,
      // Override the XDG config home so OBS uses our isolated temp directory.
      XDG_CONFIG_HOME: tmpBase,
    },
    // Suppress OBS output unless the caller sets OBS_DEBUG=1.
    stdio: process.env.OBS_DEBUG ? 'inherit' : 'ignore',
    detached: false,
  });

  obsProcess.on('exit', (code, signal) => {
    exited = true;
    if (!stopping && code !== 0 && signal !== 'SIGTERM') {
      console.error(`[obsHelper] OBS exited unexpectedly — code=${code} signal=${signal}`);
    }
  });

  // Guard against spawn errors (e.g. ENOENT when the binary is missing or
  // EACCES when it is not executable).  Without this, Node.js would throw an
  // unhandled 'error' event and crash the entire Vitest process.
  let spawnError = null;
  obsProcess.on('error', (err) => {
    spawnError = err;
    stopping = true;
    _rmTemp(tmpBase);
  });

  // Wait for the WebSocket server to be reachable.
  // The early-abort callback detects both spawn errors (ENOENT/EACCES) and
  // unexpected early exits (e.g. SIGABRT when OBS crashes on startup), so the
  // test fails immediately rather than waiting the full timeout.
  try {
    await waitForPort('127.0.0.1', wsPort, startupTimeoutMs, () => {
      if (spawnError) return spawnError;
      if (exited && !stopping) return new Error('OBS process exited unexpectedly');
      return null;
    });
  } catch (err) {
    stopping = true;
    if (!spawnError) obsProcess.kill('SIGTERM');
    _rmTemp(tmpBase);
    const cause = spawnError || err;
    throw new Error(
      `OBS WebSocket server did not become reachable on port ${wsPort} within ` +
        `${startupTimeoutMs}ms. Make sure OBS ${OBS_BINARY} supports --headless ` +
        `(OBS 28+) and that the obs-websocket plugin is installed.\n` +
        `Original error: ${cause.message}`
    );
  }

  return {
    /** WebSocket settings object ready for use with obsWebSocket.js helpers. */
    wsSettings: { host: '127.0.0.1', port: wsPort },

    /** Kill the OBS process and clean up the temp directory. */
    stop() {
      stopping = true;
      if (!exited) {
        obsProcess.kill('SIGTERM');
      }
      _rmTemp(tmpBase);
    },
  };
}

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

/** Find a free TCP port by briefly binding to :0. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Poll until a TCP port is accepting connections, or the timeout expires.
 * Uses a 500 ms retry interval.
 *
 * @param {() => Error|null} [getSpawnError]  Optional callback that returns a
 *   spawn error if one occurred, allowing the poller to abort early.
 */
function waitForPort(host, port, timeoutMs, getSpawnError) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      // Abort early if the process emitted a spawn error.
      const spawnErr = typeof getSpawnError === 'function' ? getSpawnError() : null;
      if (spawnErr) {
        reject(spawnErr);
        return;
      }

      const sock = net.createConnection({ host, port });
      sock.on('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${host}:${port}`));
        } else {
          setTimeout(attempt, 500);
        }
      });
    }

    attempt();
  });
}

/**
 * Write the complete minimal OBS configuration that the headless process needs:
 *  - plugin_config/obs-websocket/config.json  (enables the WS server)
 *  - global.ini                                (selects our test profile + collection)
 *  - basic/profiles/Test/basic.ini             (video/output settings)
 *  - basic/scenes/Test.json                    (seed scene collection)
 */
function _writeOBSConfig(obsConfigDir, wsPort, initialScenes) {
  // Directory skeleton
  mkdirSync(join(obsConfigDir, 'plugin_config', 'obs-websocket'), { recursive: true });
  mkdirSync(join(obsConfigDir, 'basic', 'profiles', 'Test'), { recursive: true });
  mkdirSync(join(obsConfigDir, 'basic', 'scenes'), { recursive: true });

  // WebSocket server — no authentication, custom port
  writeFileSync(
    join(obsConfigDir, 'plugin_config', 'obs-websocket', 'config.json'),
    JSON.stringify({
      alerts_enabled: false,
      auth_required: false,
      server_enabled: true,
      server_port: wsPort,
    })
  );

  // Global OBS settings — point at the Test profile and Test scene collection,
  // and suppress the first-run wizard.
  writeFileSync(
    join(obsConfigDir, 'global.ini'),
    [
      '[Basic]',
      'Profile=Test',
      'ProfileDir=Test',
      'SceneCollection=Test',
      'SceneCollectionFile=Test',
      '',
      '[General]',
      'firstRun=false',
    ].join('\n')
  );

  // Minimal recording profile
  writeFileSync(
    join(obsConfigDir, 'basic', 'profiles', 'Test', 'basic.ini'),
    [
      '[General]',
      'Name=Test',
      '',
      '[Video]',
      'BaseCX=1280',
      'BaseCY=720',
      'OutputCX=1280',
      'OutputCY=720',
      'FPSType=0',
      'FPSCommon=30',
    ].join('\n')
  );

  // Seed scene collection.  OBS will fail to start if the collection is absent
  // or completely empty, so we always create at least the first named scene.
  const firstScene = initialScenes[0] || 'Scene';
  writeFileSync(
    join(obsConfigDir, 'basic', 'scenes', 'Test.json'),
    JSON.stringify({
      current_scene: firstScene,
      current_program_scene: firstScene,
      groups: [],
      modules: {},
      name: 'Test',
      scene_order: initialScenes.map(name => ({ name })),
      scenes: initialScenes.map(name => ({
        id: 'scene',
        name,
        settings: { custom_size: false, id_counter: 0, items: [] },
        versioned_id: 'scene',
      })),
      sources: [],
      transitions: [{ duration: 300, id: 'cut_transition', name: 'Cut', settings: {} }],
    })
  );
}

function _rmTemp(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {
    console.warn(`[obsHelper] Failed to remove temp config directory ${dir}: ${e.message}`);
  }
}
