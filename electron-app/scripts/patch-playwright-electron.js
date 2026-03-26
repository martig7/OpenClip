#!/usr/bin/env node
/**
 * Patches playwright-core's Electron launcher to use a fixed DevTools port
 * instead of --remote-debugging-port=0, which Electron 34+ rejects.
 *
 * Run automatically via `postinstall`. Safe to re-run (idempotent).
 */
'use strict'

const fs = require('fs')
const path = require('path')

const file = path.resolve(
  __dirname,
  '../node_modules/playwright-core/lib/server/electron/electron.js'
)

if (!fs.existsSync(file)) {
  console.log('[patch-playwright-electron] playwright-core not found — skipping.')
  process.exit(0)
}

const original = fs.readFileSync(file, 'utf-8')

const NEEDLE = '"--remote-debugging-port=0"'
const REPLACEMENT = '"--remote-debugging-port=9222"'

if (!original.includes(NEEDLE)) {
  if (original.includes(REPLACEMENT)) {
    console.log('[patch-playwright-electron] Already patched — no action needed.')
  } else {
    console.warn('[patch-playwright-electron] Pattern not found — Playwright internals may have changed.')
  }
  process.exit(0)
}

const patched = original.replace(NEEDLE, REPLACEMENT)
fs.writeFileSync(file, patched, 'utf-8')
console.log('[patch-playwright-electron] Patched: --remote-debugging-port=0 → 9222')
