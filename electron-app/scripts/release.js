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

console.log('\nBuilding OBS plugin…');
run('cmake -S . -B build -G "Visual Studio 17 2022" -A x64', { cwd: obsPluginSrc });
run('cmake --build build --config Release', { cwd: obsPluginSrc });

const dllSrc = path.join(obsBuildDir, pluginDllName);
if (!fs.existsSync(dllSrc)) {
  console.error(`\nPlugin DLL not found after build: ${dllSrc}`);
  process.exit(1);
}
fs.mkdirSync(obsPluginStaging, { recursive: true });
fs.copyFileSync(dllSrc, path.join(obsPluginStaging, pluginDllName));
console.log(`Staged ${pluginDllName} → resources/obs-plugin/`);

// 2. Build Vite frontend
run('npx vite build');

// 3. Build Windows installer — publish never; gh handles the upload
run('npx electron-builder --win --publish never');

// 4. Collect artefacts produced by electron-builder
const releaseFiles = fs.readdirSync(distDir).filter(
  (f) =>
    f.endsWith('.exe') ||
    f.endsWith('.exe.blockmap') ||
    f === 'latest.yml'
);

if (releaseFiles.length === 0) {
  console.error('\nNo release artefacts found in dist/. Aborting.');
  process.exit(1);
}

console.log('\nRelease artefacts:');
releaseFiles.forEach((f) => console.log(`  ${f}`));

// 5. Publish GitHub release via gh CLI
//    Files with spaces in their names are quoted individually.
const fileArgs = releaseFiles
  .map((f) => `"${path.join(distDir, f)}"`)
  .join(' ');

run(`gh release create "${tag}" ${fileArgs} --title "${tag}" --generate-notes`);

console.log(`\nRelease ${tag} published successfully!`);
