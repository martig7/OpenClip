import { ChevronDown } from 'lucide-react';

export default function WindowPicker({
  showPicker,
  setShowPicker,
  visibleWindows,
  loadingWindows,
  onSelect,
}) {
  return (
    <>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => {
          const next = !showPicker;
          setShowPicker(next);
        }}
        title="Pick from running windows"
      >
        <ChevronDown size={13} />
      </button>
      {showPicker && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 200,
          marginTop: 4,
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-light)',
          borderRadius: 'var(--radius-sm)',
          maxHeight: 300,
          overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {visibleWindows.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              {loadingWindows ? 'Loading...' : 'No windows found. Click again to refresh.'}
            </div>
          ) : (
            visibleWindows.map((win, i) => (
              <div
                key={win.hwnd || win.handle || i}
                onClick={() => {
                  onSelect(win);
                  setShowPicker(false);
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ color: 'var(--text-primary)' }}>{win.title}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{win.exe}] {win.windowClass !== win.process ? win.windowClass : ''}</div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
