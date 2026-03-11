import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Gamepad2, Video, Film, HardDrive, Settings, Sliders, Download } from 'lucide-react';
import appIcon from '../assets/icon.png';
import api from './api';
import GamesPage from './pages/GamesPage';
import SettingsPage from './pages/SettingsPage';
import EncodingPage from './pages/EncodingPage';
import ViewerRecordingsPage from './viewer/pages/RecordingsPage';
import ViewerClipsPage from './viewer/pages/ClipsPage';
import ViewerStoragePage from './viewer/pages/StoragePage';
import OnboardingModal from './components/OnboardingModal';
import './App.css';
import './viewer/viewer.css';

const navItems = [
  { path: '/', icon: Gamepad2, label: 'Games' },
  { path: '/recordings', icon: Video, label: 'Recordings' },
  { path: '/clips', icon: Film, label: 'Clips' },
  { path: '/storage', icon: HardDrive, label: 'Storage' },
  { path: '/encoding', icon: Sliders, label: 'Encoding' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export default function App() {
  const [updateState, setUpdateState] = useState(null); // null | { status: 'available'|'downloading'|'ready', version?, percent? }
  const [showOnboarding, setShowOnboarding] = useState(false);

  // First-run: show onboarding if not yet completed
  useEffect(() => {
    api.isOnboardingComplete?.().then(done => {
      if (!done) setShowOnboarding(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const offAvailable = api.onUpdateAvailable(({ version }) =>
      setUpdateState({ status: 'available', version })
    );
    const offProgress = api.onUpdateProgress(({ percent }) =>
      setUpdateState(s => ({ ...s, status: 'downloading', percent }))
    );
    const offDownloaded = api.onUpdateDownloaded(() =>
      setUpdateState(s => ({ ...s, status: 'ready' }))
    );
    return () => { offAvailable(); offProgress(); offDownloaded(); };
  }, []);

  useEffect(() => {
    let audioCtx = null;

    const unsubscribe = api.onMarkerAdded(() => {
      try {
        if (!audioCtx || audioCtx.state === 'closed') {
          audioCtx = new AudioContext();
        }
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.15);
      } catch {}
    });

    return () => {
      unsubscribe();
      if (audioCtx) audioCtx.close();
    };
  }, []);

  return (
    <HashRouter>
      <OnboardingModal open={showOnboarding} onClose={() => setShowOnboarding(false)} />
      <div className="app-layout">
        <div className="titlebar-drag" />
        <nav className="sidebar-nav">
          <div className="nav-brand">
            <img src={appIcon} alt="OpenClip logo" className="nav-brand-logo" />
            <span>OpenClip</span>
          </div>
          {navItems.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
          {updateState && (
            <div className="update-banner">
              <Download size={14} />
              {updateState.status === 'available' && (
                <span>v{updateState.version} available</span>
              )}
              {updateState.status === 'downloading' && (
                <span>Downloading… {updateState.percent}%</span>
              )}
              {updateState.status === 'ready' && (
                <>
                  <span>Update ready</span>
                  <button className="btn btn-primary btn-sm" onClick={() => api.installUpdate()}>
                    Restart
                  </button>
                </>
              )}
            </div>
          )}
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<GamesPage />} />
            <Route path="/recordings" element={<ViewerRecordingsPage />} />
            <Route path="/clips" element={<ViewerClipsPage />} />
            <Route path="/storage" element={<ViewerStoragePage />} />
            <Route path="/encoding" element={<EncodingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
