/**
 * Run PowerShell lines in an elevated (UAC) process.
 * Writes a temp .ps1, launches it via Start-Process -Verb RunAs -Wait, and reads
 * a result file the elevated script writes.  Returns { success, message? }.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function runElevated(psLines) {
  const { execSync } = require('child_process');
  const id = Date.now();
  const scriptPath = path.join(os.tmpdir(), `openclip-install-${id}.ps1`);
  const resultPath = path.join(os.tmpdir(), `openclip-result-${id}.txt`);
  const esc = p => p.replace(/'/g, "''"); // PS single-quote escape

  const script = [
    'try {',
    ...psLines.map(l => `  ${l}`),
    `  Set-Content -Path '${esc(resultPath)}' -Value 'ok' -Encoding UTF8`,
    '} catch {',
    `  Set-Content -Path '${esc(resultPath)}' -Value $_.Exception.Message -Encoding UTF8`,
    '}',
  ].join('\r\n');

  fs.writeFileSync(scriptPath, script, 'utf-8');

  try {
    execSync(
      `powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${esc(scriptPath)}')"`,
      { stdio: 'pipe', windowsHide: true }
    );
  } catch {
    return { success: false, message: 'Administrator permission was denied.' };
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch {}
  }

  try {
    const result = fs.readFileSync(resultPath, 'utf-8').trim();
    fs.rmSync(resultPath, { force: true });
    if (result === 'ok') return { success: true };
    return { success: false, message: result };
  } catch {
    return { success: false, message: 'Elevated installer did not produce a result — UAC may have been cancelled.' };
  }
}

module.exports = { runElevated };
