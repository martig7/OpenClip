const koffi = require('koffi');

// ── Windows API constants ──
const TH32CS_SNAPPROCESS = 0x00000002;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const MAX_PATH = 260;
const STRUCT_SIZE = 568; // sizeof(PROCESSENTRY32W) on x64
const PID_OFFSET = 8;   // offset of th32ProcessID in PROCESSENTRY32W
const EXE_OFFSET = 44;  // offset of szExeFile in PROCESSENTRY32W

// Module-level flag — set to true only when koffi initialises without error
let _koffiReady = false;

// Top-level koffi initialization wrapped in try-catch so a missing DLL or
// incompatible runtime doesn't crash the entire main process.
let kernel32, user32;
let CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, CloseHandle, OpenProcess, QueryFullProcessImageNameW;
let WNDENUMPROC, EnumWindows, GetWindowTextW, IsWindowVisible, GetWindowThreadProcessId, GetClassNameW;
let procBuf, titleBuf, classBuf;

try {
  // ── Load system DLLs ──
  kernel32 = koffi.load('kernel32.dll');
  user32 = koffi.load('user32.dll');

  // ── Process enumeration (CreateToolhelp32Snapshot) ──
  CreateToolhelp32Snapshot = kernel32.func(
    'void * __stdcall CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)'
  );
  Process32FirstW = kernel32.func(
    'bool __stdcall Process32FirstW(void *hSnapshot, void *lppe)'
  );
  Process32NextW = kernel32.func(
    'bool __stdcall Process32NextW(void *hSnapshot, void *lppe)'
  );
  CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');
  OpenProcess = kernel32.func(
    'void * __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'
  );
  QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, char16 *lpExeName, void *lpdwSize)'
  );

  // ── Window title enumeration (EnumWindows) ──
  WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(void *hwnd, int64 lParam)');
  EnumWindows = user32.func('bool __stdcall EnumWindows(WNDENUMPROC *cb, int64 lParam)');
  GetWindowTextW = user32.func(
    'int __stdcall GetWindowTextW(void *hWnd, char16 *lpString, int nMaxCount)'
  );
  IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hWnd)');
  GetWindowThreadProcessId = user32.func(
    'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, void *lpdwProcessId)'
  );
  GetClassNameW = user32.func(
    'int __stdcall GetClassNameW(void *hWnd, char16 *lpClassName, int nMaxCount)'
  );

  // Pre-allocate buffers (reused across calls to avoid GC pressure)
  procBuf = Buffer.alloc(STRUCT_SIZE);
  titleBuf = Buffer.alloc(512 * 2);
  classBuf = Buffer.alloc(256 * 2);

  _koffiReady = true;
} catch (err) {
  console.error(`[processDetector] Win32 API init failed: ${err.message}`);
}

function readExeNameFromProcBuf() {
  return procBuf.toString('utf16le', EXE_OFFSET, EXE_OFFSET + MAX_PATH * 2).split('\0')[0];
}

function getProcessPathFromPid(pid) {
  const hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid >>> 0);
  if (!hProcess) return '';
  try {
    const pathBuf = Buffer.alloc(1024 * 2);
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(1024, 0);
    const ok = QueryFullProcessImageNameW(hProcess, 0, pathBuf, sizeBuf);
    if (!ok) return '';
    const chars = sizeBuf.readUInt32LE(0);
    if (!chars) return '';
    return pathBuf.toString('utf16le', 0, chars * 2).trim();
  } catch {
    return '';
  } finally {
    CloseHandle(hProcess);
  }
}

function getProcessInfoMap() {
  const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snapshot) return new Map();

  procBuf.writeUInt32LE(STRUCT_SIZE, 0);
  const processMap = new Map();

  if (Process32FirstW(snapshot, procBuf)) {
    do {
      const pid = procBuf.readUInt32LE(PID_OFFSET);
      const exe = readExeNameFromProcBuf();
      if (!exe) continue;
      const lowerExe = exe.toLowerCase();
      const name = lowerExe.endsWith('.exe') ? lowerExe.slice(0, -4) : lowerExe;
      processMap.set(pid, {
        pid,
        exe,
        name,
        path: getProcessPathFromPid(pid),
      });
    } while (Process32NextW(snapshot, procBuf));
  }

  CloseHandle(snapshot);
  return processMap;
}

/**
 * Enumerate all running process names using the Toolhelp32 API.
 * Runs entirely in-process — no child process is spawned.
 * Returns an array of lowercase exe names (e.g. ["explorer.exe", "notepad.exe"]).
 */
function getRunningProcessNames() {
  if (!_koffiReady) return [];
  const processMap = getProcessInfoMap();
  return [...processMap.values()].map(p => p.exe.toLowerCase());
}

/**
 * Enumerate all visible window titles using EnumWindows.
 * Runs entirely in-process — no PowerShell is spawned.
 * Returns an array of lowercase window title strings.
 */
function getWindowTitles() {
  if (!_koffiReady) return [];
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

function getVisibleWindowsDetailed() {
  if (!_koffiReady) return [];
  const processMap = getProcessInfoMap();
  const windows = [];
  const pidBuf = Buffer.alloc(4);
  const seen = new Set();

  const cb = koffi.register((hwnd, _lParam) => {
    if (!IsWindowVisible(hwnd)) return true;

    const titleLen = GetWindowTextW(hwnd, titleBuf, 512);
    if (titleLen <= 0) return true;
    const title = titleBuf.toString('utf16le', 0, titleLen * 2).trim();
    if (!title) return true;

    pidBuf.writeUInt32LE(0, 0);
    GetWindowThreadProcessId(hwnd, pidBuf);
    const pid = pidBuf.readUInt32LE(0);

    const classLen = GetClassNameW(hwnd, classBuf, 256);
    const windowClass = classLen > 0 ? classBuf.toString('utf16le', 0, classLen * 2).trim() : '';

    const proc = processMap.get(pid);
    if (!proc || !proc.exe) return true;

    const dedupeKey = `${pid}:${title}`;
    if (seen.has(dedupeKey)) return true;
    seen.add(dedupeKey);

    windows.push({
      title,
      process: proc.name,
      exe: proc.exe,
      windowClass: windowClass || proc.name,
      pid,
      path: proc.path || '',
    });

    return true;
  }, koffi.pointer(WNDENUMPROC));

  EnumWindows(cb, 0);
  koffi.unregister(cb);

  return windows;
}

function getRunningProcessesDetailed() {
  if (!_koffiReady) return [];
  const processMap = getProcessInfoMap();
  const visibleWindows = getVisibleWindowsDetailed();
  const hasWindowByName = new Set(visibleWindows.map(w => (w.process || '').toLowerCase()));

  return [...processMap.values()].map(p => ({
    name: p.name,
    exe: p.exe,
    hasWindow: hasWindowByName.has(p.name),
    path: p.path,
  }));
}

function findProcessPathByName(processName) {
  if (!_koffiReady) return '';
  if (!processName) return '';
  const target = processName.toLowerCase().replace(/\.exe$/i, '');
  const processMap = getProcessInfoMap();
  for (const proc of processMap.values()) {
    if (proc.name === target && proc.path) return proc.path;
  }
  return '';
}

module.exports = {
  getRunningProcessNames,
  getWindowTitles,
  getVisibleWindowsDetailed,
  getRunningProcessesDetailed,
  findProcessPathByName,
};
