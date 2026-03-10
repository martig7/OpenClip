/**
 * obsHelper.js
 *
 * Manages the lifecycle of a headless OBS Studio process for integration
 * testing.  Each call to startOBS():
 *
 *   1. Finds a free TCP port for the OBS WebSocket server.
 *   2. Creates an isolated OBS configuration directory so the test instance
 *      never touches the developer's real OBS settings.
 *   3. Spawns `obs --headless` (Linux/macOS) or `obs64 --headless --portable`
 *      (Windows) with the config directory pre-written.
 *   4. Waits until the WebSocket server is accepting TCP connections.
 *   5. Performs a full OBS WebSocket protocol handshake to confirm the server
 *      is genuinely the OBS WebSocket plugin (not just a stray TCP listener).
 *   6. Returns an object with the wsSettings and a stop() function that kills
 *      the process and removes the config directory.
 *
 * Enabling the OBS WebSocket server in headless mode
 * ──────────────────────────────────────────────────
 * OBS Studio 28+ bundles the obs-websocket plugin.  In headless mode the
 * plugin reads its configuration from:
 *
 *   Linux/macOS: $XDG_CONFIG_HOME/obs-studio/plugin_config/obs-websocket/config.json
 *   Windows:     <obs-install>/config/obs-studio/plugin_config/obs-websocket/config.json
 *                (via the --portable flag, which fixes the config root to
 *                 <obs-install>/config/ relative to the binary)
 *
 * startOBS() writes that file with server_enabled=true and a randomly chosen
 * port before spawning OBS, so the WebSocket server starts automatically.
 * Step 5 (protocol handshake) verifies this actually worked — if the file was
 * ignored or the plugin is missing, startOBS() throws with an actionable
 * diagnostic rather than silently passing or waiting for the full timeout.
 *
 * Windows note: OBS ignores XDG_CONFIG_HOME and APPDATA env var overrides
 * because it resolves its config path via Win32 registry APIs.  --portable
 * is the only reliable way to use an isolated config on Windows.  The
 * portable config root is always <binDir>/../../config, so we derive it from
 * the OBS_BINARY path and clean it up in stop().  On Windows, set OBS_BINARY
 * to the full path of obs64.exe; the repo-local install is auto-detected.
 *
 * isOBSAvailable() returns false when OBS is not installed, allowing test
 * suites to call describe.skipIf(!isOBSAvailable()) so they are silently
 * skipped in environments without OBS (e.g. local developer machines).
 */

import { spawnSync, spawn } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path, { join } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';

const isWindows = process.platform === 'win32';

// On Windows, auto-detect the repo-local OBS install (obs-studio/ in the repo
// root, four directories above this file: <repo>/electron-app/tests/integration/obs/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _repoLocalObs = path.resolve(__dirname, '../../../../obs-studio/bin/64bit/obs64.exe');

const OBS_BINARY = process.env.OBS_BINARY
  || (isWindows && existsSync(_repoLocalObs) ? _repoLocalObs : isWindows ? 'obs64' : 'obs');

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
  // On Windows, --portable is the only reliable way to isolate the OBS config,
  // and --portable derives the config root from the binary's location.  If
  // OBS_BINARY is not an absolute path (e.g. just "obs64"), we cannot derive
  // that path — fail immediately with a clear diagnostic rather than running
  // tests against the developer's real OBS configuration or failing obscurely.
  if (isWindows && !path.isAbsolute(OBS_BINARY)) {
    throw new Error(
      `On Windows, OBS_BINARY must be an absolute path to obs64.exe so that ` +
      `--portable mode can isolate the test configuration. ` +
      `Current value: "${OBS_BINARY}". ` +
      `Set OBS_BINARY to the full path of obs64.exe, e.g.: ` +
      `C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe`
    );
  }

  const wsPort = await findFreePort();

  // ── Determine config directory and spawn arguments ──────────────────────
  // Linux/macOS: create a fresh temp dir and point OBS at it via XDG_CONFIG_HOME.
  // Windows: OBS ignores env var overrides for its config path; use --portable
  // instead, which fixes the config root to <binDir>/../../config.  We derive
  // obsConfigDir from OBS_BINARY and clean it up in stop() after the tests
  // finish.  We only delete obsConfigDir (the obs-studio subtree we created),
  // not the parent config/ directory which may have been pre-existing.
  let tmpBase, obsConfigDir, cleanupDir, obsArgs, extraEnv;

  if (isWindows) {
    const binDir = path.dirname(OBS_BINARY);
    tmpBase = path.resolve(binDir, '..', '..', 'config');
    obsConfigDir = join(tmpBase, 'obs-studio');
    // Only remove the obs-studio subtree we wrote, not the pre-existing
    // portable config root (tmpBase), to avoid data loss on existing installs.
    cleanupDir = obsConfigDir;
    obsArgs = ['--headless', '--portable'];
    extraEnv = {};
  } else {
    tmpBase = mkdtempSync(join(tmpdir(), 'openclip-obs-test-'));
    obsConfigDir = join(tmpBase, 'obs-studio');
    // We created the entire tmpBase temp dir — clean up the whole thing.
    cleanupDir = tmpBase;
    obsArgs = ['--headless'];
    // When no X display is available (e.g. CI without Xvfb), tell Qt to use
    // the offscreen platform so OBS does not abort on startup.
    extraEnv = process.env.DISPLAY ? {} : { QT_QPA_PLATFORM: 'offscreen' };
  }

  // Wipe any leftover obsConfigDir from a previous run before writing a fresh
  // config.  On Windows with --portable the config root is fixed to the OBS
  // install tree, so a failed stop() cleanup (e.g. EPERM while OBS holds file
  // locks) leaves stale crash-marker files.  OBS detects those on the next
  // startup and shows a "did not shut down properly / run in Safe Mode?"
  // dialog that blocks headless and CI runs indefinitely.  Deleting the
  // directory here guarantees every run starts from a pristine config.
  _rmTemp(obsConfigDir);

  _writeOBSConfig(obsConfigDir, wsPort, initialScenes);

  let stopping = false;
  let exited = false;

  const obsProcess = spawn(OBS_BINARY, obsArgs, {
    env: {
      ...process.env,
      ...extraEnv,
      // Override the XDG config home on Linux/macOS so OBS uses our isolated
      // temp directory.  On Windows, --portable handles config isolation.
      ...(isWindows ? {} : { XDG_CONFIG_HOME: tmpBase }),
    },
    // On Windows, OBS resolves its data files (locale, themes, plugins) relative
    // to its working directory.  It looks for <cwd>/../../data/obs-studio when
    // the cwd is the bin/64bit/ directory inside the install tree.  Without this,
    // OBS fails with "Failed to load locale" and exits immediately.
    ...(isWindows ? { cwd: path.dirname(OBS_BINARY) } : {}),
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
    _rmTemp(cleanupDir);
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
    _rmTemp(cleanupDir);
    const cause = spawnError || err;
    throw new Error(
      `OBS WebSocket server did not become reachable on port ${wsPort} within ` +
        `${startupTimeoutMs}ms. Make sure OBS ${OBS_BINARY} supports --headless ` +
        `(OBS 28+) and that the obs-websocket plugin is installed.\n` +
        (isWindows ? 'On Windows, set OBS_BINARY to the full path of obs64.exe.\n' : '') +
        `Original error: ${cause.message}`
    );
  }

  // Read back the actual WebSocket config that OBS wrote (or kept) after
  // startup.  OBS may regenerate the plugin config on first run — for example
  // some versions reset auth_required to true with a fresh random password.
  // By reading the on-disk config we always use the credentials OBS is
  // actually enforcing, so the handshake and subsequent test calls never fail
  // due to a stale or mismatched password.
  const wsConfigPath = join(obsConfigDir, 'plugin_config', 'obs-websocket', 'config.json');
  const actualWsConfig = _readOBSWebSocketConfig(wsConfigPath);
  const wsPassword = actualWsConfig.auth_required ? (actualWsConfig.server_password || '') : undefined;

  // Verify the OBS WebSocket protocol handshake.  A plain TCP connection
  // succeeding is not enough — something other than the OBS WebSocket plugin
  // could be listening on the port, OR the plugin could be installed but
  // disabled (server_enabled=false in its config).  Attempting a real
  // obs-websocket-js connection catches both cases and throws immediately with
  // an actionable diagnostic so tests never silently succeed against a
  // non-functional server.
  try {
    await _verifyOBSWebSocketHandshake('127.0.0.1', wsPort, wsPassword);
  } catch (err) {
    stopping = true;
    obsProcess.kill('SIGTERM');
    _rmTemp(cleanupDir);
    const authHint = actualWsConfig.auth_required
      ? ` Auth is enabled in the config (auth_required=true); password was read from ${wsConfigPath}.`
      : '';
    throw new Error(
      `OBS is running and port ${wsPort} is open, but the WebSocket server did not ` +
        `complete the OBS protocol handshake. The server is enabled via ` +
        `${obsConfigDir}/plugin_config/obs-websocket/config.json — verify that ` +
        `OBS ${OBS_BINARY} is version 28+ and that the obs-websocket plugin is installed.` +
        `${authHint}\n` +
        `Original error: ${err.message}`
    );
  }

  return {
    /** WebSocket settings object ready for use with obsWebSocket.js helpers. */
    wsSettings: {
      host: '127.0.0.1',
      port: wsPort,
      // Only include password when OBS actually requires auth.  This matches
      // the shape expected by obsWebSocket.js (password field is optional).
      ...(wsPassword !== undefined && { password: wsPassword }),
    },

    /** Kill the OBS process and clean up the temp directory. */
    stop() {
      stopping = true;
      if (!exited) {
        obsProcess.kill('SIGTERM');
        // On Windows, the process may hold file locks briefly after SIGTERM.
        // Wait for exit before attempting directory removal to avoid EPERM.
        if (isWindows) {
          obsProcess.once('exit', () => _rmTemp(cleanupDir));
          return;
        }
      }
      _rmTemp(cleanupDir);
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

/**
 * Open a real OBS WebSocket protocol connection to verify the server is
 * genuinely the obs-websocket plugin and is accepting requests.  Disconnects
 * immediately after a successful handshake.  Throws if the handshake fails
 * for any reason (TCP refused, WS upgrade rejected, protocol mismatch, etc.).
 *
 * This is intentionally a lightweight check — we only care that the server is
 * reachable and speaks the obs-websocket v5 protocol.  No OBS calls are made.
 *
 * @param {string} host
 * @param {number} port
 * @param {string|undefined} password  Supply when auth_required is true in the
 *   OBS WebSocket config; omit (or pass undefined) for no-auth servers.
 */
async function _verifyOBSWebSocketHandshake(host, port, password) {
  const { default: OBSWebSocket } = await import('obs-websocket-js');
  const obs = new OBSWebSocket();
  try {
    // connect() performs the full WebSocket upgrade + obs-websocket v5
    // identification handshake.  It throws if the server is not an OBS
    // WebSocket server or if auth is required but the wrong password was
    // supplied.  We pass the password read back from the on-disk config so
    // we always use the credentials OBS is actually enforcing.
    await obs.connect(`ws://${host}:${port}`, password);
  } finally {
    // Always disconnect, even if connect() threw (it may have partially opened
    // a socket).  Disconnect errors are suppressed because the connect error is
    // the one that matters; log at debug level in case it helps troubleshooting.
    obs.disconnect().catch((e) => {
      if (process.env.OBS_DEBUG) {
        console.debug(`[obsHelper] _verifyOBSWebSocketHandshake: disconnect error: ${e.message}`);
      }
    });
  }
}

/**
 * Read the obs-websocket config.json that OBS (re)wrote during startup and
 * return its parsed contents.  Falls back to the pre-written defaults if the
 * file cannot be read (e.g. OBS didn't touch it), so callers always get a
 * usable object.
 *
 * @param {string} configPath  Absolute path to the obs-websocket config.json.
 * @returns {{ auth_required: boolean, server_password?: string, server_enabled: boolean }}
 */
function _readOBSWebSocketConfig(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    if (process.env.OBS_DEBUG) {
      console.debug(`[obsHelper] Could not read OBS WebSocket config at ${configPath}: ${e.message}`);
    }
    // Safe defaults — match what _writeOBSConfig wrote before OBS started.
    return { auth_required: false, server_enabled: true };
  }
}

function _rmTemp(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {
    console.warn(`[obsHelper] Failed to remove temp config directory ${dir}: ${e.message}`);
  }
}
