'use strict'
/**
 * Run file-system operations in an elevated (UAC) process.
 * Uses ShellExecuteW("runas") via koffi — no PowerShell spawned.
 * Returns Promise<{ success, message? }>.
 *
 * ops: Array of operation objects:
 *   { type: 'mkdir',  path }
 *   { type: 'copy',   src, dest }
 *   { type: 'delete', path, recursive? }
 *   { type: 'write',  path, content? }
 */
const { runElevatedOps } = require('./winUtils')

async function runElevated(ops) {
  try {
    return await runElevatedOps(ops)
  } catch (err) {
    return { success: false, message: err.message }
  }
}

module.exports = { runElevated }
