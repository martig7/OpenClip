const koffi = require('koffi');

// ── Windows API constants ──
const TH32CS_SNAPPROCESS = 0x00000002;
const MAX_PATH = 260;
const STRUCT_SIZE = 568; // sizeof(PROCESSENTRY32W) on x64
const EXE_OFFSET = 44;  // offset of szExeFile in PROCESSENTRY32W

// ── Load system DLLs ──
const kernel32 = koffi.load('kernel32.dll');
const user32 = koffi.load('user32.dll');

// ── Process enumeration (CreateToolhelp32Snapshot) ──
const CreateToolhelp32Snapshot = kernel32.func(
  'void * __stdcall CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)'
);
const Process32FirstW = kernel32.func(
  'bool __stdcall Process32FirstW(void *hSnapshot, void *lppe)'
);
const Process32NextW = kernel32.func(
  'bool __stdcall Process32NextW(void *hSnapshot, void *lppe)'
);
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');

// ── Window title enumeration (EnumWindows) ──
const WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(void *hwnd, int64 lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(WNDENUMPROC *cb, int64 lParam)');
const GetWindowTextW = user32.func(
  'int __stdcall GetWindowTextW(void *hWnd, char16 *lpString, int nMaxCount)'
);
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hWnd)');

// Pre-allocate buffers (reused across calls to avoid GC pressure)
const procBuf = Buffer.alloc(STRUCT_SIZE);
const titleBuf = Buffer.alloc(512 * 2);

/**
 * Enumerate all running process names using the Toolhelp32 API.
 * Runs entirely in-process — no child process is spawned.
 * Returns an array of lowercase exe names (e.g. ["explorer.exe", "notepad.exe"]).
 */
function getRunningProcessNames() {
  const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snapshot) return [];

  procBuf.writeUInt32LE(STRUCT_SIZE, 0); // dwSize

  const processes = [];

  if (Process32FirstW(snapshot, procBuf)) {
    do {
      const name = procBuf.toString('utf16le', EXE_OFFSET, EXE_OFFSET + MAX_PATH * 2).split('\0')[0];
      if (name) processes.push(name.toLowerCase());
    } while (Process32NextW(snapshot, procBuf));
  }

  CloseHandle(snapshot);
  return processes;
}

/**
 * Enumerate all visible window titles using EnumWindows.
 * Runs entirely in-process — no PowerShell is spawned.
 * Returns an array of lowercase window title strings.
 */
function getWindowTitles() {
  const titles = [];

  const cb = koffi.register((hwnd, _lParam) => {
    if (!IsWindowVisible(hwnd)) return true;
    const len = GetWindowTextW(hwnd, titleBuf, 512);
    if (len > 0) {
      titles.push(titleBuf.toString('utf16le', 0, len * 2).toLowerCase());
    }
    return true;
  }, koffi.pointer(WNDENUMPROC));

  EnumWindows(cb, 0);
  koffi.unregister(cb);

  return titles;
}

module.exports = { getRunningProcessNames, getWindowTitles };
