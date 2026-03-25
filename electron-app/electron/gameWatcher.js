const fs = require('fs')
const path = require('path')
const { RUNTIME_DIR, STATE_FILE, PID_FILE, LOG_FILE, ICONS_DIR } = require('./constants')
const { getRunningProcessNames, getWindowTitles } = require('./processDetector')
const {
  startRecording,
  stopRecording,
  addAudioSourceToScenes,
  removeAudioSourceFromScenes,
  setInputAudioTracks,
  isPluginReachable,
} = require('./obsPlugin')

const FULLSCREEN_AUDIO_SOURCE_PREFIX = 'Game Audio (Fullscreen'

function buildWindowBinding(game) {
  const exe = game?.exe || ''
  const windowClass = game?.windowClass || game?.selector || ''
  const title = game?.selector || game?.name || game?.exe || ''
  return `${title}:${windowClass}:${exe}`
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf-8')
  } catch {}
}

function detectRunningGame(games) {
  const processes = getRunningProcessNames().map((p) => p.toLowerCase())
  const titles = getWindowTitles().map((t) => t.toLowerCase())

  for (const game of games) {
    if (!game.enabled) continue

    const priority = game.windowMatchPriority ?? 0
    const titleStr = (game.selector || '').toLowerCase()
    const exeName = (game.exe || '').toLowerCase()

    // Skip games with neither a usable selector nor an exe binding.
    if (!exeName && !titleStr) continue

    // Mirror OBS window_match_priority values:
    //   0 — Match title, otherwise find window of same type  → title match only
    //   1 — Match title, otherwise find window of same exe   → title match, then exe fallback
    //   2 — Match executable                                 → exe only
    if (priority === 2) {
      // Exe-only: exact process name match (same logic OBS uses for "match executable").
      // Requires game.exe to be set; if not set, this game is skipped.
      if (exeName && processes.some((p) => p === exeName)) return game
    } else if (priority === 1) {
      // Title first, exe fallback (OBS priority 1).
      if (titleStr && titles.some((t) => t.includes(titleStr))) return game
      if (exeName && processes.some((p) => p === exeName)) return game
    } else {
      // Default (priority 0): title match only.
      // If no exe binding exists also check process names as a convenience (manual selectors).
      if (titleStr && titles.some((t) => t.includes(titleStr))) return game
      if (!exeName && titleStr && processes.some((p) => p.includes(titleStr))) return game
    }
  }

  return null
}

function detectFullscreenFallback(games, fsConfig) {
  if (!fsConfig?.enabled || !fsConfig?.defaultScene) return null

  const { getFullscreenProcesses } = require('./winUtils')
  const fullscreen = getFullscreenProcesses()
  if (fullscreen.length === 0) return null

  const fw = fullscreen[0]
  const exeLower = (fw.exe || '').toLowerCase()

  const alreadyCovered = games.some((g) => (g.exe || '').toLowerCase() === exeLower)
  if (alreadyCovered) return null

  return {
    _isFullscreenFallback: true,
    name: fw.process,
    exe: fw.exe,
    windowClass: fw.windowClass,
    selector: fw.title,
    windowMatchPriority: 2,
    scene: fsConfig.defaultScene,
    isAutoDetected: true,
    enabled: true,
  }
}

function setupGameWatcher(store, onStateChange, onOrganizeProgress = () => {}, onGamesUpdate = () => {}) {
  let lastGame = null
  let obsWasReachable = false
  let lastFullscreenAudioKey = null
  let lastFullscreenAudioSourceName = null
  let lastFullscreenAudioScene = null
  let stopped = false
  const organizeQueue = []
  let organizing = false

  async function syncFullscreenProcessAudio(game) {
    const fsConfig = store.get('fullscreenRecording')
    if (!fsConfig?.enabled || !fsConfig?.defaultScene) return
    if (fsConfig?.gameAudioEnabled === false) return
    if (!game?.scene || game.scene !== fsConfig.defaultScene) return
    const masterAudioSources = store.get('masterAudioSources') || []
    const wantsGameAudio = masterAudioSources.some((s) => s?.kind === 'magic_game_audio')
    if (!wantsGameAudio) return

    const window = buildWindowBinding(game)
    const exeKey = (game.exe || game.name || 'unknown').toLowerCase()
    const nextKey = `${fsConfig.defaultScene}|${window}|${exeKey}`
    if (nextKey === lastFullscreenAudioKey) return
    const sourceName = `${FULLSCREEN_AUDIO_SOURCE_PREFIX} ${exeKey})`

    if (lastFullscreenAudioSourceName && lastFullscreenAudioSourceName !== sourceName) {
      await removeAudioSourceFromScenes(
        undefined,
        [lastFullscreenAudioScene || fsConfig.defaultScene],
        lastFullscreenAudioSourceName
      ).catch(() => {})
    }

    const addResult = await addAudioSourceToScenes(
      undefined,
      [fsConfig.defaultScene],
      'wasapi_process_output_capture',
      sourceName,
      {
        window,
        window_match_priority: 2,
      }
    )

    if (!addResult?.success) {
      throw new Error(addResult?.message || 'Failed to sync fullscreen process audio')
    }

    const savedTracks = store.get('audioTracks') || {}
    const perSourceTracks = savedTracks[sourceName]
    const gameAudioTracks =
      perSourceTracks && typeof perSourceTracks === 'object' && Object.keys(perSourceTracks).length > 0
        ? perSourceTracks
        : savedTracks['Game Audio']
    if (gameAudioTracks && typeof gameAudioTracks === 'object') {
      await setInputAudioTracks(undefined, sourceName, gameAudioTracks).catch(() => {})
    }

    lastFullscreenAudioKey = nextKey
    lastFullscreenAudioSourceName = sourceName
    lastFullscreenAudioScene = fsConfig.defaultScene
  }

  async function cleanupFullscreenProcessAudio() {
    if (!lastFullscreenAudioSourceName || !lastFullscreenAudioScene) return
    await removeAudioSourceFromScenes(
      undefined,
      [lastFullscreenAudioScene],
      lastFullscreenAudioSourceName
    ).catch(() => {})
    lastFullscreenAudioKey = null
    lastFullscreenAudioSourceName = null
    lastFullscreenAudioScene = null
  }

  function drainOrganizeQueue() {
    if (organizing || organizeQueue.length === 0) return
    organizing = true
    const gameName = organizeQueue.shift()
    const { organizeRecordings } = require('./fileManager')
    // .finally runs as a new microtask, so calling drainOrganizeQueue here is safe (no call-stack buildup).
    organizeRecordings(store, gameName, onOrganizeProgress)
      .catch((err) => {
        log(`Organize failed: ${err.stack || err.message}`)
        onOrganizeProgress({ phase: 'error', gameName, error: err.message || 'Organize failed' })
      })
      .finally(() => {
        organizing = false
        drainOrganizeQueue()
      })
  }

  function scheduleOrganize(gameName) {
    setTimeout(() => {
      // Skip if an identical game is already waiting in the queue.
      if (!organizeQueue.includes(gameName)) {
        organizeQueue.push(gameName)
      }
      drainOrganizeQueue()
    }, 8000)
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  try {
    fs.writeFileSync(LOG_FILE, '', 'utf-8')
  } catch {}
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8')
  } catch {}
  writeGameState('IDLE')
  log(`Watcher started (pid ${process.pid})`)

  function poll() {
    if (stopped) return

    const games = store.get('games') || []
    let detected = detectRunningGame(games)

    if (!detected) {
      const fsConfig = store.get('fullscreenRecording')
      const fallback = detectFullscreenFallback(games, fsConfig)
      if (fallback) {
        const exeLower = (fallback.exe || '').toLowerCase()
        const existing = games.find((g) => (g.exe || '').toLowerCase() === exeLower)
        if (existing) {
          detected = existing
        } else {
          const settings = store.get('settings') || {}
          if (settings.autoRegisterFullscreenApps === true) {
            const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
            const newGame = {
              id: newId,
              name: fallback.name,
              exe: fallback.exe,
              windowClass: fallback.windowClass,
              selector: fallback.selector,
              windowMatchPriority: 2,
              scene: fallback.scene,
              isAutoDetected: true,
              enabled: true,
            }
            store.set('games', [...games, newGame])
            log(`Auto-registered fullscreen app: ${fallback.name}`)
            onGamesUpdate()
            Promise.resolve()
              .then(async () => {
                const { extractProcessIcon } = require('./winUtils')
                fs.mkdirSync(ICONS_DIR, { recursive: true })
                const processName = fallback.exe || fallback.name
                const outPath = path.join(ICONS_DIR, `${path.basename(processName)}.png`)
                const iconPath = await extractProcessIcon(processName, outPath)
                if (!iconPath) return

                const latestGames = store.get('games') || []
                const idx = latestGames.findIndex((g) => g.id === newId)
                if (idx < 0) return
                latestGames[idx] = { ...latestGames[idx], icon_path: iconPath }
                store.set('games', latestGames)
                onGamesUpdate()
              })
              .catch((err) => {
                log(`Fullscreen icon extraction failed: ${err.message}`)
              })
            detected = newGame
          } else {
            // Record using the fallback config without registering to the games list
            detected = {
              name: '(Unorganized)',
              exe: fallback.exe,
              windowClass: fallback.windowClass,
              selector: fallback.selector,
              scene: fallback.scene,
              isAutoDetected: true,
              enabled: true,
            }
          }
        }
      }
    }

    if (detected && !lastGame) {
      lastGame = detected
      obsWasReachable = true // optimistic: assume OBS is reachable; isPluginReachable will correct if not
      writeGameState(`RECORDING|${detected.name}|${detected.scene || ''}`)
      log(`Game detected: ${detected.name}`)
      onStateChange({ currentGame: detected.name, status: 'recording' })
      // Tell the OBS plugin to start recording (best-effort, OBS may not be running)
      syncFullscreenProcessAudio(detected)
        .catch((err) => log(`Fullscreen process audio sync failed: ${err.message}`))
        .finally(() => {
          startRecording(detected.scene || undefined).catch((err) =>
            log(`Plugin startRecording failed: ${err.message}`)
          )
        })
    } else if (!detected && lastGame) {
      const stoppedGame = lastGame.name
      lastGame = null
      writeGameState('IDLE')
      log(`Game stopped: ${stoppedGame}`)
      onStateChange({ currentGame: null, status: 'idle' })
      cleanupFullscreenProcessAudio().catch((err) =>
        log(`Fullscreen process audio cleanup failed: ${err.message}`)
      )
      if (stoppedGame !== '(Unorganized)') {
        onOrganizeProgress({
          phase: 'recording',
          stage: 'waiting',
          label: 'Waiting for OBS to unlock…',
          gameName: stoppedGame,
        })
      }
      // Tell the OBS plugin to stop recording
      stopRecording().catch((err) => log(`Plugin stopRecording failed: ${err.message}`))
      scheduleOrganize(stoppedGame)
    } else if (detected && lastGame && detected.name !== lastGame.name) {
      const stoppedGame = lastGame.name
      lastGame = detected
      // Force a brief non-RECORDING state so we get a clean stop/start between games.
      writeGameState('IDLE')
      log(`Game switched: ${stoppedGame} → ${detected.name}`)
      onStateChange({ currentGame: null, status: 'idle' })
      cleanupFullscreenProcessAudio().catch((err) =>
        log(`Fullscreen process audio cleanup failed: ${err.message}`)
      )
      if (stoppedGame !== '(Unorganized)') {
        onOrganizeProgress({
          phase: 'recording',
          stage: 'waiting',
          label: 'Waiting for OBS to unlock…',
          gameName: stoppedGame,
        })
      }

      // Stop recording for the old game, then start for the new one
      obsWasReachable = true // optimistic: assume OBS is reachable; isPluginReachable will correct if not
      stopRecording()
        .catch((err) => log(`Plugin stopRecording failed: ${err.message}`))
        .finally(() => {
          // Capture the target game at schedule time to guard against stale closure.
          const targetName = detected.name
          const targetScene = detected.scene || ''
          // After a short delay, signal recording for the newly detected game.
          setTimeout(() => {
            if (stopped) return // watcher was stopped during the delay
            if (!lastGame || lastGame.name !== targetName) return // game changed again during delay
            writeGameState(`RECORDING|${targetName}|${targetScene}`)
            onStateChange({ currentGame: targetName, status: 'recording' })
            syncFullscreenProcessAudio(lastGame)
              .catch((err) => log(`Fullscreen process audio sync failed: ${err.message}`))
              .finally(() => {
                startRecording(targetScene || undefined).catch((err) =>
                  log(`Plugin startRecording failed: ${err.message}`)
                )
              })
          }, 500)
        })

      scheduleOrganize(stoppedGame)
    }

    // Check if OBS just became reachable while a game is active (e.g. OBS opened after detection).
    // isPluginReachable also corrects obsWasReachable if our optimistic set above was wrong.
    isPluginReachable()
      .then((reachable) => {
        if (lastGame && reachable && !obsWasReachable) {
          const game = lastGame
          log(`OBS became reachable while ${game.name} is active — sending startRecording`)
          syncFullscreenProcessAudio(game)
            .catch((err) => log(`Fullscreen process audio sync failed: ${err.message}`))
            .finally(() => {
              startRecording(game.scene || undefined).catch((err) =>
                log(`Plugin startRecording (OBS reconnect) failed: ${err.message}`)
              )
            })
        }
        obsWasReachable = reachable
      })
      .catch(() => {
        obsWasReachable = false
      })

    if (!stopped) {
      setTimeout(poll, 5000)
    }
  }

  poll()

  return {
    stop() {
      stopped = true
      writeGameState('STOPPED')
      log('Watcher stopped')
      cleanupFullscreenProcessAudio().catch((err) =>
        log(`Fullscreen process audio cleanup failed: ${err.message}`)
      )
      stopRecording().catch(() => {}) // best-effort stop
      try {
        fs.unlinkSync(PID_FILE)
      } catch {}
    },
  }
}

let lastWrittenState = null
function writeGameState(state) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  if (state !== lastWrittenState) {
    try {
      fs.writeFileSync(STATE_FILE, state, 'utf-8')
    } catch (err) {
      log(`Failed to write game state: ${err.message}`)
    }
    lastWrittenState = state
  }
}

module.exports = { setupGameWatcher, detectRunningGame, detectFullscreenFallback }
