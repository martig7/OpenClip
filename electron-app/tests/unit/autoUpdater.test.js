import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const _req = createRequire(import.meta.url);

// ─── Mock electron-updater ──────────────────────────────────────────────────
// Inject before loading autoUpdater.js so it picks up our mock.
const mockAutoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn(),
};

const electronUpdaterPath = _req.resolve('electron-updater');
_req.cache[electronUpdaterPath] = {
  id: electronUpdaterPath,
  filename: electronUpdaterPath,
  loaded: true,
  exports: { autoUpdater: mockAutoUpdater },
};

// Delete autoUpdater.js from require cache so it re-loads with our mock.
const updaterModulePath = _req.resolve('../../electron/autoUpdater.js');
delete _req.cache[updaterModulePath];

const { setupAutoUpdater, registerUpdateHandlers } = _req('../../electron/autoUpdater.js');

// ─── Helpers ────────────────────────────────────────────────────────────────
/** Return the callback registered for `event` across all autoUpdater.on() calls. */
function getRegisteredHandler(event) {
  const call = mockAutoUpdater.on.mock.calls.find(([ev]) => ev === event);
  return call ? call[1] : null;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('setupAutoUpdater', () => {
  let win;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    win = { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets autoDownload to true', () => {
    setupAutoUpdater(() => win);
    expect(mockAutoUpdater.autoDownload).toBe(true);
  });

  it('sets autoInstallOnAppQuit to true', () => {
    setupAutoUpdater(() => win);
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it('registers handlers for all four updater events', () => {
    setupAutoUpdater(() => win);
    const events = mockAutoUpdater.on.mock.calls.map(([ev]) => ev);
    expect(events).toContain('update-available');
    expect(events).toContain('download-progress');
    expect(events).toContain('update-downloaded');
    expect(events).toContain('error');
  });

  it('calls checkForUpdates after 5-second delay', () => {
    setupAutoUpdater(() => win);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('does not call checkForUpdates before the delay elapses', () => {
    setupAutoUpdater(() => win);
    vi.advanceTimersByTime(4999);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('swallows checkForUpdates errors gracefully', () => {
    mockAutoUpdater.checkForUpdates.mockImplementation(() => {
      throw new Error('network error');
    });
    setupAutoUpdater(() => win);
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  it('swallows async checkForUpdates rejections gracefully', async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('network error'));
    setupAutoUpdater(() => win);
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    // Allow the rejected promise to settle; if it were unhandled, the test would fail.
    await Promise.resolve();
  });

  // ── update-available ──────────────────────────────────────────────────────
  describe('update-available event', () => {
    beforeEach(() => setupAutoUpdater(() => win));

    it('sends update:available IPC with version when window is open', () => {
      getRegisteredHandler('update-available')({ version: '1.2.3' });
      expect(win.webContents.send).toHaveBeenCalledWith('update:available', { version: '1.2.3' });
    });

    it('does not send IPC when window is destroyed', () => {
      win.isDestroyed.mockReturnValue(true);
      getRegisteredHandler('update-available')({ version: '1.2.3' });
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('does not send IPC when window is null', () => {
      const { setupAutoUpdater: su } = _req('../../electron/autoUpdater.js');
      vi.clearAllMocks();
      su(() => null);
      getRegisteredHandler('update-available')?.({ version: '2.0.0' });
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  // ── download-progress ─────────────────────────────────────────────────────
  describe('download-progress event', () => {
    beforeEach(() => setupAutoUpdater(() => win));

    it('sends update:progress with rounded percent', () => {
      getRegisteredHandler('download-progress')({ percent: 42.7 });
      expect(win.webContents.send).toHaveBeenCalledWith('update:progress', { percent: 43 });
    });

    it('rounds down correctly', () => {
      getRegisteredHandler('download-progress')({ percent: 99.1 });
      expect(win.webContents.send).toHaveBeenCalledWith('update:progress', { percent: 99 });
    });

    it('does not send IPC when window is destroyed', () => {
      win.isDestroyed.mockReturnValue(true);
      getRegisteredHandler('download-progress')({ percent: 50 });
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  // ── update-downloaded ─────────────────────────────────────────────────────
  describe('update-downloaded event', () => {
    beforeEach(() => setupAutoUpdater(() => win));

    it('sends update:downloaded IPC', () => {
      getRegisteredHandler('update-downloaded')();
      expect(win.webContents.send).toHaveBeenCalledWith('update:downloaded');
    });

    it('does not send IPC when window is destroyed', () => {
      win.isDestroyed.mockReturnValue(true);
      getRegisteredHandler('update-downloaded')();
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  // ── error ─────────────────────────────────────────────────────────────────
  describe('error event', () => {
    beforeEach(() => setupAutoUpdater(() => win));

    it('logs the error message without throwing', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => getRegisteredHandler('error')(new Error('boom'))).not.toThrow();
      expect(spy).toHaveBeenCalledWith('[updater] error:', 'boom');
      spy.mockRestore();
    });
  });
});

// ─── registerUpdateHandlers ──────────────────────────────────────────────────
describe('registerUpdateHandlers', () => {
  let handlers;
  let mockIpcMain;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    mockIpcMain = {
      handle: vi.fn((channel, fn) => { handlers[channel] = fn; }),
    };
    registerUpdateHandlers(mockIpcMain);
  });

  it('registers update:check handler', () => {
    expect(handlers['update:check']).toBeTypeOf('function');
  });

  it('registers update:install handler', () => {
    expect(handlers['update:install']).toBeTypeOf('function');
  });

  it('update:check calls checkForUpdates', () => {
    handlers['update:check']();
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('update:check swallows checkForUpdates errors', () => {
    mockAutoUpdater.checkForUpdates.mockImplementation(() => {
      throw new Error('offline');
    });
    expect(() => handlers['update:check']()).not.toThrow();
  });

  it('update:check swallows rejected checkForUpdates promise', async () => {
    mockAutoUpdater.checkForUpdates.mockImplementation(() => {
      return Promise.reject(new Error('offline'));
    });

    await expect(async () => {
      await handlers['update:check']();
    }).not.toThrow();
  });

  it('update:install calls quitAndInstall', () => {
    handlers['update:install']();
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });
});
