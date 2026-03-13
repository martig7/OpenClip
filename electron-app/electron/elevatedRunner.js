/**
 * Elevated runner — triggers a UAC-elevated file operation via ShellExecuteExW.
 *
 * Strategy (no PowerShell, no temp .ps1):
 *   1. Write the operation to a temp JSON file.
 *   2. Call ShellExecuteExW("runas", <this exe>, "--openclip-elevated-helper <opFile> <resultFile>")
 *      → Windows shows the UAC prompt.
 *   3. Block on WaitForSingleObject until the elevated subprocess finishes.
 *   4. Read the result JSON written by elevatedHelper.js and return it.
 *
 * In packaged builds, "this exe" is the already-signed OpenClip.exe.
 * In dev mode,       "this exe" is electron.exe + path to main.js.
 *
 * SHELLEXECUTEINFOW layout on x64 Windows (112 bytes, C ABI alignment):
 *    0  cbSize      uint32
 *    4  fMask       uint32
 *    8  hwnd        void *
 *   16  lpVerb      char16 *
 *   24  lpFile      char16 *
 *   32  lpParameters char16 *
 *   40  lpDirectory  char16 *
 *   48  nShow        int        (+ 4 bytes implicit padding before hInstApp)
 *   56  hInstApp     void *
 *   64  lpIDList     void *
 *   72  lpClass      char16 *
 *   80  hkeyClass    void *
 *   88  dwHotKey     uint32     (+ 4 bytes implicit padding before hIcon)
 *   96  hIcon        void *     (DUMMYUNIONNAME)
 *  104  hProcess     void *
 * Total: 112 bytes
 */
'use strict';
const koffi  = require('koffi');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ── Win32 DLLs ───────────────────────────────────────────────────────────────
const kernel32 = koffi.load('kernel32.dll');
const shell32  = koffi.load('shell32.dll');

// ── SHELLEXECUTEINFOW struct ──────────────────────────────────────────────────
// koffi follows C ABI alignment, so it inserts the required padding automatically.
const SHELLEXECUTEINFOW = koffi.struct('SHELLEXECUTEINFOW', {
  cbSize:        'uint32',
  fMask:         'uint32',
  hwnd:          'void *',
  lpVerb:        'char16 *',
  lpFile:        'char16 *',
  lpParameters:  'char16 *',
  lpDirectory:   'char16 *',
  nShow:         'int',
  hInstApp:      'void *',
  lpIDList:      'void *',
  lpClass:       'char16 *',
  hkeyClass:     'void *',
  dwHotKey:      'uint32',
  hIcon:         'void *',
  hProcess:      'void *',
});

// ── Sanity-check struct layout matches the documented C ABI ──────────────────
if (koffi.sizeof(SHELLEXECUTEINFOW) !== 112) {
  throw Object.assign(
    new Error(`SHELLEXECUTEINFOW size mismatch: expected 112 bytes, got ${koffi.sizeof(SHELLEXECUTEINFOW)}`),
    { errorKind: 'dependency-missing' }
  );
}

// ── Win32 function bindings ───────────────────────────────────────────────────
const ShellExecuteExW    = shell32.func('bool __stdcall ShellExecuteExW(SHELLEXECUTEINFOW *pExecInfo)');
const WaitForSingleObject = kernel32.func('uint32 __stdcall WaitForSingleObject(void *hHandle, uint32 dwMilliseconds)');
const CloseHandle         = kernel32.func('bool __stdcall CloseHandle(void *hObject)');
const GetLastError        = kernel32.func('uint32 __stdcall GetLastError()');

// ── Constants ────────────────────────────────────────────────────────────────
const SEE_MASK_NOCLOSEPROCESS = 0x00000040;
const SEE_MASK_NOASYNC        = 0x00000100;
const SW_HIDE                 = 0;
const WAIT_TIMEOUT_CODE       = 0x00000102;
const WAIT_FAILED_CODE        = 0xFFFFFFFF;
const ERROR_CANCELLED         = 1223; // UAC cancelled by user
const ERROR_ACCESS_DENIED     = 5;
const ELEVATION_TIMEOUT_MS    = 120_000; // 2 minutes

/**
 * Run a privileged file operation via ShellExecuteExW("runas") — no PowerShell.
 * Blocks until the elevated subprocess completes or times out.
 *
 * @param {{ op: string, [key: string]: any }} operation
 * @returns {{ success: boolean, message?: string }}
 */
function runElevatedOp(operation) {
  const { app } = require('electron');

  const id = crypto.randomBytes(8).toString('hex');
  const opFile     = path.join(os.tmpdir(), `openclip-op-${id}.json`);
  const resultFile = path.join(os.tmpdir(), `openclip-result-${id}.json`);

  fs.writeFileSync(opFile, JSON.stringify(operation), 'utf-8');

  // ── Build invocation args ─────────────────────────────────────────────────
  // Wrap paths in double-quotes so spaces are handled correctly.
  const helperFlag = `--openclip-elevated-helper "${opFile}" "${resultFile}"`;
  let exePath, params;
  if (app.isPackaged) {
    // Packaged: re-invoke the already-signed .exe in helper mode
    exePath = process.execPath;
    params  = helperFlag;
  } else {
    // Dev: invoke electron.exe with the main script + helper flag
    exePath = process.execPath;
    params  = `"${path.join(__dirname, 'main.js')}" ${helperFlag}`;
  }

  // ── Build SHELLEXECUTEINFOW ───────────────────────────────────────────────
  const sei = {
    cbSize:       koffi.sizeof(SHELLEXECUTEINFOW),
    fMask:        SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
    hwnd:         null,
    lpVerb:       'runas',
    lpFile:       exePath,
    lpParameters: params,
    lpDirectory:  null,
    nShow:        SW_HIDE,
    hInstApp:     null,
    lpIDList:     null,
    lpClass:      null,
    hkeyClass:    null,
    dwHotKey:     0,
    hIcon:        null,
    hProcess:     null,
  };

  const ok = ShellExecuteExW(koffi.inout(sei));

  if (!ok) {
    try { fs.rmSync(opFile, { force: true }); } catch {}
    const err = GetLastError();
    if (err === ERROR_CANCELLED || err === ERROR_ACCESS_DENIED) {
      return { success: false, errorKind: 'uac-cancelled', message: 'Administrator permission was denied — UAC was cancelled.' };
    }
    return { success: false, errorKind: 'permission-denied', message: `Elevated process could not start (error ${err}).` };
  }

  const hProcess = sei.hProcess;
  if (!hProcess) {
    try { fs.rmSync(opFile, { force: true }); } catch {}
    return { success: false, errorKind: 'dependency-missing', message: 'Elevated process handle unavailable.' };
  }

  // ── Wait for helper to finish ─────────────────────────────────────────────
  const waitResult = WaitForSingleObject(hProcess, ELEVATION_TIMEOUT_MS);
  CloseHandle(hProcess);

  if (waitResult === WAIT_TIMEOUT_CODE) {
    return { success: false, errorKind: 'timeout', message: 'Elevated operation timed out — the UAC prompt may have been left open.' };
  }
  if (waitResult === WAIT_FAILED_CODE) {
    return { success: false, errorKind: 'wait-failed', message: 'Waiting for elevated process failed unexpectedly.' };
  }

  // ── Read result written by elevatedHelper.js ──────────────────────────────
  try {
    const resultJson = fs.readFileSync(resultFile, 'utf-8');
    try { fs.rmSync(resultFile, { force: true }); } catch {}
    const parsed = JSON.parse(resultJson);
    if (parsed && parsed.success === false) {
      parsed.errorKind = 'op-failed';
    }
    return parsed;
  } catch {
    // Result file absent → helper didn't run (AV blocked it, or UAC was denied
    // before the process started) vs a genuine permission denial
    return { success: false, errorKind: 'av-blocked', message: 'Elevated installer did not produce a result. The operation may have been blocked by antivirus or UAC was cancelled.' };
  }
}

module.exports = { runElevatedOp };
