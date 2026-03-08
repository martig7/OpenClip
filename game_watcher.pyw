"""
Game Watcher Background Service
Runs in background and writes game state to a file that OBS reads.
Also automatically organizes recordings when games close.
Run with: pythonw game_watcher.pyw (runs without console window)
Or: python game_watcher.pyw (with console for debugging)
"""

import ctypes
import ctypes.wintypes as wintypes
import json
import os
import sys
import time
import shutil
import re
import subprocess
from datetime import datetime, timedelta
from configparser import ConfigParser

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_DIR = os.path.join(SCRIPT_DIR, "runtime")
CONFIG_PATH = os.path.join(SCRIPT_DIR, "games_config.json")
STATE_FILE = os.path.join(RUNTIME_DIR, "game_state")
PID_FILE = os.path.join(RUNTIME_DIR, "watcher.pid")
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "manager_settings.json")
LOG_FILE = os.path.join(RUNTIME_DIR, "watcher.log")

# Ensure runtime directory exists
os.makedirs(RUNTIME_DIR, exist_ok=True)

# Check interval in seconds
CHECK_INTERVAL = 1.0

# Video file extensions
VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.flv', '.mov', '.avi', '.ts'}


def log(message):
    """Log message to console and file."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {message}"
    try:
        print(line)
    except (OSError, AttributeError):
        pass  # stdout is None/broken under pythonw
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + "\n")
    except:
        pass

# Windows API constants
TH32CS_SNAPPROCESS = 0x00000002

class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD),
        ('cntUsage', wintypes.DWORD),
        ('th32ProcessID', wintypes.DWORD),
        ('th32DefaultHeapID', ctypes.POINTER(ctypes.c_ulong)),
        ('th32ModuleID', wintypes.DWORD),
        ('cntThreads', wintypes.DWORD),
        ('th32ParentProcessID', wintypes.DWORD),
        ('pcPriClassBase', ctypes.c_long),
        ('dwFlags', wintypes.DWORD),
        ('szExeFile', wintypes.WCHAR * 260),
    ]

# Windows API
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

EnumWindows = user32.EnumWindows
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
GetWindowTextW = user32.GetWindowTextW
GetWindowTextLengthW = user32.GetWindowTextLengthW
IsWindowVisible = user32.IsWindowVisible
GetWindowThreadProcessId = user32.GetWindowThreadProcessId

CreateToolhelp32Snapshot = kernel32.CreateToolhelp32Snapshot
Process32FirstW = kernel32.Process32FirstW
Process32NextW = kernel32.Process32NextW
CloseHandle = kernel32.CloseHandle


def load_config():
    """Load games configuration."""
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {"games": []}


def load_settings():
    """Load manager settings."""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {"organized_path": "", "auto_organize": True}


def get_obs_recording_path():
    """Find OBS recording path from OBS configuration."""
    log("Searching for OBS recording path...")

    # Common OBS config locations
    appdata = os.getenv('APPDATA', '')
    log(f"  APPDATA = {appdata}")

    profiles_dir = os.path.join(appdata, 'obs-studio', 'basic', 'profiles')
    log(f"  Checking profiles dir: {profiles_dir}")

    if not os.path.exists(profiles_dir):
        log(f"  ERROR: Profiles directory does not exist!")
    else:
        # Check each profile
        profiles = os.listdir(profiles_dir)
        log(f"  Found {len(profiles)} profile(s): {profiles}")

        for profile in profiles:
            profile_dir = os.path.join(profiles_dir, profile)
            basic_ini = os.path.join(profile_dir, 'basic.ini')
            log(f"  Checking profile '{profile}': {basic_ini}")

            if not os.path.exists(basic_ini):
                log(f"    basic.ini not found")
                continue

            try:
                config = ConfigParser()
                config.read(basic_ini, encoding='utf-8-sig')

                sections = config.sections()
                log(f"    Sections found: {sections}")

                # Try SimpleOutput first, then AdvOut
                for section in ['SimpleOutput', 'AdvOut']:
                    if config.has_section(section):
                        log(f"    Checking section [{section}]")
                        # List all options in this section
                        options = config.options(section)
                        log(f"      Options: {options}")

                        for key in ['FilePath', 'RecFilePath']:
                            key_lower = key.lower()
                            if config.has_option(section, key_lower):
                                path = config.get(section, key_lower)
                                log(f"      {key} = '{path}'")
                                if path:
                                    if os.path.exists(path):
                                        log(f"    SUCCESS: Found valid path: {path}")
                                        return path
                                    else:
                                        log(f"      Path does not exist!")
            except Exception as e:
                log(f"    ERROR reading config: {e}")
                continue

    # Fallback: check common video folders
    log("  Trying fallback paths...")
    user_profile = os.getenv('USERPROFILE', '')
    fallback_paths = [
        os.path.join(user_profile, 'Videos'),
        os.path.join(user_profile, 'Videos', 'OBS'),
    ]

    for path in fallback_paths:
        log(f"    Checking fallback: {path}")
        if os.path.exists(path):
            log(f"    Using fallback path: {path}")
            return path

    log("  FAILED: Could not find any recording path!")
    return None


def get_video_files(folder):
    """Get all video files in a folder with their modification times."""
    files = {}
    if folder and os.path.exists(folder):
        for f in os.listdir(folder):
            _, ext = os.path.splitext(f)
            if ext.lower() in VIDEO_EXTENSIONS:
                full_path = os.path.join(folder, f)
                try:
                    files[full_path] = os.path.getmtime(full_path)
                except:
                    pass
    return files


def get_week_folder_name(game_name, date):
    """Generate folder name: 'GameName - Week of Mon DD YYYY'"""
    monday = date - timedelta(days=date.weekday())
    week_str = monday.strftime("%b %d %Y")
    return f"{game_name} - Week of {week_str}"


def get_session_filename(game_name, date, session_num, extension):
    """Generate filename: 'GameName Session YYYY-MM-DD #N.ext'"""
    date_str = date.strftime("%Y-%m-%d")
    return f"{game_name} Session {date_str} #{session_num}{extension}"


def count_sessions_for_date(organized_path, game_name, date):
    """Count existing sessions for a game on a specific date."""
    date_str = date.strftime("%Y-%m-%d")
    pattern = f"{game_name} Session {date_str} #"

    count = 0
    if os.path.exists(organized_path):
        for folder in os.listdir(organized_path):
            folder_path = os.path.join(organized_path, folder)
            if os.path.isdir(folder_path) and game_name in folder:
                for file in os.listdir(folder_path):
                    if file.startswith(pattern):
                        match = re.search(r'#(\d+)', file)
                        if match:
                            num = int(match.group(1))
                            count = max(count, num)
    return count


def remux_to_mp4(source_file):
    """Remux a video file to MP4 (stream copy, no re-encoding).

    Returns the new MP4 path on success, or the original path if remux fails or isn't needed.
    """
    _, ext = os.path.splitext(source_file)
    if ext.lower() == '.mp4':
        return source_file

    mp4_path = os.path.splitext(source_file)[0] + '.mp4'
    log(f"  Remuxing to MP4: {os.path.basename(source_file)} -> {os.path.basename(mp4_path)}")

    try:
        cmd = [
            'ffmpeg', '-y', '-i', source_file,
            '-map', '0',
            '-c', 'copy',
            '-movflags', '+faststart',
            mp4_path
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        if result.returncode == 0 and os.path.exists(mp4_path):
            # Remove original file
            os.remove(source_file)
            log(f"  Remux complete, original removed")
            return mp4_path
        else:
            log(f"  Remux failed (exit code {result.returncode}): {result.stderr[:200] if result.stderr else 'no output'}")
            # Clean up failed output
            if os.path.exists(mp4_path):
                os.remove(mp4_path)
    except Exception as e:
        log(f"  Remux error: {e}")

    return source_file


def organize_recording(source_file, game_name, organized_path):
    """Move and rename a recording file."""
    if not os.path.exists(source_file):
        return False, "Source file not found"

    if not organized_path:
        return False, "Organized path not set"

    _, extension = os.path.splitext(source_file)
    file_date = datetime.fromtimestamp(os.path.getmtime(source_file))

    # Create week folder
    week_folder = get_week_folder_name(game_name, file_date)
    week_path = os.path.join(organized_path, week_folder)
    os.makedirs(week_path, exist_ok=True)

    # Get session number
    session_num = count_sessions_for_date(organized_path, game_name, file_date) + 1

    # Generate new filename
    new_filename = get_session_filename(game_name, file_date, session_num, extension)
    dest_path = os.path.join(week_path, new_filename)

    try:
        shutil.move(source_file, dest_path)
        return True, dest_path
    except Exception as e:
        return False, str(e)


def get_video_duration(file_path):
    """Get video duration in seconds using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            file_path
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        if result.returncode == 0:
            return float(result.stdout.strip())
    except:
        pass
    return None


def count_clips_for_date(clips_path, game_name, date_str):
    """Count existing clips for a game on a specific date to determine next clip number."""
    pattern = f"{game_name} Clip {date_str} #"
    count = 0
    if os.path.exists(clips_path):
        for filename in os.listdir(clips_path):
            if filename.startswith(pattern):
                match = re.search(r'#(\d+)', filename)
                if match:
                    num = int(match.group(1))
                    count = max(count, num)
    return count


def load_clip_markers():
    """Load clip markers from runtime file."""
    markers_file = os.path.join(RUNTIME_DIR, "clip_markers.json")
    try:
        if os.path.exists(markers_file):
            with open(markers_file, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {"markers": []}


def save_clip_markers(markers_data):
    """Save clip markers to runtime file."""
    markers_file = os.path.join(RUNTIME_DIR, "clip_markers.json")
    try:
        with open(markers_file, 'w', encoding='utf-8') as f:
            json.dump(markers_data, f, indent=2)
        return True
    except:
        return False


def create_auto_clips(recording_path, game_name, recording_start_time, recording_end_time, settings):
    """Create clips from markers that fall within this recording session.

    Args:
        recording_path: Path to the organized recording file
        game_name: Name of the game that was recorded
        recording_start_time: Unix timestamp when recording started
        recording_end_time: Unix timestamp when recording ended
        settings: Current manager settings dict

    Returns:
        List of created clip paths
    """
    auto_clip_settings = settings.get('auto_clip_settings', {})

    if not auto_clip_settings.get('enabled', True):
        log("Auto-clip is disabled, skipping")
        return []

    buffer_before = auto_clip_settings.get('buffer_before_seconds', 30)
    buffer_after = auto_clip_settings.get('buffer_after_seconds', 30)
    remove_processed = auto_clip_settings.get('remove_processed_markers', True)

    # Load markers
    markers_data = load_clip_markers()
    all_markers = markers_data.get("markers", [])

    if not all_markers:
        log("No clip markers found")
        return []

    # Filter markers belonging to this recording session
    session_markers = []
    other_markers = []

    for marker in all_markers:
        marker_time = marker.get("timestamp", 0)
        marker_game = marker.get("game_name", "")

        if (marker_game == game_name and
                recording_start_time <= marker_time <= recording_end_time):
            session_markers.append(marker)
        else:
            other_markers.append(marker)

    if not session_markers:
        log(f"No clip markers found for this recording session ({game_name})")
        return []

    log(f"Found {len(session_markers)} clip marker(s) for this session")

    # Get video duration for clamping
    duration = get_video_duration(recording_path)
    if duration is None:
        log("WARNING: Could not determine video duration via ffprobe, skipping auto-clips")
        return []

    log(f"Recording duration: {duration:.1f}s")

    # Calculate clip regions
    regions = []
    for marker in session_markers:
        marker_time = marker["timestamp"]
        position_in_video = marker_time - recording_start_time

        clip_start = max(0, position_in_video - buffer_before)
        clip_end = min(duration, position_in_video + buffer_after)

        if clip_start < clip_end:
            regions.append((clip_start, clip_end))
            log(f"  Marker at {position_in_video:.1f}s -> clip region [{clip_start:.1f}s, {clip_end:.1f}s]")

    if not regions:
        log("No valid clip regions after clamping")
        return []

    # Sort and merge overlapping regions
    regions.sort(key=lambda r: r[0])
    merged = [regions[0]]
    for start, end in regions[1:]:
        prev_start, prev_end = merged[-1]
        if start <= prev_end:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))

    log(f"Merged into {len(merged)} clip region(s) from {len(regions)} original region(s)")

    # Determine clips output path
    organized_path = settings.get('organized_path', '')
    if not organized_path:
        log("No organized_path set, cannot create clips")
        return []

    clips_path = os.path.join(organized_path, "Clips")
    os.makedirs(clips_path, exist_ok=True)

    # Create each clip using FFmpeg stream-copy
    created_clips = []
    date_str = datetime.now().strftime("%Y-%m-%d")

    for clip_start, clip_end in merged:
        clip_duration = clip_end - clip_start
        clip_num = count_clips_for_date(clips_path, game_name, date_str) + 1
        output_filename = f"{game_name} Clip {date_str} #{clip_num}.mp4"
        output_path = os.path.join(clips_path, output_filename)

        log(f"  Creating clip: {output_filename} ({clip_start:.1f}s to {clip_end:.1f}s, {clip_duration:.1f}s)")

        cmd = [
            'ffmpeg', '-y',
            '-ss', str(clip_start),
            '-i', recording_path,
            '-t', str(clip_duration),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            output_path
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )

            if result.returncode == 0 and os.path.exists(output_path):
                log(f"  SUCCESS: Created {output_filename}")
                created_clips.append(output_path)
            else:
                log(f"  FAILED: FFmpeg exited with code {result.returncode}")
                if result.stderr:
                    log(f"    stderr: {result.stderr[:300]}")
                if os.path.exists(output_path):
                    os.remove(output_path)
        except FileNotFoundError:
            log("  FAILED: FFmpeg not found in PATH")
            break
        except Exception as e:
            log(f"  FAILED: {e}")
            if os.path.exists(output_path):
                os.remove(output_path)

    # Remove processed markers if configured and at least one clip was created
    if remove_processed and created_clips:
        markers_data["markers"] = other_markers
        if save_clip_markers(markers_data):
            log(f"Removed {len(session_markers)} processed marker(s) from clip_markers.json")
        else:
            log("WARNING: Failed to update clip_markers.json")

    log(f"Auto-clip complete: {len(created_clips)}/{len(merged)} clip(s) created")
    return created_clips


def get_visible_windows():
    """Get all visible windows with titles."""
    windows = []

    def callback(hwnd, lparam):
        if IsWindowVisible(hwnd):
            length = GetWindowTextLengthW(hwnd)
            if length > 0:
                buffer = ctypes.create_unicode_buffer(length + 1)
                GetWindowTextW(hwnd, buffer, length + 1)
                if buffer.value:
                    pid = wintypes.DWORD()
                    GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    windows.append({
                        'title': buffer.value,
                        'pid': pid.value
                    })
        return True

    EnumWindows(EnumWindowsProc(callback), 0)
    return windows


def get_process_list():
    """Get running processes."""
    processes = {}
    snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == -1:
        return processes

    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)

        if Process32FirstW(snapshot, ctypes.byref(entry)):
            while True:
                processes[entry.th32ProcessID] = entry.szExeFile.lower()
                if not Process32NextW(snapshot, ctypes.byref(entry)):
                    break
    finally:
        CloseHandle(snapshot)

    return processes


def find_running_game(config):
    """Check if any enabled game is running. Returns (game_name, scene) or (None, None)."""
    windows = get_visible_windows()
    processes = get_process_list()

    for game in config.get("games", []):
        if not game.get("enabled", True):
            continue

        selector = game.get("selector", "").lower()
        if not selector:
            continue

        for win in windows:
            # Check window title
            if selector in win['title'].lower():
                return game['name'], game.get('scene', '')

            # Check process name
            proc_name = processes.get(win['pid'], '')
            if selector in proc_name:
                return game['name'], game.get('scene', '')

    return None, None


def write_state(state):
    """Write state to file atomically."""
    temp_file = STATE_FILE + ".tmp"
    try:
        with open(temp_file, 'w') as f:
            f.write(state)
        # Atomic rename
        if os.path.exists(STATE_FILE):
            os.remove(STATE_FILE)
        os.rename(temp_file, STATE_FILE)
    except:
        pass


def write_pid():
    """Write PID file for management."""
    try:
        with open(PID_FILE, 'w') as f:
            f.write(str(os.getpid()))
    except:
        pass


def check_already_running():
    """Check if another instance is running."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                old_pid = int(f.read().strip())

            # Check if process exists
            kernel32 = ctypes.windll.kernel32
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, old_pid)
            if handle:
                kernel32.CloseHandle(handle)
                return True  # Still running
        except:
            pass

    return False


def main():
    """Main watcher loop."""
    # Clear log file on startup
    try:
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            f.write("")
    except:
        pass

    if check_already_running():
        log("Watcher already running. Exiting.")
        sys.exit(0)

    write_pid()
    log(f"Game Watcher started (PID: {os.getpid()})")
    log(f"State file: {STATE_FILE}")
    log(f"Log file: {LOG_FILE}")
    log(f"Check interval: {CHECK_INTERVAL}s")

    # Find OBS recording path
    obs_recording_path = get_obs_recording_path()
    if obs_recording_path:
        log(f"OBS recording path: {obs_recording_path}")
    else:
        log("WARNING: Could not find OBS recording path - auto-organization disabled")

    # Load initial settings
    settings = load_settings()
    log(f"Settings loaded:")
    log(f"  auto_organize: {settings.get('auto_organize', True)}")
    log(f"  organized_path: '{settings.get('organized_path', '')}'")

    if not settings.get('organized_path'):
        log("WARNING: No organized_path set in settings - recordings will not be moved")

    last_state = ""
    config_mtime = 0
    settings_mtime = 0

    # Recording session tracking
    recording_game = None
    recording_start_time = None
    files_before_recording = {}

    log("Watcher ready. Press Ctrl+C to stop.\n")

    try:
        config = load_config()

        while True:
            # Reload config if changed
            try:
                mtime = os.path.getmtime(CONFIG_PATH)
                if mtime != config_mtime:
                    config = load_config()
                    config_mtime = mtime
                    enabled = sum(1 for g in config.get("games", []) if g.get("enabled", True))
                    log(f"Config reloaded: {enabled} games enabled")
            except:
                pass

            # Reload settings if changed
            try:
                mtime = os.path.getmtime(SETTINGS_FILE)
                if mtime != settings_mtime:
                    settings = load_settings()
                    settings_mtime = mtime
                    log(f"Settings reloaded: auto_organize={settings.get('auto_organize', True)}, organized_path='{settings.get('organized_path', '')}'")
            except:
                pass

            # Find running game
            game_name, game_scene = find_running_game(config)

            # Build state string: RECORDING|game_name|scene or IDLE
            if game_name:
                state = f"RECORDING|{game_name}|{game_scene}"
            else:
                state = "IDLE"

            # Handle state changes
            if state != last_state:
                write_state(state)
                log(f"State changed: {last_state or '(none)'} -> {state}")

                # Recording started
                if state.startswith("RECORDING") and not last_state.startswith("RECORDING"):
                    recording_game = game_name
                    recording_start_time = time.time()
                    log(f"=== RECORDING SESSION STARTED: {recording_game} ===")
                    # Snapshot current files in OBS folder
                    if obs_recording_path:
                        files_before_recording = get_video_files(obs_recording_path)
                        log(f"Tracking {len(files_before_recording)} existing files in {obs_recording_path}")
                        for f in list(files_before_recording.keys())[:5]:
                            log(f"  - {os.path.basename(f)}")
                        if len(files_before_recording) > 5:
                            log(f"  ... and {len(files_before_recording) - 5} more")
                    else:
                        log("WARNING: No OBS recording path - cannot track files")

                # Recording stopped - organize new files
                elif not state.startswith("RECORDING") and last_state.startswith("RECORDING"):
                    log(f"=== RECORDING SESSION ENDED: {recording_game} ===")

                    if not obs_recording_path:
                        log("Skipping organization: No OBS recording path detected")
                    elif not settings.get('auto_organize', True):
                        log("Skipping organization: auto_organize is disabled")
                    elif not recording_game:
                        log("Skipping organization: No game name recorded")
                    else:
                        organized_path = settings.get('organized_path', '') or obs_recording_path
                        if not organized_path:
                            log("Skipping organization: No organized_path and no OBS path detected")
                        else:
                            log(f"Will organize to: {organized_path}")
                            # Small delay to ensure file is fully written
                            log("Waiting 2s for file to finish writing...")
                            time.sleep(2)

                            # Find new files
                            log(f"Scanning for new files in: {obs_recording_path}")
                            files_after = get_video_files(obs_recording_path)
                            log(f"Found {len(files_after)} total files")

                            new_files = []
                            for f, mtime in files_after.items():
                                if f not in files_before_recording:
                                    log(f"  NEW: {os.path.basename(f)}")
                                    new_files.append(f)
                                elif mtime > files_before_recording[f] + 1:
                                    log(f"  MODIFIED: {os.path.basename(f)}")
                                    new_files.append(f)

                            if new_files:
                                log(f"Organizing {len(new_files)} new recording(s)...")
                                organized_files = []
                                for new_file in new_files:
                                    # Remux non-MP4 files for web playback
                                    new_file = remux_to_mp4(new_file)
                                    log(f"  Moving: {os.path.basename(new_file)}")
                                    success, result = organize_recording(new_file, recording_game, organized_path)
                                    if success:
                                        log(f"  SUCCESS: -> {result}")
                                        organized_files.append(result)
                                    else:
                                        log(f"  FAILED: {result}")

                                # Auto-clip creation from markers
                                recording_end_time = time.time()
                                auto_clip_settings = settings.get('auto_clip_settings', {})
                                for org_file in organized_files:
                                    log(f"Checking for auto-clips: {os.path.basename(org_file)}")
                                    created_clips = create_auto_clips(
                                        org_file,
                                        recording_game,
                                        recording_start_time,
                                        recording_end_time,
                                        settings
                                    )

                                    # Delete full recording if configured and clips were created
                                    if (created_clips and
                                            auto_clip_settings.get('delete_recording_after_clips', False)):
                                        try:
                                            os.remove(org_file)
                                            log(f"Deleted full recording (clips-only mode): {os.path.basename(org_file)}")
                                        except Exception as e:
                                            log(f"WARNING: Failed to delete recording: {e}")
                            else:
                                log("No new recordings found!")
                                log("This could mean:")
                                log("  - OBS didn't create a file (recording too short?)")
                                log("  - File was saved to a different location")
                                log("  - OBS recording path detection found wrong folder")

                    recording_game = None
                    recording_start_time = None
                    files_before_recording = {}
                    log("")

                last_state = state

            time.sleep(CHECK_INTERVAL)

    except KeyboardInterrupt:
        log("\nStopping...")
    finally:
        # Cleanup
        write_state("STOPPED")
        try:
            os.remove(PID_FILE)
        except:
            pass
        log("Watcher stopped.")


if __name__ == "__main__":
    main()
