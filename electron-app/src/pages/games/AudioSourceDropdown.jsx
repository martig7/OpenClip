import { RefreshCw } from 'lucide-react';
import {
  AUDIO_KIND_META,
  AudioIcon,
} from './audioSourceUtils';

export default function AudioSourceDropdown({
  show,
  loading,
  error,
  sources,
  sceneAudioSources,
  onSelect,
  onClose,
}) {
  if (!show) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 'calc(100% + 6px)',
      right: 0,
      zIndex: 300,
      minWidth: 280,
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--radius)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '7px 12px', fontSize: 10, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Add to Scene
      </div>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
          <RefreshCw size={12} className="spinning" /> Loading…
        </div>
      ) : error ? (
        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--danger)' }}>{error}</div>
      ) : sources.length === 0 ? (
        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No audio sources found.</div>
      ) : (
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {['obs', 'windows', 'app'].map(group => {
            const items = sources.filter(a => a.source === group);
            if (items.length === 0) return null;
            const groupLabel = { obs: 'OBS Inputs', windows: 'Windows Devices', app: 'Applications' }[group];
            return (
              <div key={group}>
                <div style={{ padding: '5px 12px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', borderTop: group !== 'obs' ? '1px solid var(--border)' : 'none', marginTop: group !== 'obs' ? 3 : 0 }}>
                  {groupLabel}
                </div>
                {items.map((entry, i) => {
                  const alreadyInScene = sceneAudioSources && sceneAudioSources.some(s => s.inputName === entry.name || (entry.kind === 'magic_game_audio' && s.inputName.startsWith('Game Audio (')));
                  const meta = AUDIO_KIND_META[entry.kind];
                  return (
                    <button
                      key={i}
                      disabled={alreadyInScene}
                      onClick={() => {
                        if (!alreadyInScene) {
                          onSelect(entry);
                          onClose();
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                        padding: '6px 14px', background: 'none', border: 'none',
                        cursor: alreadyInScene ? 'default' : 'pointer', textAlign: 'left',
                        opacity: alreadyInScene ? 0.45 : 1,
                      }}
                      onMouseEnter={e => { if (!alreadyInScene) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    >
                      <AudioIcon kind={entry.kind} size={13} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{meta?.label || entry.kind}</div>
                      </div>
                      {alreadyInScene && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>In scene</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
