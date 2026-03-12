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
      const req = https.get(opts, (res) => {
        req.setTimeout(0); // clear timeout once connected
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          if (remaining <= 0) { res.resume(); return reject(new Error('Too many redirects')); }
          res.resume();
          get(res.headers.location, remaining - 1);
          return;
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
      req.setTimeout(10000, () => { req.destroy(new Error('Request timed out')); });
    };
    get(url, maxRedirects);
  });
}

/** Platform-appropriate installer extension(s), most-preferred first. */
const PLATFORM_EXTS = {
  win32: ['.exe'],
  darwin: ['.dmg', '.zip'],
  linux: ['.AppImage', '.tar.gz'],
};

/**
 * Download a file from url to destPath, calling onProgress(percent) as data arrives.
 * Follows redirects automatically. Cleans up the partial file on any failure.
 * @param {string} url
 * @param {string} destPath
 * @param {(percent: number) => void} onProgress
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let out = null;

    const cleanup = (err) => {
      if (settled) return;
      settled = true;
      if (out) {
        out.destroy();
        fs.unlink(destPath, () => {}); // remove partial file, ignore unlink errors
      }
      reject(err);
    };

    const get = (target, remaining = 5) => {
      const parsed = new URL(target);
      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': `${GITHUB_REPO}-dev-updater` },
      };
      const req = https.get(opts, (res) => {
        req.setTimeout(0); // connected — clear the connect timeout
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          if (remaining <= 0) { res.resume(); return cleanup(new Error('Too many redirects')); }
          res.resume();
          get(res.headers.location, remaining - 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return cleanup(new Error(`Download failed with status ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        out = fs.createWriteStream(destPath);
        out.on('error', cleanup);
        res.on('error', cleanup);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) onProgress(Math.round((received / total) * 100));
        });
        res.pipe(out);
        out.on('finish', () => {
          if (!settled) {
            settled = true;
            out.close(resolve);
          }
        });
      }).on('error', cleanup);
      req.setTimeout(30000, () => cleanup(new Error('Download timed out')));
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

    // Pick the best asset for the current platform.
    const exts = PLATFORM_EXTS[process.platform] ?? ['.exe'];
    const asset = exts.reduce((found, ext) =>
      found ?? release.assets.find((a) => a.name.endsWith(ext) && !a.name.endsWith('.blockmap'))
    , null);
    if (!asset) throw new Error(`No suitable installer asset found for platform ${process.platform}`);

    // Sanitize the asset name to prevent path traversal.
    const safeName = path.basename(asset.name);
    const tmpDir = os.tmpdir();
    const destPath = path.join(tmpDir, safeName);
    if (!destPath.startsWith(path.resolve(tmpDir) + path.sep)) {
      throw new Error('Asset name failed path traversal check');
    }
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
