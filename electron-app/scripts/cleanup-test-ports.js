#!/usr/bin/env node
const { execSync } = require('child_process')

const PORT = parseInt(process.env.OPENCLIP_API_PORT || '47531', 10)

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function getWindowsListeningPids(port) {
  let out = ''
  try {
    out = run(`netstat -ano -p tcp | findstr :${port}`)
  } catch {
    return []
  }
  const pids = new Set()
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!/LISTENING/i.test(line)) continue
    const parts = line.trim().split(/\s+/)
    const pid = parts[parts.length - 1]
    if (/^\d+$/.test(pid)) pids.add(pid)
  }
  return [...pids]
}

function isKillableWindowsProcess(pid) {
  try {
    const out = run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`)
    const row = out.trim().toLowerCase()
    // Only kill likely local dev/test process owners.
    return (
      row.includes('node.exe') ||
      row.includes('electron.exe') ||
      row.includes('open clip.exe') ||
      row.includes('openclip.exe')
    )
  } catch {
    return false
  }
}

function killWindowsPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function getUnixListeningPids(port) {
  try {
    const out = run(`lsof -ti tcp:${port} -sTCP:LISTEN`)
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
  } catch {
    return []
  }
}

function cleanupPort(port) {
  if (process.platform === 'win32') {
    const pids = getWindowsListeningPids(port)
    if (pids.length === 0) {
      console.log(`[cleanup-test-ports] No listener on ${port}.`)
      return
    }
    let killed = 0
    for (const pid of pids) {
      if (!isKillableWindowsProcess(pid)) {
        console.warn(
          `[cleanup-test-ports] Skipping PID ${pid} on ${port} (not a node/electron process).`
        )
        continue
      }
      if (killWindowsPid(pid)) {
        killed++
        console.log(`[cleanup-test-ports] Killed PID ${pid} using port ${port}.`)
      }
    }
    if (killed === 0) {
      console.warn(
        `[cleanup-test-ports] Port ${port} still may be occupied. No eligible process was killed.`
      )
    }
    return
  }

  const pids = getUnixListeningPids(port)
  if (pids.length === 0) {
    console.log(`[cleanup-test-ports] No listener on ${port}.`)
    return
  }
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM')
      console.log(`[cleanup-test-ports] Sent SIGTERM to PID ${pid} on ${port}.`)
    } catch {}
  }
}

cleanupPort(PORT)
