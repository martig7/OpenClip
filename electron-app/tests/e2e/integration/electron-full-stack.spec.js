import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { cleanupTestScenes, getScenes, createTestScene, TEST_PREFIX } from './helpers/obsClient.js'

async function findAppWindow(electronApp) {
  for (let i = 0; i < 80; i++) {
    const windows = electronApp.windows()
    for (const w of windows) {
      try {
        const hasApi = await w.evaluate(() => typeof window.api === 'object')
        if (hasApi) return w
      } catch {
        // DevTools or not ready yet.
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Could not find Electron renderer window with window.api')
}

async function openAdvancedAddGameModal(page) {
  await page.goto('http://localhost:5173/#/')
  await page.click('button:has-text("Add Game")')
  await expect(page.locator('h2:has-text("Add Game")')).toBeVisible()
  const advancedBtn = page.locator('.modal').getByRole('button', { name: 'Advanced' })
  if (await advancedBtn.isVisible().catch(() => false)) {
    await advancedBtn.click()
  }
}

test.describe('Electron full stack integration (UI + plugin + OBS + recordings)', () => {
  let electronApp
  let page
  const recordingsDir = process.env.OBS_RECORDING_PATH

  async function cleanupAllGames() {
    if (!page) return
    await page.evaluate(async () => {
      const games = (await window.api.getGames()) || []
      for (const game of games) {
        if (!game?.id) continue
        try {
          await window.api.removeGame(game.id)
        } catch {
          // Best-effort cleanup to prevent test data buildup.
        }
      }
    })
  }

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: ['.', '--integration-mode'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Reuse env set by integration global setup (OBS/plugin/temp paths).
      },
    })

    page = await findAppWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('.games-caption-bar .msb-title', { timeout: 30_000 })
    await page.evaluate(async () => {
      await window.api.setOnboardingComplete(true)
    })
    await page.reload()
    await page.waitForSelector('.games-caption-bar .msb-title', { timeout: 30_000 })
  })

  test.afterAll(async () => {
    try {
      await cleanupAllGames()
      await cleanupTestScenes()
    } catch {}
    try {
      if (electronApp) await electronApp.close()
    } catch {}
  })

  test.beforeEach(async () => {
    await cleanupTestScenes()
    // Keep fullscreen config deterministic across tests.
    await page.evaluate(async () => {
      await window.api.setFullscreenRecording({
        enabled: false,
        defaultScene: '',
        gameAudioEnabled: true,
      })
    })
  })

  test.afterEach(async () => {
    await cleanupTestScenes()
  })

  test('adds a game through UI and creates its scene in real OBS', async () => {
    const gameName = 'Electron Full Stack Game'
    const sceneName = `${TEST_PREFIX}ElectronScene`

    await page.goto('http://localhost:5173/#/')
    await page.click('button:has-text("Add Game")')
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible()

    const advancedBtn = page.locator('.modal').getByRole('button', { name: 'Advanced' })
    if (await advancedBtn.isVisible().catch(() => false)) {
      await advancedBtn.click()
    }

    await page.locator('input[placeholder="e.g. Valorant"]').fill(gameName)
    await page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]').fill('fullstack.exe')
    await page.locator('.modal').getByRole('button', { name: 'Select scene…' }).click()
    await page.getByRole('button', { name: 'Create new scene…' }).click()
    await page.locator('input[placeholder="e.g. Gaming Scene (required)"]').fill(sceneName)

    const addBtn = page.locator('.modal .modal-actions button.btn-primary:has-text("Add Game")')
    await expect(addBtn).toBeEnabled()
    await addBtn.evaluate((el) => el.click())
    await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible()
    await expect(page.locator('.games-table-name', { hasText: gameName }).first()).toBeVisible()

    await expect.poll(() => getScenes(), { timeout: 15_000 }).toContain(sceneName)

    const savedGame = await page.evaluate(async (name) => {
      const games = await window.api.getGames()
      return games.find((g) => g.name === name) || null
    }, gameName)
    expect(savedGame).toBeTruthy()
    expect(savedGame.scene).toBe(sceneName)
  })

  const gameSetupCases = [
    { label: 'priority-0 game-capture', priority: '0', capture: 'game_capture' },
    { label: 'priority-1 window-capture', priority: '1', capture: 'window_capture' },
    { label: 'priority-2 game-capture', priority: '2', capture: 'game_capture' },
  ]

  for (const scenario of gameSetupCases) {
    test(`adds game setup combination: ${scenario.label}`, async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const gameName = `Combo ${scenario.label} ${suffix}`
      const sceneName = `${TEST_PREFIX}Combo-${suffix}`

      await openAdvancedAddGameModal(page)
      await page.locator('input[placeholder="e.g. Valorant"]').fill(gameName)
      await page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]').fill('combo.exe')
      await page.locator('select.form-input').nth(0).selectOption(scenario.priority)
      await page.locator('.modal').getByRole('button', { name: 'Select scene…' }).click()
      await page.getByRole('button', { name: 'Create new scene…' }).click()
      await page.locator('input[placeholder="e.g. Gaming Scene (required)"]').fill(sceneName)

      if (scenario.capture === 'window_capture') {
        await page.locator('.modal').getByRole('button', { name: 'Window Capture' }).click()
      } else {
        await page.locator('.modal').getByRole('button', { name: 'Game Capture' }).click()
      }

      const addBtn = page.locator('.modal .modal-actions button.btn-primary:has-text("Add Game")')
      await expect(addBtn).toBeEnabled()
      await addBtn.evaluate((el) => el.click())
      await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible()
      await expect(page.locator('.games-table-name', { hasText: gameName }).first()).toBeVisible()
      await expect.poll(() => getScenes(), { timeout: 15_000 }).toContain(sceneName)

      const saved = await page.evaluate(async (name) => {
        const games = await window.api.getGames()
        const g = games.find((x) => x.name === name)
        return g
          ? {
              name: g.name,
              scene: g.scene,
              windowMatchPriority: g.windowMatchPriority,
            }
          : null
      }, gameName)
      expect(saved).toBeTruthy()
      expect(saved.scene).toBe(sceneName)
      expect(String(saved.windowMatchPriority ?? 0)).toBe(scenario.priority)
    })
  }

  test('adds a game mapped to an existing OBS scene (no scene creation)', async () => {
    const gameName = `Existing Scene Game ${Date.now()}`
    const existingScene = await createTestScene(`Existing-${Date.now()}`)

    await page.goto('http://localhost:5173/#/')
    await page.click('button:has-text("Add Game")')
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible()

    const advancedBtn = page.locator('.modal').getByRole('button', { name: 'Advanced' })
    if (await advancedBtn.isVisible().catch(() => false)) {
      await advancedBtn.click()
    }

    await page.locator('input[placeholder="e.g. Valorant"]').fill(gameName)
    await page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]').fill('existing.exe')
    await page.locator('.modal').getByRole('button', { name: 'Select scene…' }).click()
    await page.locator('.modal').getByText(existingScene, { exact: true }).click()

    const addBtn = page.locator('.modal .modal-actions button.btn-primary:has-text("Add Game")')
    await expect(addBtn).toBeEnabled()
    await addBtn.evaluate((el) => el.click())
    await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible()
    await expect(page.locator('.games-table-name', { hasText: gameName }).first()).toBeVisible()

    const savedGame = await page.evaluate(async (name) => {
      const games = await window.api.getGames()
      return games.find((g) => g.name === name) || null
    }, gameName)
    expect(savedGame).toBeTruthy()
    expect(savedGame.scene).toBe(existingScene)

    // The existing scene should remain available in OBS.
    await expect.poll(() => getScenes(), { timeout: 10_000 }).toContain(existingScene)
  })

  test('removes a game and deletes its OBS scene via "Game + OBS Scene"', async () => {
    const gameName = `Delete Scene Game ${Date.now()}`
    const sceneName = `${TEST_PREFIX}DeleteWithGame-${Date.now()}`

    await page.goto('http://localhost:5173/#/')
    await page.click('button:has-text("Add Game")')
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible()

    const advancedBtn = page.locator('.modal').getByRole('button', { name: 'Advanced' })
    if (await advancedBtn.isVisible().catch(() => false)) {
      await advancedBtn.click()
    }

    await page.locator('input[placeholder="e.g. Valorant"]').fill(gameName)
    await page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]').fill('remove.exe')
    await page.locator('.modal').getByRole('button', { name: 'Select scene…' }).click()
    await page.getByRole('button', { name: 'Create new scene…' }).click()
    await page.locator('input[placeholder="e.g. Gaming Scene (required)"]').fill(sceneName)
    await page.locator('.modal .modal-actions button.btn-primary:has-text("Add Game")').evaluate((el) => el.click())
    await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible()

    // Remove the game and request OBS scene deletion.
    const row = page.locator('.games-table tbody tr').filter({
      has: page.locator('.games-table-name', { hasText: gameName }),
    })
    await row.first().locator('[title="Remove game"]').click()
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible()
    await page.locator('button:has-text("Game + OBS Scene")').click()

    await expect(page.locator('.games-table-name', { hasText: gameName })).toHaveCount(0)
    await expect.poll(() => getScenes(), { timeout: 10_000 }).not.toContain(sceneName)
  })

  test('settings toggles persist after save (watcher + advanced game addition)', async () => {
    await page.goto('http://localhost:5173/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings')

    const before = await page.evaluate(async () => {
      const s = await window.api.getStore('settings')
      return {
        startWatcherOnStartup: !!s?.startWatcherOnStartup,
        advancedGameAddition: !!s?.advancedGameAddition,
      }
    })

    const watcherRow = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    })
    const advancedRow = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Advanced Game Addition")'),
    })
    const watcherToggle = watcherRow.locator('.toggle')
    const advancedToggle = advancedRow.locator('.toggle')

    await watcherToggle.click()
    await advancedToggle.click()
    await expect(page.locator('button:has-text("Save Settings")')).toBeEnabled()
    await page.locator('button:has-text("Save Settings")').click()

    // Wait for post-save disable and assert persisted values in real store.
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled()
    const after = await page.evaluate(async () => {
      const s = await window.api.getStore('settings')
      return {
        startWatcherOnStartup: !!s?.startWatcherOnStartup,
        advancedGameAddition: !!s?.advancedGameAddition,
      }
    })
    expect(after.startWatcherOnStartup).toBe(!before.startWatcherOnStartup)
    expect(after.advancedGameAddition).toBe(!before.advancedGameAddition)
  })

  test('fullscreen row interactions: enable + choose default scene', async () => {
    const defaultScene = await createTestScene(`FullscreenDefault-${Date.now()}`)

    await page.goto('http://localhost:5173/#/')
    const fullscreenRow = page.locator('.games-table-fullscreen-row')
    await expect(fullscreenRow).toBeVisible()

    // Set default scene using fullscreen scene picker.
    await fullscreenRow.locator('button[title="Choose default scene"]').click()
    await page.locator('.fs-scene-picker__item', { hasText: defaultScene }).click()

    // Enable fullscreen catch-all recording from a known OFF baseline.
    const toggle = fullscreenRow.locator('.col-toggle .toggle')
    await toggle.click()
    await expect.poll(async () => {
      const cfg = await page.evaluate(async () => window.api.getFullscreenRecording())
      return !!cfg?.enabled
    }).toBe(true)
    await expect(toggle).toHaveClass(/\bon\b/)

    const fsCfg = await page.evaluate(async () => window.api.getFullscreenRecording())
    expect(fsCfg).toBeTruthy()
    expect(fsCfg.enabled).toBe(true)
    expect(fsCfg.defaultScene).toBe(defaultScene)
  })

  test('fullscreen row can create a new fullscreen scene from template', async () => {
    const template = await createTestScene(`FsTemplate-${Date.now()}`)
    const newScene = `${TEST_PREFIX}FsCreated-${Date.now()}`

    await page.goto('http://localhost:5173/#/')
    const fullscreenRow = page.locator('.games-table-fullscreen-row')
    await expect(fullscreenRow).toBeVisible()

    await fullscreenRow.locator('button[title="Choose default scene"]').click()
    await page.locator('.fs-scene-picker__create-btn').click()
    await expect(page.locator('h2:has-text("Create OBS Scene")')).toBeVisible()

    await page.locator('input[placeholder="e.g. Fullscreen Scene"]').fill(newScene)
    await page.locator('.modal').getByRole('button', { name: 'Copy from template' }).click()
    await page.locator('.modal select.form-input').selectOption(template)
    await page.locator('.modal button.btn-primary:has-text("Create scene")').click()
    await expect(page.locator('h2:has-text("Create OBS Scene")')).not.toBeVisible()

    await expect.poll(() => getScenes(), { timeout: 15_000 }).toContain(newScene)
    const fsCfg = await page.evaluate(async () => window.api.getFullscreenRecording())
    expect(fsCfg.defaultScene).toBe(newScene)
  })

  test('creates and lists a clip from a real recording through API server', async () => {
    test.skip(!ffmpegPath, 'ffmpeg-static is required for clip-generation test')

    mkdirSync(recordingsDir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const sourcePath = join(recordingsDir, `${date} 10-00-00.mp4`)

    execFileSync(ffmpegPath, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1280x720:d=2',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      sourcePath,
    ])

    await page.goto('http://localhost:5173/#/')

    const apiPort = await page.evaluate(async () => window.api.getApiPort())
    expect(apiPort).toBeTruthy()

    const recordings = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/recordings`)
      return res.json()
    }, apiPort)
    expect(Array.isArray(recordings)).toBe(true)
    expect(recordings.some((r) => r.path === sourcePath)).toBe(true)

    const clipResult = await page.evaluate(
      async ({ port, source }) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/clips/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_path: source,
            start_time: 0,
            end_time: 1,
            game_name: 'FullStack',
          }),
        })
        return { status: res.status, body: await res.json() }
      },
      { port: apiPort, source: sourcePath }
    )

    expect(clipResult.status).toBe(200)
    expect(clipResult.body).toBeTruthy()
    expect(clipResult.body.path || clipResult.body.filename).toBeTruthy()

    const clips = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/clips`)
      return res.json()
    }, apiPort)
    expect(Array.isArray(clips)).toBe(true)
    expect(clips.some((c) => (c.filename || '').includes('FullStack Clip'))).toBe(true)

    if (clipResult.body.path) {
      expect(existsSync(clipResult.body.path)).toBe(true)
    }
  })
})
