/** Electron drag strip + optional body + hairline — shared with VideoPlayer, Settings detail, Games. */
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
