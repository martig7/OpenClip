import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Save, Wand2, Loader, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../api'
import { stableStringify } from '../utils/stableStringify'
import OnboardingModal from '../components/OnboardingModal'
import EncodingSettingsPanel from '../components/EncodingSettingsPanel'
import { useSettingsNavGuard } from '../context/SettingsNavGuardContext'
import { useTitleBarOverlayOverride } from '../context/TitleBarOverlayContext'
import { TITLEBAR_SETTINGS_WARNING } from '../utils/titleBarOverlayDefaults'
import GeneralSettingsSections from '../settings/GeneralSettingsSections'
import {
  SETTINGS_SECTIONS,
  SETTINGS_CHIP_IDS,
  SETTINGS_CHIP_LABELS,
  DEFAULT_SECTION_ID,
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
    /** @type {'all' | 'paths' | 'automation' | 'view' | 'integrations' | 'encoding'} */ ('all')
  )

  const { sidebarWidth: settingsSidebarWidth, handleMouseDown: handleSettingsSidebarMouseDown } =
    useSidebarResize(STORAGE_KEY_SETTINGS_SIDEBAR)

  const onEncodingStateChange = useCallback((state) => {
    setEncodingMeta(state)
  }, [])

  const sectionParam = searchParams.get('section')

  const activeSection = useMemo(() => {
    if (!isValidSectionId(sectionParam)) return DEFAULT_SECTION_ID
    return sectionParam
  }, [sectionParam])

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

  /** Legacy `?tab=encoding` → `?section=encoding` */
  useEffect(() => {
    if (searchParams.get('tab') !== 'encoding') return
    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    next.set('section', 'encoding')
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
    if (!isValidSectionId(sectionParam)) {
      setSearchParams({ section: DEFAULT_SECTION_ID }, { replace: true })
    }
  }, [sectionParam, legacyEncodingTab, setSearchParams])

  /** Keep selected section visible when search/chips narrow the list. */
  useEffect(() => {
    if (legacyEncodingTab) return
    if (filteredSections.length === 0) return
    const current = isValidSectionId(sectionParam) ? sectionParam : DEFAULT_SECTION_ID
    if (!filteredSections.some((s) => s.id === current)) {
      setSearchParams({ section: filteredSections[0].id }, { replace: true })
    }
  }, [filteredSections, sectionParam, legacyEncodingTab, setSearchParams])

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
    if (activeSection === 'encoding') {
      const ok = await encodingPanelRef.current?.save()
      if (ok) showToast('Settings saved')
      return
    }
    await saveSettings()
  }

  const headerSaveDisabled =
    activeSection === 'encoding'
      ? !encodingMeta.dirty || !encodingMeta.canSave
      : !isDirty

  const showUnsavedHint =
    (activeSection === 'encoding' && encodingMeta.dirty) ||
    (activeSection !== 'encoding' && isDirty)

  function hasUnsavedInCurrentSection() {
    if (activeSection === 'encoding') return encodingMeta.dirty
    return isDirty
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
    if (nextId === activeSection) return
    if (!hasUnsavedInCurrentSection()) {
      setSearchParams({ section: nextId })
      return
    }
    if (leaveWarnArmedRef.current) {
      discardAllUnsaved()
      setSearchParams({ section: nextId })
      leaveWarnArmedRef.current = false
      setLeaveBannerVisible(false)
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
      hasUnsaved: () =>
        activeSection === 'encoding' ? encodingMeta.dirty : isDirty,
      handleNavigateAway,
    })
    return () => setGuard(null)
  }, [setGuard, handleNavigateAway, isDirty, encodingMeta.dirty, activeSection])

  useEffect(() => {
    const noUnsaved =
      activeSection === 'encoding' ? !encodingMeta.dirty : !isDirty
    if (noUnsaved) {
      setLeaveBannerVisible(false)
      leaveWarnArmedRef.current = false
    }
  }, [isDirty, encodingMeta.dirty, activeSection])

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

  const activeSectionMeta = SETTINGS_SECTIONS.find((s) => s.id === activeSection)

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
                      className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`}
                      onClick={() => handleSectionSelect(s.id)}
                      aria-current={activeSection === s.id ? 'page' : undefined}
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
                <div className="settings-detail-header-row">
                  <h2 className="settings-detail-title">
                    {activeSectionMeta?.title ?? 'Settings'}
                  </h2>
                  <div className="settings-detail-actions">
                    {activeSection !== 'encoding' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowWizard(true)}
                      >
                        <Wand2 size={13} /> Setup Wizard
                      </button>
                    )}
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

              <div className="settings-detail-scroll">
                {activeSection === 'encoding' ? (
                  <div className="settings-detail-inner settings-detail-inner--encoding">
                    <EncodingSettingsPanel
                      ref={encodingPanelRef}
                      onEncodingStateChange={onEncodingStateChange}
                    />
                  </div>
                ) : filteredSections.length === 0 ? (
                  <div className="settings-detail-empty">
                    <strong>No sections match</strong>
                    <span>Try another filter or clear the search box.</span>
                  </div>
                ) : (
                  <div className="settings-detail-inner">
                    <GeneralSettingsSections
                      sectionId={activeSection}
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
