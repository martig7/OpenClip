import { useRef, useState, useEffect } from 'react'
import {
  FolderOpen,
  Calendar,
  HardDrive,
  MoveRight,
  Scissors,
  MoreHorizontal,
  Play,
  Trash2,
  Plus,
  Minus,
  Maximize,
} from 'lucide-react'
import { formatTime } from '../utils'

export default function VideoPlayerInfoBar({
  media,
  isUnorganized,
  isClipMode,
  organizeMode,
  setOrganizeMode,
  isOrganizing,
  
  clipStart,
  clipEnd,
  isZoomTimelineExpanded,
  setIsZoomTimelineExpanded,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  
  enterClipMode,
  exitClipMode,
  handleCreateClip,
  isCreatingClip,
  
  onDelete,
  handleOpenInPlayer,
  handleShowInExplorer,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRefTitle = useRef(null)
  const dropdownRefClip = useRef(null)
  
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        (dropdownRefTitle.current && dropdownRefTitle.current.contains(e.target)) ||
        (dropdownRefClip.current && dropdownRefClip.current.contains(e.target))
      ) {
        return;
      }
      setDropdownOpen(false)
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  return (
    <div className="video-info-bar-compact">
      {/* View 1: Title Bar */}
      <div 
        className={`video-info-fade-layer transition-opacity duration-300 ${isClipMode ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
      >
        <div className="video-info-left">
          <div className="video-info-title-col">
            <div className="video-info-title-row">
              <span className="video-info-filename">{media.filename}</span>
              {isUnorganized && (
                <span className="unorganized-badge-compact">Unorganized</span>
              )}
            </div>
            <div className="video-info-meta">
              <span>
                <FolderOpen size={18} /> {media.game_name}
              </span>
              <span>
                <Calendar size={18} /> {media.date}
              </span>
              <span>
                <HardDrive size={18} /> {media.size_formatted}
              </span>
            </div>
          </div>
        </div>
        
        <div className="video-info-actions">
          {isUnorganized ? (
            <button
              className={`btn-action-organize${organizeMode ? ' active' : ''}`}
              onClick={() => setOrganizeMode((o) => !o)}
              disabled={isOrganizing}
            >
              <MoveRight size={21} /> Organize
            </button>
          ) : (
            <button className="btn-action-primary shrink-0" onClick={enterClipMode}>
              <Scissors size={21} /> Create Clip
            </button>
          )}

          <div className="action-dropdown" ref={dropdownRefTitle}>
            <button
              className={`btn-action-more ${dropdownOpen ? 'active' : ''}`}
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <MoreHorizontal size={21} />
            </button>
            {dropdownOpen && (
              <div className="dropdown-menu">
                <button onClick={() => { setDropdownOpen(false); handleOpenInPlayer(); }}>
                  <Play size={21} /> Open in Player
                </button>
                <button onClick={() => { setDropdownOpen(false); handleShowInExplorer(); }}>
                  <FolderOpen size={21} /> Show in Explorer
                </button>
                {onDelete && (
                  <button className="danger" onClick={() => { setDropdownOpen(false); onDelete(); }}>
                    <Trash2 size={21} /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View 2: Clip Creation Controls */}
      <div 
        className={`video-info-fade-layer transition-opacity duration-300 ${!isClipMode ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
      >
        <div className="video-info-left">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-8">
              
              <div className="video-info-title-col">
                <div className="video-info-title-row gap-2">
                  <button className="btn-action-more !w-[36px] !h-[36px] font-medium shrink-0" onClick={() => { onZoomOut(); }}>
                    <Minus size={20} />
                  </button>
                  <button className="btn-action-more !w-[36px] !h-[36px] font-medium shrink-0" onClick={() => { onZoomIn(); }}>
                    <Plus size={20} />
                  </button>
                  <button className="btn-action-more !w-[36px] !h-[36px] font-medium shrink-0" title="Fit Region" onClick={() => { onZoomFit(); }}>
                    <Maximize size={18} />
                  </button>
                </div>
                <div className="flex items-center">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider ml-1 mt-0.5">Zoom Level</span>
                </div>
              </div>

              <div className="flex items-center gap-6 bg-[#0f0f0f] px-4 py-1.5 rounded-lg border border-[#333]">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold text-center">Start</span>
                  <span className="text-sm font-mono text-gray-300">{formatTime(clipStart)}</span>
                </div>
                <div className="w-px h-4 bg-[#333]"></div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold text-center">Dur</span>
                  <span className="text-sm font-mono text-[#a78bfa]">{formatTime(clipEnd - clipStart)}</span>
                </div>
                <div className="w-px h-4 bg-[#333]"></div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold text-center">End</span>
                  <span className="text-sm font-mono text-gray-300">{formatTime(clipEnd)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="video-info-actions flex items-center gap-3">
          <button 
            className="btn-action-more !w-auto !px-[18px] !text-[18px] font-medium shrink-0"
            onClick={exitClipMode} 
            disabled={isCreatingClip}
          >
            Cancel
          </button>
          
          <button className="btn-action-primary shrink-0" onClick={handleCreateClip} disabled={isCreatingClip || (clipEnd - clipStart) <= 0}>
            {isCreatingClip ? (
              <><div className="spinner-sm" /> Creating…</>
            ) : (
              <><Scissors size={21} /> Create Clip</>
            )}
          </button>

          <div className="action-dropdown" ref={dropdownRefClip}>
            <button
              className={`btn-action-more ${dropdownOpen ? 'active' : ''}`}
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <MoreHorizontal size={21} />
            </button>
            {dropdownOpen && (
              <div className="dropdown-menu">
                <button onClick={() => { setDropdownOpen(false); handleOpenInPlayer(); }}>
                  <Play size={21} /> Open in Player
                </button>
                <button onClick={() => { setDropdownOpen(false); handleShowInExplorer(); }}>
                  <FolderOpen size={21} /> Show in Explorer
                </button>
                {onDelete && (
                  <button className="danger" onClick={() => { setDropdownOpen(false); onDelete(); }}>
                    <Trash2 size={21} /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
