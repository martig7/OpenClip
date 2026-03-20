/** Active / Off status pill used in the games table and detail drawer. */
export function GameEnabledBadge({ enabled }) {
  return (
    <span className={`badge ${enabled ? 'badge-success' : 'badge-muted'}`}>
      <span
        className="badge-dot"
        style={{
          background: enabled ? 'var(--success)' : 'var(--text-muted)',
        }}
      />
      {enabled ? 'Active' : 'Off'}
    </span>
  )
}
