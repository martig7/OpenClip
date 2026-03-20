/** Electron drag region + hairline — shared with VideoPlayer (Recordings/Clips main pane). */
export default function MainContentTopBar() {
  return (
    <>
      <div
        className="main-content-topbar-strip"
        style={{ WebkitAppRegion: 'drag', backgroundColor: 'var(--bg-primary)' }}
        aria-hidden
      />
      <div className="main-content-topbar-rule" aria-hidden />
    </>
  )
}
