import { memo } from 'react';
import { ExternalLink, Square, Play, Circle, AlertTriangle, X, Settings } from 'lucide-react';

function formatUptime(startedAt) {
  if (!startedAt) return '';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseGameState(gameState) {
  if (!gameState) return { label: 'No state file', color: 'var(--text-muted)' };
  if (gameState.startsWith('RECORDING')) {
    const parts = gameState.split('|');
    const game = parts[1] || 'Unknown';
    const scene = parts[2] || '';
    return {
      label: `Recording ${game}${scene ? ` (Scene: ${scene})` : ''}`,
      color: 'var(--danger)',
      recording: true,
      game,
    };
  }
  if (gameState === 'IDLE') return { label: 'Idle - watching for games', color: 'var(--text-secondary)' };
  return { label: gameState, color: 'var(--text-muted)' };
}

const WatcherStatusCard = memo(function WatcherStatusCard({ status, onToggle, scriptWarning, onDismissWarning, onGoToSettings, onOpenOBS }) {
  const state = parseGameState(status.gameState);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Watcher Status</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onOpenOBS}
            title="Open OBS"
          >
            <ExternalLink size={13} /> Open OBS
          </button>
          <button
            className={`btn btn-sm ${status.running ? 'btn-danger' : 'btn-primary'}`}
            onClick={onToggle}
          >
            {status.running ? <><Square size={13} /> Stop Watcher</> : <><Play size={13} /> Start Watcher</>}
          </button>
        </div>
      </div>

      {scriptWarning && status.running && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 12, borderRadius: 'var(--radius-sm)',
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          fontSize: 12, color: 'var(--warning, #f59e0b)',
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            OBS plugin not detected. Make sure OBS is running with the OpenClip plugin installed.{' '}
            <button
              onClick={onGoToSettings}
              style={{
                background: 'none', border: 'none', color: 'var(--primary)',
                textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit',
              }}
            >
              <Settings size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
              Setup guide
            </button>
          </span>
          <button
            className="btn-icon"
            onClick={onDismissWarning}
            title="Dismiss"
            style={{ flexShrink: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 13 }}>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>STATUS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Circle
              size={8}
              fill={status.running ? 'var(--success)' : 'var(--text-muted)'}
              color={status.running ? 'var(--success)' : 'var(--text-muted)'}
            />
            <span style={{ color: status.running ? 'var(--success)' : 'var(--text-muted)', fontWeight: 500 }}>
              {status.running ? 'Running' : 'Stopped'}
            </span>
          </div>
        </div>

        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>UPTIME</div>
          <span style={{ color: 'var(--text-secondary)' }}>
            {status.running && status.startedAt ? formatUptime(status.startedAt) : '--'}
          </span>
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>STATE</div>
          <span style={{ color: state.color, fontWeight: state.recording ? 500 : 400 }}>
            {state.recording && (
              <Circle size={7} fill="var(--danger)" color="var(--danger)" style={{ marginRight: 4, display: 'inline' }} />
            )}
            {state.label}
          </span>
        </div>
      </div>
    </div>
  );
});

export default WatcherStatusCard;
