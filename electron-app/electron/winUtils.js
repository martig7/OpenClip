'use strict';
/**
 * koffi-based Win32 API utilities that replace PowerShell subprocess calls.
 * All functions are synchronous (wrapping Win32 APIs directly), except
 * extractProcessIcon which is async due to Jimp PNG encoding.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Load DLLs (koffi caches handles) ─────────────────────────────────────────
const koffi   = require('koffi');
const kernel32 = koffi.load('kernel32.dll');
const user32   = koffi.load('user32.dll');
const shell32  = koffi.load('shell32.dll');
const winmm    = koffi.load('winmm.dll');
const gdi32    = koffi.load('gdi32.dll');

// ── Struct definitions ────────────────────────────────────────────────────────
// Unique prototype name to avoid collision with processDetector.js's WNDENUMPROC
const WNDPROC_WU = koffi.proto('bool __stdcall WNDPROC_WU(void *hwnd, int64 lParam)');

const ICONINFO_S = koffi.struct('ICONINFO_S', {
  fIcon:    'bool',
  xHotspot: 'uint32',
  yHotspot: 'uint32',
  hbmMask:  'void *',
  hbmColor: 'void *',
});

const BITMAP_S = koffi.struct('BITMAP_S', {
  bmType:       'int32',
  bmWidth:      'int32',
  bmHeight:     'int32',
  bmWidthBytes: 'int32',
  bmPlanes:     'uint16',
  bmBitsPixel:  'uint16',
  bmBits:       'void *',
});

const SHFILEINFOW_S = koffi.struct('SHFILEINFOW_S', {
  hIcon:         'void *',
  iIcon:         'int32',
  dwAttributes:  'uint32',
  szDisplayName: koffi.array('char16', 260),
  szTypeName:    koffi.array('char16', 80),
});

// ── kernel32.dll ──────────────────────────────────────────────────────────────
const GetDiskFreeSpaceExW = kernel32.func(
  'bool __stdcall GetDiskFreeSpaceExW(char16 *lpDir, void *pFreeToUser, void *pTotal, void *pTotalFree)'
);
const TH32CS_SNAPPROCESS = 0x00000002;
const PROC_STRUCT_SIZE   = 568;
const PID_OFFSET         = 8;
const EXE_OFFSET         = 44;
const MAX_PATH           = 260;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

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
const OpenProcess = kernel32.func(
  'void * __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'
);
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, void *lpExeName, void *lpdwSize)'
);
const Sleep = kernel32.func('void __stdcall Sleep(uint32 dwMilliseconds)');

// ── user32.dll ────────────────────────────────────────────────────────────────
const EnumWindows_WU = user32.func(
  'bool __stdcall EnumWindows(WNDPROC_WU *cb, int64 lParam)'
);
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hWnd)');
const GetWindowTextW  = user32.func(
  'int __stdcall GetWindowTextW(void *hWnd, char16 *lpString, int nMaxCount)'
);
const GetWindowThreadProcessId = user32.func(
  'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, void *lpdwProcessId)'
);
const GetClassNameW = user32.func(
  'int __stdcall GetClassNameW(void *hWnd, char16 *lpClassName, int nMaxCount)'
);
const GetIconInfo = user32.func(
  'bool __stdcall GetIconInfo(void *hIcon, ICONINFO_S *piconinfo)'
);
const DestroyIcon = user32.func('bool __stdcall DestroyIcon(void *hIcon)');

// ── shell32.dll ───────────────────────────────────────────────────────────────
const ShellExecuteW = shell32.func(
  'uint64 __stdcall ShellExecuteW(void *hwnd, char16 *lpOp, char16 *lpFile, char16 *lpParams, char16 *lpDir, int32 nShow)'
);
const SHGetFileInfoW = shell32.func(
  'uint64 __stdcall SHGetFileInfoW(char16 *pszPath, uint32 dwFileAttributes, SHFILEINFOW_S *psfi, uint32 cbFileInfo, uint32 uFlags)'
);

// ── winmm.dll ─────────────────────────────────────────────────────────────────
const waveInGetNumDevs  = winmm.func('uint32 __stdcall waveInGetNumDevs()');
const waveInGetDevCapsW = winmm.func(
  'uint32 __stdcall waveInGetDevCapsW(uint32 uDeviceID, void *pwic, uint32 cbwic)'
);
const waveOutGetNumDevs  = winmm.func('uint32 __stdcall waveOutGetNumDevs()');
const waveOutGetDevCapsW = winmm.func(
  'uint32 __stdcall waveOutGetDevCapsW(uint32 uDeviceID, void *pwoc, uint32 cbwoc)'
);

// ── gdi32.dll ─────────────────────────────────────────────────────────────────
const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *hDC)');
const DeleteDC           = gdi32.func('bool __stdcall DeleteDC(void *hDC)');
const GetObjectW         = gdi32.func('int __stdcall GetObjectW(void *h, int c, BITMAP_S *pv)');
const GetDIBits          = gdi32.func(
  'int __stdcall GetDIBits(void *hdc, void *hbm, uint32 start, uint32 cLines, void *lpvBits, void *lpbmi, uint32 usage)'
);
const DeleteObject = gdi32.func('bool __stdcall DeleteObject(void *ho)');

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Get the exe path for the first process matching processName (with or without .exe). */
function _findExePathForProcess(processName) {
  const searchLower = processName.toLowerCase().replace(/\.exe$/i, '');
  const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snapshot) return null;

  const procBuf = Buffer.alloc(PROC_STRUCT_SIZE);
  procBuf.writeUInt32LE(PROC_STRUCT_SIZE, 0);

  let matchPid = 0;
  if (Process32FirstW(snapshot, procBuf)) {
    do {
      const exeName = procBuf.toString('utf16le', EXE_OFFSET, EXE_OFFSET + MAX_PATH * 2)
        .split('\0')[0];
      if (exeName.toLowerCase().replace(/\.exe$/i, '') === searchLower) {
        matchPid = procBuf.readUInt32LE(PID_OFFSET);
        break;
      }
    } while (Process32NextW(snapshot, procBuf));
  }
  CloseHandle(snapshot);

  if (!matchPid) return null;

  const hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, matchPid);
  if (!hProcess) return null;

  const nameBuf = Buffer.alloc(MAX_PATH * 2);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(MAX_PATH, 0);
  const ok = QueryFullProcessImageNameW(hProcess, 0, nameBuf, sizeBuf);
  CloseHandle(hProcess);

  if (!ok) return null;
  const size = sizeBuf.readUInt32LE(0);
  return nameBuf.toString('utf16le', 0, size * 2);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get disk free/used/total for the drive containing dirPath.
 * Uses GetDiskFreeSpaceExW — no subprocess spawned.
 * Returns { total, used, free } in bytes, or null on error.
 */
function getDiskFreeSpace(dirPath) {
  try {
    const pFreeToUser = Buffer.alloc(8);
    const pTotal      = Buffer.alloc(8);
    const pTotalFree  = Buffer.alloc(8);

    const ok = GetDiskFreeSpaceExW(dirPath, pFreeToUser, pTotal, pTotalFree);
    if (!ok) return null;

    const total     = Number(pTotal.readBigUInt64LE(0));
    const totalFree = Number(pTotalFree.readBigUInt64LE(0));
    const free      = Number(pFreeToUser.readBigUInt64LE(0));
    const used      = total - totalFree;
    return { total, used, free };
  } catch (err) {
    console.error('[winUtils] getDiskFreeSpace:', err.message);
    return null;
  }
}

/**
 * List all visible windows with associated process/exe/class info.
 * Replaces the PowerShell windows:list handler.
 */
function listWindowsWithProcesses() {
  const SYSTEM_PROCS = new Set([
    'explorer', 'searchhost', 'textinputhost', 'shellexperiencehost',
    'applicationframehost', 'systemsettings', 'mmc',
  ]);

  // Pre-allocate buffers used inside the callback
  const titleBuf = Buffer.alloc(512 * 2);
  const pidBuf   = Buffer.alloc(4);
  const classBuf = Buffer.alloc(256 * 2);
  const nameBuf  = Buffer.alloc(MAX_PATH * 2);
  const sizeBuf  = Buffer.alloc(4);

  const results = [];

  const cb = koffi.register((hwnd, _) => {
    if (!IsWindowVisible(hwnd)) return true;
    const titleLen = GetWindowTextW(hwnd, titleBuf, 512);
    if (titleLen <= 0) return true;
    const title = titleBuf.toString('utf16le', 0, titleLen * 2);

    GetWindowThreadProcessId(hwnd, pidBuf);
    const pid = pidBuf.readUInt32LE(0);
    if (!pid) return true;

    const classLen = GetClassNameW(hwnd, classBuf, 256);
    const windowClass = classLen > 0 ? classBuf.toString('utf16le', 0, classLen * 2) : '';

    const hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!hProcess) return true;

    sizeBuf.writeUInt32LE(MAX_PATH, 0);
    const ok = QueryFullProcessImageNameW(hProcess, 0, nameBuf, sizeBuf);
    CloseHandle(hProcess);

    let exeFile = null;
    if (ok) {
      const sz = sizeBuf.readUInt32LE(0);
      const fullPath = nameBuf.toString('utf16le', 0, sz * 2);
      exeFile = path.win32.basename(fullPath);
    }

    const processName = exeFile ? exeFile.replace(/\.exe$/i, '') : '';
    if (SYSTEM_PROCS.has(processName.toLowerCase())) return true;

    results.push({
      title,
      process:     processName,
      exe:         exeFile || `${processName}.exe`,
      windowClass: windowClass || processName,
    });
    return true;
  }, koffi.pointer(WNDPROC_WU));

  try {
    EnumWindows_WU(cb, 0);
  } finally {
    koffi.unregister(cb);
  }

  return results;
}

/**
 * List all running user-space processes with window presence flag.
 * Replaces the PowerShell windows:list-running-apps handler.
 */
function listRunningApps() {
  const SKIP = new Set([
    'svchost', 'conhost', 'csrss', 'dwm', 'smss', 'lsass', 'wininit',
    'services', 'registry', 'idle', 'system', 'audiodg', 'runtimebroker',
    'searchhost', 'textinputhost', 'shellexperiencehost', 'applicationframehost',
    'startmenuexperiencehost', 'systemsettings', 'taskhostw', 'sihost',
    'fontdrvhost', 'nissrv', 'msmpeng',
  ]);

  // Step 1: collect PIDs that have a visible window with a title
  const titleBuf = Buffer.alloc(512 * 2);
  const pidBuf   = Buffer.alloc(4);
  const windowPids = new Set();

  const cb = koffi.register((hwnd, _) => {
    if (!IsWindowVisible(hwnd)) return true;
    const len = GetWindowTextW(hwnd, titleBuf, 512);
    if (len > 0) {
      GetWindowThreadProcessId(hwnd, pidBuf);
      const pid = pidBuf.readUInt32LE(0);
      if (pid) windowPids.add(pid);
    }
    return true;
  }, koffi.pointer(WNDPROC_WU));

  try {
    EnumWindows_WU(cb, 0);
  } finally {
    koffi.unregister(cb);
  }

  // Step 2: enumerate all processes
  const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snapshot) return [];

  const procBuf = Buffer.alloc(PROC_STRUCT_SIZE);
  procBuf.writeUInt32LE(PROC_STRUCT_SIZE, 0);

  const seen = new Map();
  if (Process32FirstW(snapshot, procBuf)) {
    do {
      const pid     = procBuf.readUInt32LE(PID_OFFSET);
      const exeName = procBuf.toString('utf16le', EXE_OFFSET, EXE_OFFSET + MAX_PATH * 2)
        .split('\0')[0];
      if (!exeName) continue;

      const nameLower = exeName.toLowerCase().replace(/\.exe$/i, '');
      if (SKIP.has(nameLower)) continue;
      if (pid === process.pid) continue;

      const nameNoExt  = exeName.replace(/\.exe$/i, '');
      const hasWindow  = windowPids.has(pid);

      if (!seen.has(nameNoExt) || hasWindow) {
        seen.set(nameNoExt, { name: nameNoExt, exe: exeName, hasWindow });
      }
    } while (Process32NextW(snapshot, procBuf));
  }
  CloseHandle(snapshot);

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// WAVEINCAPSW / WAVEOUTCAPSW constants
const WAVE_CAPS_SIZE  = 84; // covers both (WAVEOUTCAPSW is larger at 84; WAVEINCAPSW is 80)
const WAVE_PNAME_OFF  = 8;  // szPname starts after wMid(2)+wPid(2)+vDriverVersion(4)
const MAXPNAMELEN     = 32; // WCHAR[32]

/**
 * List audio input and output devices using the wave API.
 * Replaces the PowerShell windows:list-audio-devices handler.
 */
function listAudioDevices() {
  const devices = [];
  const capsBuf = Buffer.alloc(WAVE_CAPS_SIZE);

  const inCount = waveInGetNumDevs();
  for (let i = 0; i < inCount; i++) {
    capsBuf.fill(0);
    if (waveInGetDevCapsW(i, capsBuf, WAVE_CAPS_SIZE) !== 0) continue;
    const name = capsBuf.toString('utf16le', WAVE_PNAME_OFF, WAVE_PNAME_OFF + MAXPNAMELEN * 2)
      .split('\0')[0];
    if (name) devices.push({ name, type: 'input', id: name });
  }

  const outCount = waveOutGetNumDevs();
  for (let i = 0; i < outCount; i++) {
    capsBuf.fill(0);
    if (waveOutGetDevCapsW(i, capsBuf, WAVE_CAPS_SIZE) !== 0) continue;
    const name = capsBuf.toString('utf16le', WAVE_PNAME_OFF, WAVE_PNAME_OFF + MAXPNAMELEN * 2)
      .split('\0')[0];
    if (name) devices.push({ name, type: 'output', id: name });
  }

  return devices;
}

/**
 * Extract the large icon for processName and save as PNG to outPath.
 * Returns outPath on success, null on failure.
 * Replaces the PowerShell windows:extractIcon handler.
 */
async function extractProcessIcon(processName, outPath) {
  const SHGFI_ICON      = 0x0100;
  const SHGFI_LARGEICON = 0x0000;
  const DIB_RGB_COLORS  = 0;

  try {
    const exePath = _findExePathForProcess(processName);
    if (!exePath) return null;

    // Get the icon handle via SHGetFileInfoW
    const shfi = {
      hIcon: null, iIcon: 0, dwAttributes: 0,
      szDisplayName: new Array(260).fill(0),
      szTypeName:    new Array(80).fill(0),
    };
    const sres = SHGetFileInfoW(exePath, 0, shfi, koffi.sizeof(SHFILEINFOW_S), SHGFI_ICON | SHGFI_LARGEICON);
    if (!sres || !shfi.hIcon) return null;

    let hbmColor = null;
    let hbmMask  = null;
    let hDC      = null;

    try {
      // Get bitmap handle from icon
      const iconInfo = { fIcon: false, xHotspot: 0, yHotspot: 0, hbmMask: null, hbmColor: null };
      if (!GetIconInfo(shfi.hIcon, iconInfo) || !iconInfo.hbmColor) return null;
      hbmColor = iconInfo.hbmColor;
      hbmMask  = iconInfo.hbmMask;

      // Get bitmap dimensions
      const bm = { bmType: 0, bmWidth: 0, bmHeight: 0, bmWidthBytes: 0, bmPlanes: 0, bmBitsPixel: 0, bmBits: null };
      if (!GetObjectW(hbmColor, koffi.sizeof(BITMAP_S), bm)) return null;

      const w = Math.abs(bm.bmWidth);
      const h = Math.abs(bm.bmHeight);
      if (!w || !h) return null;

      // Create device context
      hDC = CreateCompatibleDC(null);
      if (!hDC) return null;

      // Build BITMAPINFOHEADER (40 bytes) for 32-bit top-down DIB
      const bmiBuffer = Buffer.alloc(40);
      bmiBuffer.writeUInt32LE(40, 0);   // biSize
      bmiBuffer.writeInt32LE(w, 4);     // biWidth
      bmiBuffer.writeInt32LE(-h, 8);    // biHeight (negative = top-down)
      bmiBuffer.writeUInt16LE(1, 12);   // biPlanes
      bmiBuffer.writeUInt16LE(32, 14);  // biBitCount (32-bit BGRA)
      // biCompression and rest = 0 (BI_RGB)

      // Extract pixel data (BGRA)
      const pixelBuf = Buffer.alloc(w * h * 4);
      const linesGot = GetDIBits(hDC, hbmColor, 0, h, pixelBuf, bmiBuffer, DIB_RGB_COLORS);
      if (!linesGot) return null;

      // Convert BGRA → RGBA in-place
      for (let i = 0; i < pixelBuf.length; i += 4) {
        const b = pixelBuf[i];
        pixelBuf[i]     = pixelBuf[i + 2]; // R
        pixelBuf[i + 2] = b;               // B
      }

      // Save as PNG via Jimp
      const { Jimp } = require('jimp');
      const img = new Jimp({ width: w, height: h, data: pixelBuf });
      await img.write(outPath);

      return outPath;
    } finally {
      if (hDC)      DeleteDC(hDC);
      if (hbmColor) DeleteObject(hbmColor);
      if (hbmMask)  DeleteObject(hbmMask);
      if (shfi.hIcon) DestroyIcon(shfi.hIcon);
    }
  } catch (err) {
    console.error('[winUtils] extractProcessIcon:', err.message);
    return null;
  }
}

/**
 * Launch the current Electron executable elevated (UAC) and have it perform
 * file-system operations.  Polls for a result JSON file.
 * Returns Promise<{ success, message? }>.
 */
async function runElevatedOps(ops) {
  const { app } = require('electron');
  const id         = Date.now();
  const paramFile  = path.join(os.tmpdir(), `openclip-params-${id}.json`);
  const resultFile = path.join(os.tmpdir(), `openclip-result-${id}.json`);

  // Build param file
  fs.writeFileSync(paramFile, JSON.stringify({ ops, resultFile }), 'utf-8');

  // Build args string — in dev mode, pass the app script as first arg
  const appScript = !app.isPackaged && process.argv[1] ? `"${process.argv[1]}" ` : '';
  const paramsStr = `${appScript}--elevated-helper --param-file="${paramFile}" --result-file="${resultFile}"`;
  const exePath   = process.execPath;

  try {
    const hres = ShellExecuteW(null, 'runas', exePath, paramsStr, null, 0);
    if (Number(hres) <= 32) {
      return { success: false, message: 'Failed to launch elevated process (access denied).' };
    }

    // Poll for the result file (max 30 s)
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      Sleep(200);
      if (fs.existsSync(resultFile)) {
        try {
          const r = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
          return r;
        } catch {
          return { success: false, message: 'Could not parse elevated process result.' };
        } finally {
          try { fs.rmSync(resultFile, { force: true }); } catch {}
          try { fs.rmSync(paramFile,  { force: true }); } catch {}
        }
      }
    }

    return { success: false, message: 'Elevated process timed out or UAC was cancelled.' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { fs.rmSync(paramFile, { force: true }); } catch {}
  }
}

module.exports = {
  getDiskFreeSpace,
  listWindowsWithProcesses,
  listRunningApps,
  listAudioDevices,
  extractProcessIcon,
  runElevatedOps,
};
