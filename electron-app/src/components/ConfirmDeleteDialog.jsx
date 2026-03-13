import { AlertTriangle } from 'lucide-react';

export default function ConfirmDeleteDialog({ confirmDeleteGame, onConfirm, onCancel }) {
  if (!confirmDeleteGame) return null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <h2>Remove Game</h2>
        <p>
          Remove <strong>{confirmDeleteGame.game.name}</strong> from the list?
        </p>
        {confirmDeleteGame.game.scene && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            marginTop: 4, marginBottom: 4,
            padding: '8px 10px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12, color: 'var(--text-secondary)',
          }}>
            <AlertTriangle size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
            <span>
              This game has an OBS scene: <strong>{confirmDeleteGame.game.scene}</strong>.
              {' '}Do you also want to delete it from OBS?
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          {confirmDeleteGame.game.scene && (
            <button
              className="btn btn-secondary"
              onClick={() => onConfirm(false)}
            >
              Game only
            </button>
          )}
          <button
            className="btn"
            style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}
            onClick={() => onConfirm(!!confirmDeleteGame.game.scene)}
          >
            {confirmDeleteGame.game.scene ? 'Game + OBS Scene' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}
