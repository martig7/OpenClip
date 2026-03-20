/** Drag strip, optional children, then rule. */
export default function MainContentTopBar({ children = null }) {
  return (
    <>
      <div
        className="main-content-topbar-strip"
        style={{ WebkitAppRegion: 'drag', backgroundColor: 'var(--bg-primary)' }}
        aria-hidden
      />
      {children}
      <div className="main-content-topbar-rule" aria-hidden />
    </>
  )
}
