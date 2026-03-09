"""
OBS Game Auto-Recorder Script
Automatically starts recording when specified programs are running.
Uses lightweight Windows API calls instead of spawning WMIC/PowerShell.
"""

import ctypes
import ctypes.wintypes as wintypes
import json
import os
import re

# Try to import obspython (only available when running in OBS)
try:
    import obspython as obs
    IN_OBS = True
except ImportError:
    IN_OBS = False
    obs = None

# Script directory and config path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "games_config.json")
ICONS_DIR = os.path.join(SCRIPT_DIR, "icons")

# Script settings
check_interval = 3000  # milliseconds (default higher for less load)
is_recording_for_game = False
current_game = None
games_config = {"games": []}
current_settings = None

# Windows API constants
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
TH32CS_SNAPPROCESS = 0x00000002

# Windows API structures
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

# Load Windows DLLs
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
psapi = ctypes.windll.psapi

# Define function signatures
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


def log(level, message):
    """Log a message."""
    if IN_OBS and obs:
        obs.script_log(level, message)
    else:
        print(f"[LOG] {message}")


def ensure_icons_dir():
    if not os.path.exists(ICONS_DIR):
        os.makedirs(ICONS_DIR)


def load_config():
    global games_config
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                games_config = json.load(f)
                if "games" not in games_config:
                    games_config["games"] = []
        else:
            games_config = {"games": []}
            save_config()
    except Exception as e:
        log(0, f"Error loading config: {e}")
        games_config = {"games": []}
    return games_config


def save_config():
    try:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(games_config, f, indent=2)
    except Exception as e:
        log(0, f"Error saving config: {e}")


def add_game(name, selector, enabled=True):
    for game in games_config.get("games", []):
        if game.get("selector", "").lower() == selector.lower():
            return False, "Game with this selector already exists"

    game = {
        "name": name,
        "selector": selector,
        "icon_path": "",
        "enabled": enabled
    }
    games_config["games"].append(game)
    save_config()
    return True, "Game added successfully"


def remove_game(selector):
    for game in games_config.get("games", []):
        if game.get("selector", "").lower() == selector.lower():
            if game.get('icon_path') and os.path.exists(game.get('icon_path')):
                try:
                    os.remove(game.get('icon_path'))
                except:
                    pass
            break

    games_config["games"] = [
        g for g in games_config.get("games", [])
        if g.get("selector", "").lower() != selector.lower()
    ]
    save_config()


def set_game_enabled(selector, enabled):
    for game in games_config.get("games", []):
        if game.get("selector", "").lower() == selector.lower():
            game["enabled"] = enabled
            save_config()
            return True
    return False


# =============================================================================
# Lightweight Process Detection using Windows API (no subprocess spawning)
# =============================================================================

def get_visible_windows():
    """
    Get all visible windows with their titles and PIDs.
    Uses direct Windows API calls - very lightweight.
    Returns: list of {'title': str, 'pid': int}
    """
    windows = []

    def enum_callback(hwnd, lparam):
        if IsWindowVisible(hwnd):
            length = GetWindowTextLengthW(hwnd)
            if length > 0:
                buffer = ctypes.create_unicode_buffer(length + 1)
                GetWindowTextW(hwnd, buffer, length + 1)
                title = buffer.value

                if title:  # Only windows with titles
                    pid = wintypes.DWORD()
                    GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    windows.append({
                        'title': title,
                        'pid': pid.value,
                        'hwnd': hwnd
                    })
        return True

    EnumWindows(EnumWindowsProc(enum_callback), 0)
    return windows


def get_process_list():
    """
    Get list of running processes using Windows API.
    Much lighter than WMIC/PowerShell.
    Returns: dict of {pid: process_name}
    """
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


def get_processes_detailed():
    """
    Get detailed process info - lightweight version.
    Only fetches what we need for matching.
    """
    windows = get_visible_windows()
    processes_map = get_process_list()

    processes = []
    seen_pids = set()

    for win in windows:
        pid = win['pid']
        if pid in seen_pids:
            continue
        seen_pids.add(pid)

        proc_name = processes_map.get(pid, '')

        processes.append({
            'name': proc_name,
            'pid': pid,
            'window_title': win['title'],
            'hwnd': win['hwnd'],
            'command_line': ''  # Skip command line for performance
        })

    return processes


def is_program_running(target_name, processes=None):
    """Check if a program is running by window title or process name."""
    if not target_name:
        return False, None

    if processes is None:
        processes = get_processes_detailed()

    target_lower = target_name.lower()

    for proc in processes:
        # Check window title (most reliable for games)
        if target_lower in proc['window_title'].lower():
            return True, proc

        # Check process name
        if target_lower in proc['name']:
            return True, proc

    return False, None


def check_any_game_running(processes=None):
    """Check if any enabled game is running."""
    if processes is None:
        processes = get_processes_detailed()

    for game in games_config.get("games", []):
        if not game.get("enabled", True):
            continue

        selector = game.get("selector", "")
        if selector:
            is_running, proc = is_program_running(selector, processes)
            if is_running:
                try_extract_icon_for_game(game, proc)
                return game, proc

    return None, None


# =============================================================================
# Icon Extraction (only runs once per game, not in hot path)
# =============================================================================

def extract_icon_from_window(hwnd, output_path):
    """Extract icon from a window handle."""
    try:
        from PIL import Image
        import win32gui
        import win32ui
        import win32con

        icon_handle = win32gui.SendMessage(hwnd, win32con.WM_GETICON, win32con.ICON_BIG, 0)
        if not icon_handle:
            icon_handle = win32gui.GetClassLong(hwnd, win32con.GCL_HICON)
        if not icon_handle:
            icon_handle = win32gui.SendMessage(hwnd, win32con.WM_GETICON, win32con.ICON_SMALL, 0)
        if not icon_handle:
            icon_handle = win32gui.GetClassLong(hwnd, win32con.GCL_HICONSM)

        if icon_handle:
            icon_info = win32gui.GetIconInfo(icon_handle)
            bmp_handle = icon_info[4]

            if bmp_handle:
                bmp = win32ui.CreateBitmapFromHandle(bmp_handle)
                bmp_info = bmp.GetInfo()
                width = bmp_info['bmWidth']
                height = bmp_info['bmHeight']

                hwnd_dc = win32gui.GetDC(0)
                dc = win32ui.CreateDCFromHandle(hwnd_dc)
                mem_dc = dc.CreateCompatibleDC()

                new_bmp = win32ui.CreateBitmap()
                new_bmp.CreateCompatibleBitmap(dc, width, height)
                old_bmp = mem_dc.SelectObject(new_bmp)
                mem_dc.DrawIcon((0, 0), icon_handle)

                bmp_str = new_bmp.GetBitmapBits(True)
                img = Image.frombuffer('RGBA', (width, height), bmp_str, 'raw', 'BGRA', 0, 1)
                img.save(output_path, 'PNG')

                mem_dc.SelectObject(old_bmp)
                mem_dc.DeleteDC()
                dc.DeleteDC()
                win32gui.ReleaseDC(0, hwnd_dc)
                return True

    except ImportError:
        pass
    except Exception as e:
        log(0, f"Error extracting icon: {e}")

    return False


def try_extract_icon_for_game(game, proc):
    """Try to extract icon (only if we don't have one)."""
    if game.get("icon_path") and os.path.exists(game.get("icon_path")):
        return

    ensure_icons_dir()
    safe_name = re.sub(r'[^\w\-]', '_', game['name'])
    icon_path = os.path.join(ICONS_DIR, f"{safe_name}.png")

    hwnd = proc.get('hwnd')
    if hwnd and extract_icon_from_window(hwnd, icon_path):
        game['icon_path'] = icon_path
        save_config()
        log(0 if not IN_OBS else obs.LOG_INFO, f"Extracted icon for {game['name']}")


# =============================================================================
# OBS Script Interface
# =============================================================================

def check_program_callback():
    """Timer callback - lightweight check."""
    global is_recording_for_game, current_game

    game, proc = check_any_game_running()
    recording_active = obs.obs_frontend_recording_active()

    if game and not recording_active and not is_recording_for_game:
        proc_info = proc['window_title'] or proc['name']
        log(obs.LOG_INFO, f"Detected '{game['name']}' ({proc_info}) - Starting recording")
        obs.obs_frontend_recording_start()
        is_recording_for_game = True
        current_game = game

    elif not game and is_recording_for_game:
        game_name = current_game['name'] if current_game else "game"
        log(obs.LOG_INFO, f"'{game_name}' closed - Stopping recording")
        obs.obs_frontend_recording_stop()
        is_recording_for_game = False
        current_game = None


def on_add_game_clicked(props, prop):
    global current_settings

    if current_settings is None:
        log(obs.LOG_WARNING, "Settings not available")
        return False

    name = obs.obs_data_get_string(current_settings, "new_game_name").strip()
    selector = obs.obs_data_get_string(current_settings, "new_game_selector").strip()

    if not name:
        log(obs.LOG_WARNING, "Please enter a game name")
        return False

    if not selector:
        log(obs.LOG_WARNING, "Please enter a selector")
        return False

    load_config()
    success, message = add_game(name, selector, enabled=True)

    if success:
        log(obs.LOG_INFO, f"Added game: {name} (selector: {selector})")
        obs.obs_data_set_string(current_settings, "new_game_name", "")
        obs.obs_data_set_string(current_settings, "new_game_selector", "")

        # Try to extract icon
        processes = get_processes_detailed()
        is_running, proc = is_program_running(selector, processes)
        if is_running:
            for g in games_config.get('games', []):
                if g['selector'] == selector:
                    try_extract_icon_for_game(g, proc)
                    break
    else:
        log(obs.LOG_WARNING, f"Failed: {message}")

    return True


def on_remove_game_clicked(props, prop):
    global current_settings

    if current_settings is None:
        return False

    selector = obs.obs_data_get_string(current_settings, "remove_game_selector")

    if selector and selector != "":
        load_config()
        game_name = None
        for game in games_config.get('games', []):
            if game['selector'] == selector:
                game_name = game['name']
                break

        remove_game(selector)
        if game_name:
            log(obs.LOG_INFO, f"Removed game: {game_name}")

    return True


def on_detect_running_clicked(props, prop):
    global current_settings

    if current_settings is None:
        return False

    windows = get_visible_windows()

    # Filter out common system windows
    system_titles = ['program manager', 'settings', 'task manager', 'obs']
    system_procs = ['explorer.exe', 'cmd.exe', 'powershell.exe', 'code.exe',
                   'chrome.exe', 'firefox.exe', 'msedge.exe', 'obs64.exe', 'obs32.exe',
                   'searchhost.exe', 'textinputhost.exe', 'shellexperiencehost.exe']

    processes_map = get_process_list()

    for win in windows:
        proc_name = processes_map.get(win['pid'], '')
        title_lower = win['title'].lower()

        # Skip system windows
        if proc_name in system_procs:
            continue
        if any(s in title_lower for s in system_titles):
            continue

        obs.obs_data_set_string(current_settings, "new_game_selector", win['title'])
        log(obs.LOG_INFO, f"Detected: {win['title']}")
        return True

    if windows:
        obs.obs_data_set_string(current_settings, "new_game_selector", windows[0]['title'])
        log(obs.LOG_INFO, f"Detected: {windows[0]['title']}")
    else:
        log(obs.LOG_WARNING, "No windows detected")

    return True


def on_game_checkbox_changed(props, prop, settings):
    for game in games_config.get("games", []):
        setting_name = f"game_enabled_{game['selector']}"
        game['enabled'] = obs.obs_data_get_bool(settings, setting_name)
    save_config()
    return True


def populate_remove_dropdown(prop):
    obs.obs_property_list_clear(prop)
    obs.obs_property_list_add_string(prop, "-- Select a game --", "")

    load_config()
    for game in games_config.get('games', []):
        obs.obs_property_list_add_string(prop, game['name'], game['selector'])


def script_description():
    return """<b>Game Auto-Recorder</b> (Lightweight)
<hr>
Automatically starts recording when games are running.
<br><br>
<b>To add a game:</b>
<ol>
    <li>Open your game</li>
    <li>Click "Detect Running Game"</li>
    <li>Enter a display name</li>
    <li>Click "Add Game"</li>
</ol>
<small>Uses efficient Windows API calls - minimal CPU impact.</small>
"""


def script_properties():
    load_config()
    props = obs.obs_properties_create()

    obs.obs_properties_add_int(
        props, "check_interval", "Check Interval (ms)", 1000, 30000, 500
    )

    # Add Game Section
    obs.obs_properties_add_text(props, "section_add", "─── Add New Game ───", obs.OBS_TEXT_INFO)

    obs.obs_properties_add_text(props, "new_game_name", "Game Name", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "new_game_selector", "Selector (window title)", obs.OBS_TEXT_DEFAULT)

    obs.obs_properties_add_button(props, "detect_btn", "Detect Running Game", on_detect_running_clicked)
    obs.obs_properties_add_button(props, "add_btn", "Add Game", on_add_game_clicked)

    # Remove Game Section
    obs.obs_properties_add_text(props, "section_remove", "─── Remove Game ───", obs.OBS_TEXT_INFO)

    remove_list = obs.obs_properties_add_list(
        props, "remove_game_selector", "Select Game",
        obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING
    )
    populate_remove_dropdown(remove_list)

    obs.obs_properties_add_button(props, "remove_btn", "Remove Selected Game", on_remove_game_clicked)

    # Game List Section
    obs.obs_properties_add_text(props, "section_games", "─── Enabled Games ───", obs.OBS_TEXT_INFO)

    if not games_config.get("games"):
        obs.obs_properties_add_text(props, "no_games", "No games configured yet.", obs.OBS_TEXT_INFO)
    else:
        for game in games_config.get("games", []):
            setting_name = f"game_enabled_{game['selector']}"
            label = game['name']
            if game.get('icon_path') and os.path.exists(game.get('icon_path')):
                label += " ★"
            checkbox = obs.obs_properties_add_bool(props, setting_name, label)
            obs.obs_property_set_modified_callback(checkbox, on_game_checkbox_changed)

    obs.obs_properties_add_text(
        props, "hint",
        "Refresh script after adding/removing games to update list.",
        obs.OBS_TEXT_INFO
    )

    return props


def script_defaults(settings):
    obs.obs_data_set_default_int(settings, "check_interval", 3000)
    obs.obs_data_set_default_string(settings, "new_game_name", "")
    obs.obs_data_set_default_string(settings, "new_game_selector", "")

    load_config()
    for game in games_config.get("games", []):
        setting_name = f"game_enabled_{game['selector']}"
        obs.obs_data_set_default_bool(settings, setting_name, game.get('enabled', True))


def script_update(settings):
    global check_interval, current_settings

    current_settings = settings
    check_interval = obs.obs_data_get_int(settings, "check_interval")

    load_config()
    for game in games_config.get("games", []):
        setting_name = f"game_enabled_{game['selector']}"
        game['enabled'] = obs.obs_data_get_bool(settings, setting_name)
    save_config()

    obs.timer_remove(check_program_callback)
    obs.timer_add(check_program_callback, check_interval)

    enabled_count = sum(1 for g in games_config.get("games", []) if g.get('enabled', True))
    log(obs.LOG_INFO, f"Monitoring {enabled_count} game(s) every {check_interval}ms")


def script_load(settings):
    global current_settings
    current_settings = settings
    load_config()
    log(obs.LOG_INFO, "Game Auto-Recorder loaded (lightweight mode)")


def script_unload():
    obs.timer_remove(check_program_callback)
    log(obs.LOG_INFO, "Game Auto-Recorder unloaded")
