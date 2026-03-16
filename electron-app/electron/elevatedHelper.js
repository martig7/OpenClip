'use strict';
/**
 * Elevated helper mode: runs when the app is re-launched as administrator via
 * ShellExecuteW("runas"). Performs simple file-system operations from a JSON
 * param file, writes a JSON result file, then exits.  No Electron APIs needed.
 */
const fs = require('fs');
const path = require('path');

function run() {
  const args = process.argv;

  function getArg(prefix) {
    const a = args.find(a => a.startsWith(prefix));
    return a ? a.slice(prefix.length).replace(/^"(.*)"$/, '$1') : null;
  }

  const paramFile  = getArg('--param-file=');
  const resultFile = getArg('--result-file=');

  function writeResult(obj) {
    const dest = resultFile || (paramFile && paramFile.replace('params', 'result'));
    if (dest) {
      try { fs.writeFileSync(dest, JSON.stringify(obj), 'utf-8'); } catch {}
    }
  }

  if (!paramFile) {
    writeResult({ success: false, message: 'Missing --param-file argument' });
    process.exit(1);
  }

  try {
    const params = JSON.parse(fs.readFileSync(paramFile, 'utf-8'));
    const dest   = resultFile || params.resultFile;

    for (const op of (params.ops || [])) {
      switch (op.type) {
        case 'mkdir':
          fs.mkdirSync(op.path, { recursive: true });
          break;
        case 'copy':
          fs.mkdirSync(path.dirname(op.dest), { recursive: true });
          fs.copyFileSync(op.src, op.dest);
          break;
        case 'delete':
          fs.rmSync(op.path, { force: true, recursive: !!op.recursive });
          break;
        case 'write':
          fs.mkdirSync(path.dirname(op.path), { recursive: true });
          fs.writeFileSync(op.path, op.content ?? '', 'utf-8');
          break;
        default:
          throw new Error(`Unknown op type: ${op.type}`);
      }
    }

    if (dest) {
      try { fs.writeFileSync(dest, JSON.stringify({ success: true }), 'utf-8'); } catch {}
    }
    try { fs.rmSync(paramFile, { force: true }); } catch {}
  } catch (err) {
    writeResult({ success: false, message: err.message });
  }

  process.exit(0);
}

module.exports = { run };
