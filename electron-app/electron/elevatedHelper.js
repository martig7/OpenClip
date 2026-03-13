/**
 * Elevated helper — invoked by the Electron app itself when re-launched with
 * --openclip-elevated-helper via ShellExecuteExW("runas").
 *
 * Reads a JSON operation file, performs the requested privileged file-system
 * operations, writes a result JSON, and the caller (elevatedRunner.js) reads it.
 *
 * Operations:
 *   install-plugin: { dllSrc, sysDest, sysPluginDir, sysLocaleDir, sysLocale }
 *   remove-plugin:  { sysDest, sysLocale }
 */
'use strict';
const fs   = require('fs');
const path = require('path');

function runHelperOp(opFile, resultFile) {
  if (!opFile || !resultFile) {
    writeResult(resultFile, { success: false, message: 'Helper invoked with missing arguments.' });
    return;
  }

  let op;
  try {
    op = JSON.parse(fs.readFileSync(opFile, 'utf-8'));
  } catch (e) {
    writeResult(resultFile, { success: false, message: `Cannot read op file: ${e.message}` });
    return;
  }
  // Delete the op file now that we have the data (reduce exposure window)
  try { fs.rmSync(opFile, { force: true }); } catch {}

  let result;
  try {
    result = performOp(op);
  } catch (e) {
    result = { success: false, message: e.message };
  }

  writeResult(resultFile, result);
}

function writeResult(resultFile, result) {
  if (!resultFile) return;
  try {
    fs.writeFileSync(resultFile, JSON.stringify(result), 'utf-8');
  } catch (e) {
    // Can't signal result — caller will time out and report cancellation
    console.error('[elevated-helper] writeResult failed:', e.message);
  }
}

function assertAbsolute(p, label) {
  if (!p || !path.isAbsolute(p)) throw new Error(`${label} must be an absolute path: ${p}`);
}

function performOp(op) {
  switch (op.op) {
    case 'install-plugin': {
      const { dllSrc, sysDest, sysPluginDir, sysLocaleDir, sysLocale } = op;
      assertAbsolute(dllSrc,       'dllSrc');
      assertAbsolute(sysDest,      'sysDest');
      assertAbsolute(sysPluginDir, 'sysPluginDir');
      assertAbsolute(sysLocaleDir, 'sysLocaleDir');
      assertAbsolute(sysLocale,    'sysLocale');

      fs.mkdirSync(sysPluginDir, { recursive: true });
      fs.copyFileSync(dllSrc, sysDest);
      fs.mkdirSync(sysLocaleDir, { recursive: true });
      if (!fs.existsSync(sysLocale)) fs.writeFileSync(sysLocale, '');
      return { success: true };
    }

    case 'remove-plugin': {
      const { sysDest, sysLocale } = op;
      assertAbsolute(sysDest,  'sysDest');
      assertAbsolute(sysLocale, 'sysLocale');

      if (fs.existsSync(sysDest))  fs.rmSync(sysDest,  { force: true });
      if (fs.existsSync(sysLocale)) fs.rmSync(sysLocale, { recursive: true, force: true });
      return { success: true };
    }

    default:
      throw new Error(`Unknown elevated operation: ${op.op}`);
  }
}

module.exports = { runHelperOp };
