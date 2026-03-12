'use strict';

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const semver = require('semver');

const GITHUB_OWNER = 'martig7';
const GITHUB_REPO = 'OpenClip';

/**
 * Fetch JSON from an HTTPS URL, following up to maxRedirects redirects.
 * @param {string} url
 * @param {number} [maxRedirects=5]
 * @returns {Promise<any>}
 */
function fetchJson(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const get = (target, remaining) => {
      const parsed = new URL(target);
      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': `${GITHUB_REPO}-dev-updater`,
          'Accept': 'application/vnd.github+json',
        },
      };
      https.get(opts, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          if (remaining <= 0) return reject(new Error('Too many redirects'));
          res.resume();
          get(res.headers.location, remaining - 1);
          return;
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    };
    get(url, maxRedirects);
  });
}

/**
 * Download a file from url to destPath, calling onProgress(percent) as data arrives.
 * Follows redirects automatically.
 * @param {string} url
 * @param {string} destPath
 * @param {(percent: number) => void} onProgress
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const get = (target) => {
      const parsed = new URL(target);
      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': `${GITHUB_REPO}-dev-updater` },
      };
      https.get(opts, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          res.resume();
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) onProgress(Math.round((received / total) * 100));
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

/**
 * In dev mode: query the GitHub releases API, compare versions, and if a newer
 * release exists, download the real installer asset with live progress events.
 * Fires update:available → update:progress → update:downloaded to the renderer,
 * identical to the production electron-updater event sequence.
 * Never installs — the update:install handler blocks quitAndInstall in dev mode.
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 * @returns {Promise<void>}
 */
async function devCheckAndDownload(getMainWindow) {
  const sendToWindow = (channel, payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  try {
    const release = await fetchJson(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    if (!semver.gt(latestVersion, currentVersion)) {
      console.log(`[updater][dev] Already up to date (${currentVersion})`);
      return;
    }

    console.log(`[updater][dev] Update available: ${latestVersion} — starting download`);
    sendToWindow('update:available', { version: latestVersion });

    // Find the .exe asset (exclude .blockmap)
    const asset = release.assets.find((a) => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap'));
    if (!asset) throw new Error('No .exe asset found in the latest release');

    const destPath = path.join(os.tmpdir(), asset.name);
    let lastPercent = -1;

    await downloadFile(asset.browser_download_url, destPath, (percent) => {
      if (percent !== lastPercent) {
        lastPercent = percent;
        sendToWindow('update:progress', { percent });
      }
    });

    console.log(`[updater][dev] Download complete — install is blocked in dev mode (${destPath})`);
    sendToWindow('update:downloaded');
  } catch (err) {
    console.error('[updater][dev] error:', err.message);
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:error', { message: err.message });
  }
}

/**
 * Placeholder for dev auto-updater setup. Actual check+download is initiated
 * by the update:check IPC handler via devCheckAndDownload.
 */
function setupDevAutoUpdater() {
  // Nothing to set up here — dev mode bypasses electron-updater entirely and
  // uses devCheckAndDownload instead (triggered by the update:check IPC handler).
}

/**
 * Wire up all electron-updater event handlers.
 * @param {() => Electron.BrowserWindow | null} getMainWindow - returns the current main window
 */
function setupAutoUpdater(getMainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:available', { version: info.version });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:progress', { percent: Math.round(progress.percent) });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:downloaded');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:error', { message: err.message });
    }
  });

  // Delay the first check so the UI has time to load.
  setTimeout(() => {
    try {
      autoUpdater.checkForUpdates()?.catch((err) => {
        console.error('[updater] check failed:', err.message);
      });
    } catch (err) {
      console.error('[updater] check failed:', err.message);
    }
  }, 5000);
}

/**
 * Register the update-related IPC handlers.
 * Kept separate from setupAutoUpdater so they can be tested independently.
 * @param {Electron.IpcMain} ipcMain
 */
function registerUpdateHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('update:check', () => {
    if (!app.isPackaged) {
      return devCheckAndDownload(getMainWindow);
    }
    try {
      return autoUpdater.checkForUpdates()?.catch((err) => {
        console.error('[updater] check failed:', err.message);
      });
    } catch (err) {
      console.error('[updater] check failed:', err.message);
    }
  });

  ipcMain.handle('update:install', () => {
    if (!app.isPackaged) {
      console.warn('[updater][dev] Install blocked in dev mode — not applying update');
      return;
    }
    autoUpdater.quitAndInstall();
  });
}

module.exports = { setupAutoUpdater, setupDevAutoUpdater, devCheckAndDownload, registerUpdateHandlers, autoUpdater };
