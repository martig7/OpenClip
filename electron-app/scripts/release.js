#!/usr/bin/env node
/**
 * Release script: builds the Electron installer locally, then publishes a
 * GitHub release (including latest.yml) using the `gh` CLI.
 *
 * Auto-update works in two scenarios:
 *   1. npm run release  — this script builds + publishes everything automatically.
 *   2. Manual GitHub release — build locally first (`npm run dist`), then upload
 *      the generated dist/*.exe, dist/*.exe.blockmap, and dist/latest.yml files.
 *      The auto-updater requires latest.yml to detect and download new versions.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Return the subset of filenames in distDir that electron-builder produces
 * and that are needed for auto-update to work (installer + blockmap + latest.yml).
 * @param {string} distDir  Absolute path to the dist/ directory.
 * @returns {string[]}      Plain filenames (not full paths).
 */
function collectArtifacts(distDir) {
  return fs.readdirSync(distDir).filter(
    (f) => f.endsWith('.exe') || f.endsWith('.exe.blockmap') || f === 'latest.yml',
  );
}

/**
 * Build the `gh release create` command string.
 * @param {string}   tag      Git tag, e.g. "v1.2.3".
 * @param {string}   distDir  Absolute path to the dist/ directory.
 * @param {string[]} files    Plain filenames inside distDir to upload.
 * @returns {string}
 */
function buildGhCommand(tag, distDir, files) {
  const fileArgs = files.map((f) => `"${path.join(distDir, f)}"`).join(' ');
  return `gh release create "${tag}" ${fileArgs} --title "${tag}" --generate-notes`;
}

// ─── Main execution (only when run directly) ────────────────────────────────
if (require.main === module) {
  const pkg = require('../package.json');
  const version = pkg.version;
  const tag = `v${version}`;
  const distDir = path.join(__dirname, '..', 'dist');

  function run(cmd, opts = {}) {
    console.log(`\n> ${cmd}`);
    execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..'), ...opts });
  }

  // 1. Build the native OBS plugin DLL and stage it for packaging
  const obsPluginSrc = path.join(__dirname, '..', '..', 'obs-plugin');
  const obsBuildDir = path.join(obsPluginSrc, 'build', 'Release');
  const obsPluginStaging = path.join(__dirname, '..', 'resources', 'obs-plugin');
  const pluginDllName = 'openclip-obs.dll';

  console.log('\nBuilding OBS plugin\u2026');
  run('cmake -S . -B build -G "Visual Studio 17 2022" -A x64', { cwd: obsPluginSrc });
  run('cmake --build build --config Release', { cwd: obsPluginSrc });

  const dllSrc = path.join(obsBuildDir, pluginDllName);
  if (!fs.existsSync(dllSrc)) {
    console.error(`\nPlugin DLL not found after build: ${dllSrc}`);
    process.exit(1);
  }
  fs.mkdirSync(obsPluginStaging, { recursive: true });
  fs.copyFileSync(dllSrc, path.join(obsPluginStaging, pluginDllName));
  console.log(`Staged ${pluginDllName} \u2192 resources/obs-plugin/`);

  // 2. Build Vite frontend
  run('npx vite build');

  // 3. Build Windows installer — publish never; gh handles the upload
  run('npx electron-builder --win --publish never');

  // 4. Collect artefacts produced by electron-builder
  const releaseFiles = collectArtifacts(distDir);

  if (releaseFiles.length === 0) {
    console.error('\nNo release artefacts found in dist/. Aborting.');
    process.exit(1);
  }

  console.log('\nRelease artefacts:');
  releaseFiles.forEach((f) => console.log(`  ${f}`));

  // 5. Publish GitHub release via gh CLI
  run(buildGhCommand(tag, distDir, releaseFiles));

  console.log(`\nRelease ${tag} published successfully!`);
}

module.exports = { collectArtifacts, buildGhCommand };
