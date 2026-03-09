import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Gamepad2, Video, Film, HardDrive, Settings, Sliders } from 'lucide-react';
import appIcon from '../assets/icon.png';
import GamesPage from './pages/GamesPage';
import SettingsPage from './pages/SettingsPage';
import EncodingPage from './pages/EncodingPage';
import ViewerRecordingsPage from './viewer/pages/RecordingsPage';
import ViewerClipsPage from './viewer/pages/ClipsPage';
import ViewerStoragePage from './viewer/pages/StoragePage';
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
  return (
    <HashRouter>
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
