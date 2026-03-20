import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Save, Wand2, Loader, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../api'
import { stableStringify } from '../utils/stableStringify'
import OnboardingModal from '../components/OnboardingModal'
import EncodingSettingsProvider, {
  EncodingSettingsSection,
} from '../components/EncodingSettingsPanel'
import { useSettingsNavGuard } from '../context/SettingsNavGuardContext'
import { useTitleBarOverlayOverride } from '../context/TitleBarOverlayContext'
import { TITLEBAR_SETTINGS_WARNING } from '../utils/titleBarOverlayDefaults'
import GeneralSettingsSection from '../settings/GeneralSettingsSections'
import { computeBentoSpans, settingsSectionDomId } from '../settings/bentoLayout'
import {
  SETTINGS_CHIP_IDS,
  SETTINGS_CHIP_LABELS,
  DEFAULT_SECTION_ID,
  LEGACY_ENCODING_SECTION_ID,
  filterSettingsSections,
  isValidSectionId,
} from '../settings/generalSectionConfig'
import { useSidebarResize, STORAGE_KEY_SETTINGS_SIDEBAR } from '../hooks/useSidebarResize'
import { useHorizontalScrollStrip } from '../hooks/useHorizontalScrollStrip'
import MainContentTopBar from '../viewer/components/MainContentTopBar'

export default function SettingsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { setGuard } = useSettingsNavGuard()
  const { setTitleBarOverlayOverride } = useTitleBarOverlayOverride()

  /** After first blocked leave, a second attempt discards and proceeds */
  const leaveWarnArmedRef = useRef(false)
  const [leaveBannerVisible, setLeaveBannerVisible] = useState(false)
  const [saveFlashActive, setSaveFlashActive] = useState(false)
  const [settings, setSettings] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDirty, setIsDirty] = useState(false)
  const [toast, setToast] = useState(null)
  const [showWizard, setShowWizard] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [pluginInstalled, setPluginInstalled] = useState(null)
  const [pluginBusy, setPluginBusy] = useState(false)
  const [pluginMsg, setPluginMsg] = useState(null) // { ok: bool, text: string }
  const [obsInstallPath, setObsInstallPath] = useState('')
  const encodingPanelRef = useRef(null)
  const [encodingMeta, setEncodingMeta] = useState({ dirty: false, canSave: false })
  /** Snapshot of last loaded/saved app settings — used so Save enables only when values differ */
  const settingsBaselineRef = useRef('')

  const [sidebarSearch, setSidebarSearch] = useState('')
  const [filterChip, setFilterChip] = useState(
    /** @type {'all' | 'automation' | 'view' | 'integrations' | 'encoding' | 'updates'} */ ('all')
  )

  const { sidebarWidth: settingsSidebarWidth, handleMouseDown: handleSettingsSidebarMouseDown } =
    useSidebarResize(STORAGE_KEY_SETTINGS_SIDEBAR)

  const onEncodingStateChange = useCallback((state) => {
    setEncodingMeta(state)
  }, [])

  const sectionParam = searchParams.get('section')

  const filteredSections = useMemo(
    () => filterSettingsSections(filterChip, sidebarSearch),
    [filterChip, sidebarSearch]
  )

  const settingsFilterStripKey = useMemo(
    () =>
      `${isLoading}|${settingsSidebarWidth}|${filterChip}|${sidebarSearch}|${filteredSections.map((s) => s.id).join(',')}`,
    [isLoading, settingsSidebarWidth, filterChip, sidebarSearch, filteredSections]
  )
  const {
    scrollRef: filterPillsScrollRef,
    canScrollLeft: canScrollFilterPillsLeft,
    canScrollRight: canScrollFilterPillsRight,
    updateScrollState: updateFilterPillsScrollState,
    scrollBy: scrollFilterPills,
  } = useHorizontalScrollStrip(settingsFilterStripKey)

  const settingsMainScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const suppressOutlineScrollClearRef = useRef(false)
  const suppressOutlineScrollClearTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  /** Purple sidebar row only after a sidebar click; cleared on main-panel scroll (same as bento outline). */
  const [sidebarNavHighlightId, setSidebarNavHighlightId] = useState(/** @type {string | null} */ (null))

  /** When true, bento outline is hidden (initial visit, after scroll). Sidebar selection shows it again. */
  const [outlineClearedByScroll, setOutlineClearedByScroll] = useState(true)

  const bentoSpans = useMemo(
    () => computeBentoSpans(filteredSections.map((s) => s.id)),
    [filteredSections]
  )

  const suppressOutlineScrollClearFor = useCallback((ms) => {
    suppressOutlineScrollClearRef.current = true
    if (suppressOutlineScrollClearTimeoutRef.current) {
      clearTimeout(suppressOutlineScrollClearTimeoutRef.current)
    }
    suppressOutlineScrollClearTimeoutRef.current = window.setTimeout(() => {
      suppressOutlineScrollClearRef.current = false
      suppressOutlineScrollClearTimeoutRef.current = null
    }, ms)
  }, [])

  /** Bento outline: current `?section=` tile only after a sidebar pick (or re-click); scroll clears it. */
  const outlineSectionId = useMemo(() => {
    if (outlineClearedByScroll) return null
    if (!sectionParam || !isValidSectionId(sectionParam)) return null
    if (!filteredSections.some((s) => s.id === sectionParam)) return null
    return sectionParam
  }, [outlineClearedByScroll, sectionParam, filteredSections])

  const hasEncodingSections = useMemo(
    () => filteredSections.some((s) => s.id.startsWith('encoding-')),
    [filteredSections]
  )

  /** Legacy `?tab=encoding` → `?section=encoding-profile` */
  useEffect(() => {
    if (searchParams.get('tab') !== 'encoding') return
    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    next.set('section', LEGACY_ENCODING_SECTION_ID)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const legacyEncodingTab = searchParams.get('tab') === 'encoding'

  /** Default and validate `section` in the URL. */
  useEffect(() => {
    if (legacyEncodingTab) return
    if (!sectionParam) {
      setSearchParams({ section: DEFAULT_SECTION_ID }, { replace: true })
      return
    }
    if (sectionParam === 'encoding') {
      setSearchParams({ section: LEGACY_ENCODING_SECTION_ID }, { replace: true })
      return
    }
    if (!isValidSectionId(sectionParam)) {
      setSearchParams({ section: DEFAULT_SECTION_ID }, { replace: true })
    }
  }, [sectionParam, legacyEncodingTab, setSearchParams])

  /** Keep URL section in sync when search/chips hide the current target. */
  useEffect(() => {
    if (legacyEncodingTab) return
    if (filteredSections.length === 0) return
    const current = isValidSectionId(sectionParam) ? sectionParam : DEFAULT_SECTION_ID
    if (!filteredSections.some((s) => s.id === current)) {
      setSearchParams({ section: filteredSections[0].id }, { replace: true })
    }
  }, [filteredSections, sectionParam, legacyEncodingTab, setSearchParams])

  /** Hide sidebar highlight if search/filter removes that row from the list. */
  useEffect(() => {
    if (sidebarNavHighlightId && !filteredSections.some((s) => s.id === sidebarNavHighlightId)) {
      setSidebarNavHighlightId(null)
    }
  }, [filteredSections, sidebarNavHighlightId])

  useEffect(() => {
    return () => {
      if (suppressOutlineScrollClearTimeoutRef.current) {
        clearTimeout(suppressOutlineScrollClearTimeoutRef.current)
      }
    }
  }, [])

  /** Scroll main panel so `?section=` lands with that block at the top. */
  useEffect(() => {
    if (legacyEncodingTab || isLoading) return
    if (!sectionParam || !isValidSectionId(sectionParam)) return
    if (!filteredSections.some((s) => s.id === sectionParam)) return
    const id = settingsSectionDomId(sectionParam)
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [sectionParam, filteredSections, legacyEncodingTab, isLoading])

  /** User scroll clears bento outline and sidebar purple row; suppressed during programmatic scrollIntoView. */
  useEffect(() => {
    const root = settingsMainScrollRef.current
    if (!root) return
    const onScroll = () => {
      if (suppressOutlineScrollClearRef.current) return
      setOutlineClearedByScroll(true)
      setSidebarNavHighlightId(null)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [isLoading, filteredSections])

  useEffect(() => {
    loadSettings()
    api.isOBSPluginRegistered().then(setPluginInstalled)
    api.getOBSInstallPath().then((p) => setObsInstallPath(p || ''))
  }, [])

  useEffect(() => {
    if (leaveBannerVisible) {
      setTitleBarOverlayOverride(TITLEBAR_SETTINGS_WARNING)
    } else {
      setTitleBarOverlayOverride(null)
    }
    return () => setTitleBarOverlayOverride(null)
  }, [leaveBannerVisible, setTitleBarOverlayOverride])

  useEffect(() => {
    const unsubAvailable = api.onUpdateAvailable?.((info) => {
      setUpdateStatus({ type: 'available', version: info.version })
      setCheckingUpdate(false)
    })
    const unsubProgress = api.onUpdateProgress?.((progress) => {
      setUpdateStatus({ type: 'progress', percent: progress.percent })
    })
    const unsubDownloaded = api.onUpdateDownloaded?.(() => {
      setUpdateStatus({ type: 'downloaded' })
      setCheckingUpdate(false)
    })
    const unsubError = api.onUpdateError?.((info) => {
      setUpdateStatus({ type: 'error', message: info?.message })
      setCheckingUpdate(false)
    })
    return () => {
      unsubAvailable?.()
      unsubProgress?.()
      unsubDownloaded?.()
      unsubError?.()
    }
  }, [])

  async function loadSettings() {
    const s = await api.getStore('settings')
    setSettings(s)
    settingsBaselineRef.current = stableStringify(s)
    setIsDirty(false)
    setIsLoading(false)
  }

  function updateSetting(path, value) {
    const keys = path.split('.')
    const updated = { ...settings }
    let obj = updated
    for (let i = 0; i < keys.length - 1; i++) {
      obj[keys[i]] = { ...obj[keys[i]] }
      obj = obj[keys[i]]
    }
    obj[keys[keys.length - 1]] = value
    setSettings(updated)
    setIsDirty(stableStringify(updated) !== settingsBaselineRef.current)
  }

  async function saveSettings() {
    await api.setStore('settings', settings)
    await api.registerHotkey()
    settingsBaselineRef.current = stableStringify(settings)
    setIsDirty(false)
    showToast('Settings saved')
  }

  async function handleHeaderSave() {
    const didApp = isDirty
    if (isDirty) await saveSettings()
    if (encodingMeta.dirty) {
      const ok = await encodingPanelRef.current?.save()
      if (ok && !didApp) showToast('Settings saved')
    }
  }

  const headerSaveDisabled =
    !isDirty && !(encodingMeta.dirty && encodingMeta.canSave)

  const showUnsavedHint = isDirty || encodingMeta.dirty

  function hasUnsavedChanges() {
    return isDirty || encodingMeta.dirty
  }

  function scrollSectionIntoView(sectionId) {
    suppressOutlineScrollClearFor(950)
    document
      .getElementById(settingsSectionDomId(sectionId))
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const discardAllUnsaved = useCallback(() => {
    try {
      if (settingsBaselineRef.current) {
        setSettings(JSON.parse(settingsBaselineRef.current))
      }
    } catch {
      /* ignore */
    }
    setIsDirty(false)
    encodingPanelRef.current?.resetToBaseline?.()
  }, [])

  const handleNavigateAway = useCallback(
    (targetPath) => {
      if (leaveWarnArmedRef.current) {
        discardAllUnsaved()
        navigate(targetPath)
        leaveWarnArmedRef.current = false
        setLeaveBannerVisible(false)
        return
      }
      leaveWarnArmedRef.current = true
      setLeaveBannerVisible(true)
      setSaveFlashActive(true)
      window.setTimeout(() => setSaveFlashActive(false), 900)
    },
    [navigate, discardAllUnsaved]
  )

  function handleSectionSelect(nextId) {
    if (nextId === sectionParam) {
      setOutlineClearedByScroll(false)
      setSidebarNavHighlightId(nextId)
      return
    }
    if (!hasUnsavedChanges()) {
      setOutlineClearedByScroll(false)
      setSidebarNavHighlightId(nextId)
      setSearchParams({ section: nextId })
      requestAnimationFrame(() => scrollSectionIntoView(nextId))
      return
    }
    if (leaveWarnArmedRef.current) {
      discardAllUnsaved()
      setOutlineClearedByScroll(false)
      setSidebarNavHighlightId(nextId)
      setSearchParams({ section: nextId })
      leaveWarnArmedRef.current = false
      setLeaveBannerVisible(false)
      requestAnimationFrame(() => scrollSectionIntoView(nextId))
      return
    }
    leaveWarnArmedRef.current = true
    setLeaveBannerVisible(true)
    setSaveFlashActive(true)
    window.setTimeout(() => setSaveFlashActive(false), 900)
  }

  function handleLeaveBannerClick() {
    discardAllUnsaved()
    leaveWarnArmedRef.current = false
    setLeaveBannerVisible(false)
  }

  useEffect(() => {
    setGuard({
      hasUnsaved: () => isDirty || encodingMeta.dirty,
      handleNavigateAway,
    })
    return () => setGuard(null)
  }, [setGuard, handleNavigateAway, isDirty, encodingMeta.dirty])

  useEffect(() => {
    const noUnsaved = !isDirty && !encodingMeta.dirty
    if (noUnsaved) {
      setLeaveBannerVisible(false)
      leaveWarnArmedRef.current = false
    }
  }, [isDirty, encodingMeta.dirty])

  async function detectOBSPath() {
    const path = await api.detectOBSPath()
    if (path) {
      updateSetting('obsRecordingPath', path)
      showToast(`Detected OBS path: ${path}`)
    } else {
      showToast('Could not detect OBS recording path')
    }
  }

  async function browseDirectory(settingKey) {
    const dir = await api.openDirectoryDialog()
    if (dir) updateSetting(settingKey, dir)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function installPlugin() {
    setPluginBusy(true)
    setPluginMsg(null)
    const savedPath = obsInstallPath.trim() || null
    if (savedPath) await api.setOBSInstallPath(savedPath)
    const result = await api.installOBSPlugin(savedPath)
    if (result?.success) {
      setPluginInstalled(true)
      setPluginMsg({ ok: true, text: 'Plugin installed. Restart OBS to apply.' })
    } else {
      setPluginMsg({ ok: false, text: result?.message || 'Installation failed.' })
    }
    setPluginBusy(false)
  }

  async function removePlugin() {
    setPluginBusy(true)
    setPluginMsg(null)
    const result = await api.removeOBSPlugin()
    if (result?.success) {
      setPluginInstalled(false)
      setPluginMsg({ ok: true, text: 'Plugin removed. Restart OBS to apply.' })
    } else {
      setPluginMsg({ ok: false, text: result?.message || 'Removal failed.' })
    }
    setPluginBusy(false)
  }

  async function checkForUpdate() {
    setCheckingUpdate(true)
    setUpdateStatus(null)
    await api.checkForUpdate?.()
    const UPDATE_CHECK_TIMEOUT_MS = 10000
    setTimeout(() => setCheckingUpdate(false), UPDATE_CHECK_TIMEOUT_MS)
  }

  async function installUpdate() {
    await api.installUpdate?.()
  }

  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}
      >
        <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (!settings) return null

  return (
    <>
      {leaveBannerVisible && (
        <button
          type="button"
          className="settings-leave-warning-banner"
          onClick={handleLeaveBannerClick}
        >
          Don&apos;t forget to save any changes. Click again to clear changes.
        </button>
      )}
      <div className="settings-page">
        <div className="page-body settings-page-body">
          <div className="settings-split">
            <aside
              className="sidebar"
              style={{ '--sidebar-width': `${settingsSidebarWidth}px` }}
            >
              <div className="msb-header">
                <div className="msb-row1">
                  <span className="msb-title">Settings</span>
                  <div className="msb-search">
                    <label htmlFor="settings-sidebar-search-input" className="visually-hidden">
                      Search settings
                    </label>
                    <span className="msb-search-icon" aria-hidden>
                      <Search size={11} />
                    </span>
                    <input
                      id="settings-sidebar-search-input"
                      type="search"
                      placeholder="Search settings…"
                      value={sidebarSearch}
                      onChange={(e) => setSidebarSearch(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="msb-game-filter-wrap">
                  {canScrollFilterPillsLeft && (
                    <button
                      type="button"
                      className="msb-game-scroll-btn msb-game-scroll-left"
                      aria-label="Scroll filters left"
                      onClick={() => scrollFilterPills(-1)}
                    >
                      <ChevronLeft size={12} />
                    </button>
                  )}
                  <div
                    ref={filterPillsScrollRef}
                    className="msb-game-filter"
                    role="group"
                    aria-label="Filter by category"
                    onScroll={updateFilterPillsScrollState}
                  >
                    {SETTINGS_CHIP_IDS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={`msb-game-pill${filterChip === id ? ' active' : ''}`}
                        onClick={() => setFilterChip(id)}
                      >
                        {SETTINGS_CHIP_LABELS[id] ?? id}
                      </button>
                    ))}
                  </div>
                  {canScrollFilterPillsRight && (
                    <button
                      type="button"
                      className="msb-game-scroll-btn msb-game-scroll-right"
                      aria-label="Scroll filters right"
                      onClick={() => scrollFilterPills(1)}
                    >
                      <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              </div>

              <nav className="settings-nav-list" role="navigation" aria-label="Settings sections">
                {filteredSections.length === 0 ? (
                  <div className="settings-sidebar-empty">
                    <strong>No sections match</strong>
                    <span>Try another filter or clear the search box.</span>
                  </div>
                ) : (
                  filteredSections.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`settings-nav-item ${sidebarNavHighlightId === s.id ? 'active' : ''}`}
                      onClick={() => handleSectionSelect(s.id)}
                      aria-current={sidebarNavHighlightId === s.id ? 'page' : undefined}
                    >
                      <span className="settings-nav-item-title">{s.title}</span>
                      <span className="settings-nav-item-sub">{s.blurb}</span>
                    </button>
                  ))
                )}
              </nav>
              <div
                className="sidebar-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize settings sidebar"
                onMouseDown={handleSettingsSidebarMouseDown}
              />
            </aside>

            <div className="settings-detail">
              <MainContentTopBar />
              <div className="settings-detail-toolbar">
                <div className="settings-detail-header-row settings-detail-header-row--actions-only">
                  <div className="settings-detail-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowWizard(true)}
                    >
                      <Wand2 size={13} /> Setup Wizard
                    </button>
                    {showUnsavedHint && (
                      <span className="settings-unsaved-hint">Unsaved changes</span>
                    )}
                    <button
                      type="button"
                      className={`btn btn-primary btn-sm settings-save-btn ${saveFlashActive ? 'settings-save-btn-flash' : ''}`}
                      onClick={handleHeaderSave}
                      disabled={headerSaveDisabled}
                      style={{ opacity: headerSaveDisabled ? 0.4 : 1 }}
                    >
                      <Save size={13} /> Save Settings
                    </button>
                  </div>
                </div>
              </div>

              <div ref={settingsMainScrollRef} className="settings-detail-scroll">
                {filteredSections.length === 0 ? (
                  <div className="settings-detail-empty">
                    <strong>No sections match</strong>
                    <span>Try another filter or clear the search box.</span>
                  </div>
                ) : (
                  <div className="settings-detail-inner settings-detail-inner--bento">
                    {hasEncodingSections ? (
                      <EncodingSettingsProvider
                        ref={encodingPanelRef}
                        onEncodingStateChange={onEncodingStateChange}
                      >
                        <div className="settings-bento-grid">
                          {filteredSections.map((s, i) => {
                            const span = bentoSpans[i]
                            const colStyle = { gridRow: span.gridRow, gridColumn: span.gridColumn }
                            if (s.id.startsWith('encoding-')) {
                              return (
                                <div
                                  key={s.id}
                                  id={settingsSectionDomId(s.id)}
                                  className={`settings-bento-item${outlineSectionId === s.id ? ' settings-bento-item--active' : ''}`}
                                  style={colStyle}
                                >
                                  <EncodingSettingsSection
                                    sectionId={s.id}
                                    sectionTitle={s.title}
                                  />
                                </div>
                              )
                            }
                            return (
                              <div
                                key={s.id}
                                id={settingsSectionDomId(s.id)}
                                className={`settings-bento-item${outlineSectionId === s.id ? ' settings-bento-item--active' : ''}`}
                                style={colStyle}
                              >
                                <GeneralSettingsSection
                                  sectionTitle={s.title}
                                  sectionId={s.id}
                                  settings={settings}
                                  updateSetting={updateSetting}
                                  detectOBSPath={detectOBSPath}
                                  browseDirectory={browseDirectory}
                                  obsInstallPath={obsInstallPath}
                                  setObsInstallPath={setObsInstallPath}
                                  pluginInstalled={pluginInstalled}
                                  pluginBusy={pluginBusy}
                                  pluginMsg={pluginMsg}
                                  installPlugin={installPlugin}
                                  removePlugin={removePlugin}
                                  updateStatus={updateStatus}
                                  checkingUpdate={checkingUpdate}
                                  checkForUpdate={checkForUpdate}
                                  installUpdate={installUpdate}
                                />
                              </div>
                            )
                          })}
                        </div>
                      </EncodingSettingsProvider>
                    ) : (
                      <div className="settings-bento-grid">
                        {filteredSections.map((s, i) => {
                          const span = bentoSpans[i]
                          const colStyle = { gridRow: span.gridRow, gridColumn: span.gridColumn }
                          return (
                            <div
                              key={s.id}
                              id={settingsSectionDomId(s.id)}
                              className={`settings-bento-item${outlineSectionId === s.id ? ' settings-bento-item--active' : ''}`}
                              style={colStyle}
                            >
                              <GeneralSettingsSection
                                sectionTitle={s.title}
                                sectionId={s.id}
                                settings={settings}
                                updateSetting={updateSetting}
                                detectOBSPath={detectOBSPath}
                                browseDirectory={browseDirectory}
                                obsInstallPath={obsInstallPath}
                                setObsInstallPath={setObsInstallPath}
                                pluginInstalled={pluginInstalled}
                                pluginBusy={pluginBusy}
                                pluginMsg={pluginMsg}
                                installPlugin={installPlugin}
                                removePlugin={removePlugin}
                                updateStatus={updateStatus}
                                checkingUpdate={checkingUpdate}
                                checkForUpdate={checkForUpdate}
                                installUpdate={installUpdate}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
      <OnboardingModal
        open={showWizard}
        onClose={() => {
          setShowWizard(false)
          loadSettings()
        }}
      />
    </>
  )
}
