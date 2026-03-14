/**
 * Playwright global setup for integration tests (CommonJS).
 *
 * Playwright require()s this file directly — it must be CJS.
 * obsHelper.mjs is ESM, so we load it via dynamic import().
 *
 * Execution order:
 *   1. This runs (starts OBS, sets env vars)
 *   2. Playwright starts the webServer (electron --integration-mode),
 *      which inherits the env vars set here
 *   3. Tests run
 *   4. The returned function runs (stops OBS, removes temp dirs)
 */

'use strict';

const { mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

module.exports = async function globalSetup() {
  // Dynamic import of the ESM obsHelper
  const { startOBS, isOBSAvailable } = await import('../../integration/obs/obsHelper.mjs');

  if (!isOBSAvailable()) {
    throw new Error(
      'OBS Studio binary not found — cannot run integration tests.\n' +
      'Install OBS 28+ or set the OBS_BINARY environment variable to the\n' +
      'full path of obs64.exe (Windows) or obs (Linux/macOS).\n' +
      'On Windows the repo-local install at obs-studio/bin/64bit/obs64.exe\n' +
      'is auto-detected if downloaded via the CI workflow.'
    );
  }

  // Isolated temp directories — never touch production data
  const obsRecordingsDir = mkdtempSync(join(tmpdir(), 'openclip-obs-rec-'));
  const openclipDestDir  = mkdtempSync(join(tmpdir(), 'openclip-dest-'));

  // Start a fully isolated headless OBS:
  //   --headless --portable  keeps OBS from touching the developer's real config
  //   random free port       avoids conflicts with any running OBS
  const obs = await startOBS({
    initialScenes: ['Scene'],
  });

  // Set env vars BEFORE Playwright spawns the webServer subprocess and test
  // workers — both inherit the current process environment.
  process.env.OBS_HOST           = obs.wsSettings.host;
  process.env.OBS_PORT           = String(obs.wsSettings.port);
  process.env.OBS_RECORDING_PATH = obsRecordingsDir;
  process.env.OPENCLIP_DEST_PATH = openclipDestDir;

  console.log(
    `\n[integration] OBS WebSocket → ws://${obs.wsSettings.host}:${obs.wsSettings.port}` +
    `\n[integration] OBS recordings → ${obsRecordingsDir}` +
    `\n[integration] OpenClip dest  → ${openclipDestDir}\n`
  );

  // Playwright calls the returned function as teardown after all tests.
  return async function globalTeardown() {
    obs.stop();
    rmSync(obsRecordingsDir, { recursive: true, force: true });
    rmSync(openclipDestDir,  { recursive: true, force: true });
  };
};
