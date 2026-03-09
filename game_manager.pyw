"""
Game Manager GUI
Tkinter application to manage games and control the watcher.
Recording organization is handled automatically by the watcher.
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import ctypes
import ctypes.wintypes as wintypes
import json
import os
import subprocess
import time
import threading
import winsound
from datetime import datetime
from configparser import ConfigParser
from PIL import Image, ImageTk

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_DIR = os.path.join(SCRIPT_DIR, "runtime")
CONFIG_PATH = os.path.join(SCRIPT_DIR, "games_config.json")
STATE_FILE = os.path.join(RUNTIME_DIR, "game_state")
PID_FILE = os.path.join(RUNTIME_DIR, "watcher.pid")
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "manager_settings.json")
MARKERS_FILE = os.path.join(RUNTIME_DIR, "clip_markers.json")

# Ensure runtime directory exists
os.makedirs(RUNTIME_DIR, exist_ok=True)

# Virtual key codes for hotkeys
VK_CODES = {
    'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74,
    'F6': 0x75, 'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79,
    'F11': 0x7A, 'F12': 0x7B,
    'INSERT': 0x2D, 'DELETE': 0x2E, 'HOME': 0x24, 'END': 0x23,
    'PAGEUP': 0x21, 'PAGEDOWN': 0x22,
    'NUMPAD0': 0x60, 'NUMPAD1': 0x61, 'NUMPAD2': 0x62, 'NUMPAD3': 0x63,
    'NUMPAD4': 0x64, 'NUMPAD5': 0x65, 'NUMPAD6': 0x66, 'NUMPAD7': 0x67,
    'NUMPAD8': 0x68, 'NUMPAD9': 0x69,
}
VK_TO_NAME = {v: k for k, v in VK_CODES.items()}

# Windows API
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


# ============== Config Functions ==============

def load_config():
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {"games": []}


def save_config(config):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2)


def load_settings():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {
        "organized_path": "",
        "auto_organize": True
    }


def save_settings(settings):
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving settings: {e}")
        return False


def load_markers():
    """Load clip markers from file."""
    try:
        if os.path.exists(MARKERS_FILE):
            with open(MARKERS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except:
        pass
    return {"markers": []}


def save_markers(markers):
    """Save clip markers to file."""
    try:
        with open(MARKERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(markers, f, indent=2)
        return True
    except:
        return False


def add_clip_marker(game_name):
    """Add a clip marker for the current time."""
    markers = load_markers()
    markers["markers"].append({
        "game_name": game_name,
        "timestamp": time.time(),
        "created_at": datetime.now().isoformat()
    })
    save_markers(markers)
    return True


def get_obs_recording_path():
    """Find OBS recording path from OBS configuration."""
    appdata = os.getenv('APPDATA', '')
    profiles_dir = os.path.join(appdata, 'obs-studio', 'basic', 'profiles')

    if os.path.exists(profiles_dir):
        for profile in os.listdir(profiles_dir):
            basic_ini = os.path.join(profiles_dir, profile, 'basic.ini')
            if os.path.exists(basic_ini):
                try:
                    config = ConfigParser()
                    config.read(basic_ini, encoding='utf-8-sig')
                    for section in ['SimpleOutput', 'AdvOut']:
                        if config.has_section(section):
                            for key in ['filepath', 'recfilepath']:
                                if config.has_option(section, key):
                                    path = config.get(section, key)
                                    if path and os.path.exists(path):
                                        return path
                except:
                    continue

    # Fallback
    user_profile = os.getenv('USERPROFILE', '')
    for path in [os.path.join(user_profile, 'Videos'), os.path.join(user_profile, 'Videos', 'OBS')]:
        if os.path.exists(path):
            return path
    return None


def find_obs_executable():
    """Try to find the OBS executable automatically."""
    import winreg

    # Check common install locations first
    common_paths = [
        os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), 'obs-studio', 'bin', '64bit', 'obs64.exe'),
        os.path.join(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'), 'obs-studio', 'bin', '64bit', 'obs64.exe'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    ]
    for p in common_paths:
        if os.path.isfile(p):
            return p

    # Check Windows registry (Uninstall keys)
    reg_paths = [
        (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\OBS Studio'),
        (winreg.HKEY_CURRENT_USER, r'SOFTWARE\OBS Studio'),
        (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\OBS Studio'),
    ]
    for hive, subkey in reg_paths:
        try:
            with winreg.OpenKey(hive, subkey) as key:
                install_dir, _ = winreg.QueryValueEx(key, '')
                candidate = os.path.join(install_dir, 'bin', '64bit', 'obs64.exe')
                if os.path.isfile(candidate):
                    return candidate
        except OSError:
            continue

    # Check Uninstall registry entries for InstallLocation
    uninstall_keys = [
        (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'),
        (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'),
        (winreg.HKEY_CURRENT_USER, r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'),
    ]
    for hive, subkey in uninstall_keys:
        try:
            with winreg.OpenKey(hive, subkey) as key:
                i = 0
                while True:
                    try:
                        name = winreg.EnumKey(key, i)
                        if 'obs' in name.lower():
                            with winreg.OpenKey(key, name) as entry:
                                try:
                                    loc, _ = winreg.QueryValueEx(entry, 'InstallLocation')
                                    candidate = os.path.join(loc, 'bin', '64bit', 'obs64.exe')
                                    if os.path.isfile(candidate):
                                        return candidate
                                except OSError:
                                    pass
                        i += 1
                    except OSError:
                        break
        except OSError:
            continue

    return None


def get_obs_profile_dir():
    """Return the path to the first OBS profile directory."""
    appdata = os.getenv('APPDATA', '')
    profiles_dir = os.path.join(appdata, 'obs-studio', 'basic', 'profiles')
    if os.path.exists(profiles_dir):
        for profile in os.listdir(profiles_dir):
            profile_path = os.path.join(profiles_dir, profile)
            if os.path.isdir(profile_path) and os.path.exists(os.path.join(profile_path, 'basic.ini')):
                return profile_path
    return None


def _make_case_preserving_parser():
    """Create a ConfigParser that preserves key casing (OBS requires original case)."""
    config = ConfigParser()
    config.optionxform = lambda optionstr: optionstr  # Preserve original key casing
    return config


def read_obs_encoding_settings():
    """Read encoding settings from the OBS profile. Returns (dict, profile_path) or (None, None)."""
    profile_dir = get_obs_profile_dir()
    if not profile_dir:
        return None, None

    settings = {}
    basic_ini = os.path.join(profile_dir, 'basic.ini')
    config = _make_case_preserving_parser()
    config.read(basic_ini, encoding='utf-8-sig')

    # Video settings — try both original and lowercased keys (in case file was already lowercased)
    if config.has_section('Video'):
        for key_upper, key_lower in [('OutputCX', 'outputcx'), ('OutputCY', 'outputcy'), ('FPSCommon', 'fpscommon')]:
            val = config.get('Video', key_upper, fallback=None) or config.get('Video', key_lower, fallback=None)
            if key_upper == 'OutputCX':
                settings['output_cx'] = val or '1920'
            elif key_upper == 'OutputCY':
                settings['output_cy'] = val or '1080'
            elif key_upper == 'FPSCommon':
                settings['fps_common'] = val or '60'

    # Determine output mode
    output_mode = config.get('Output', 'Mode', fallback=None) or config.get('Output', 'mode', fallback='Simple')
    settings['output_mode'] = output_mode

    if output_mode.lower() == 'advanced' and config.has_section('AdvOut'):
        settings['rec_encoder'] = (config.get('AdvOut', 'RecEncoder', fallback=None)
                                   or config.get('AdvOut', 'recencoder', fallback=''))
        settings['rec_format'] = (config.get('AdvOut', 'RecFormat2', fallback=None)
                                  or config.get('AdvOut', 'recformat2', fallback='mkv'))
    elif config.has_section('SimpleOutput'):
        settings['rec_encoder'] = (config.get('SimpleOutput', 'RecEncoder', fallback=None)
                                   or config.get('SimpleOutput', 'recencoder', fallback=''))
        settings['rec_format'] = (config.get('SimpleOutput', 'RecFormat', fallback=None)
                                  or config.get('SimpleOutput', 'recformat', fallback='mp4'))

    # Encoder JSON settings
    encoder_json = os.path.join(profile_dir, 'recordEncoder.json')
    if os.path.exists(encoder_json):
        try:
            with open(encoder_json, 'r', encoding='utf-8') as f:
                enc = json.load(f)
            settings['rate_control'] = enc.get('rate_control', '')
            settings['bitrate'] = str(enc.get('bitrate', ''))
            settings['max_bitrate'] = str(enc.get('max_bitrate', ''))
            settings['cqp'] = str(enc.get('cqp', ''))
            settings['target_quality'] = str(enc.get('target_quality', ''))
            settings['preset'] = enc.get('preset', '')
        except:
            pass

    return settings, profile_dir


def _ini_replace_value(lines, section, key, value):
    """Replace a key's value in an INI file's lines, matching case-insensitively."""
    in_section = False
    key_lower = key.lower()
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('[') and stripped.endswith(']'):
            in_section = (stripped[1:-1] == section)
            continue
        if in_section and '=' in stripped:
            line_key = stripped.split('=', 1)[0].strip()
            if line_key.lower() == key_lower:
                lines[i] = f"{line_key}={value}\n"
                return True
    return False


def save_obs_encoding_settings(settings, profile_dir):
    """Write encoding settings back to OBS profile files, preserving original formatting."""
    basic_ini = os.path.join(profile_dir, 'basic.ini')

    with open(basic_ini, 'r', encoding='utf-8-sig') as f:
        lines = f.readlines()

    # Detect output mode
    config = _make_case_preserving_parser()
    config.read(basic_ini, encoding='utf-8-sig')
    output_mode = config.get('Output', 'Mode', fallback=None) or config.get('Output', 'mode', fallback='Simple')

    # Video settings
    _ini_replace_value(lines, 'Video', 'OutputCX', settings['output_cx'])
    _ini_replace_value(lines, 'Video', 'OutputCY', settings['output_cy'])
    _ini_replace_value(lines, 'Video', 'FPSCommon', settings['fps_common'])

    # Recording output settings
    if output_mode.lower() == 'advanced':
        _ini_replace_value(lines, 'AdvOut', 'RecEncoder', settings['rec_encoder'])
        _ini_replace_value(lines, 'AdvOut', 'RecFormat2', settings['rec_format'])
    else:
        _ini_replace_value(lines, 'SimpleOutput', 'RecEncoder', settings['rec_encoder'])
        _ini_replace_value(lines, 'SimpleOutput', 'RecFormat', settings['rec_format'])

    with open(basic_ini, 'w', encoding='utf-8-sig') as f:
        f.writelines(lines)

    # Encoder JSON settings
    encoder_json = os.path.join(profile_dir, 'recordEncoder.json')
    enc = {}
    if os.path.exists(encoder_json):
        try:
            with open(encoder_json, 'r', encoding='utf-8') as f:
                enc = json.load(f)
        except:
            pass

    if settings.get('rate_control'):
        enc['rate_control'] = settings['rate_control']
    for key in ['bitrate', 'max_bitrate', 'cqp', 'target_quality']:
        val = settings.get(key, '').strip()
        if val:
            try:
                enc[key] = int(val)
            except ValueError:
                pass
    if settings.get('preset'):
        enc['preset'] = settings['preset']

    with open(encoder_json, 'w', encoding='utf-8') as f:
        json.dump(enc, f)


def is_obs_running():
    """Check if OBS is currently running."""
    processes = get_process_list()
    for name in processes.values():
        if name.lower() == 'obs64.exe':
            return True
    return False


# ============== Windows API Functions ==============

def get_visible_windows():
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
                    windows.append({'title': buffer.value, 'pid': pid.value})
        return True

    EnumWindows(EnumWindowsProc(callback), 0)
    return windows


def get_process_list():
    processes = {}
    snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == -1:
        return processes

    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        if Process32FirstW(snapshot, ctypes.byref(entry)):
            while True:
                processes[entry.th32ProcessID] = entry.szExeFile
                if not Process32NextW(snapshot, ctypes.byref(entry)):
                    break
    finally:
        CloseHandle(snapshot)
    return processes


def is_watcher_running():
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            handle = kernel32.OpenProcess(0x1000, False, pid)
            if handle:
                kernel32.CloseHandle(handle)
                return True, pid
        except:
            pass
    return False, None


def get_watcher_state():
    try:
        with open(STATE_FILE, 'r') as f:
            return f.read().strip()
    except:
        return None


# ============== Main Application ==============

class GameManagerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Game Auto-Recorder Manager")
        self.root.geometry("600x700")
        self.root.minsize(550, 650)
        self.root.resizable(True, True)

        self.settings = load_settings()
        self.obs_recording_path = get_obs_recording_path()
        self.game_icons = {}  # Cache for loaded icons
        self.viewer_process = None  # Track recordings viewer subprocess
        self.hotkey_listener_running = False
        self.current_recording_game = None  # Track which game is being recorded

        # Handle window close to clean up subprocesses
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Start hotkey listener if configured
        self.start_hotkey_listener()

        # Auto-start watcher on startup if configured
        if self.settings.get('start_watcher_on_startup', False):
            self.start_watcher()

        # Create notebook (tabs)
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # Create tabs
        self.create_main_tab()
        self.create_settings_tab()
        self.create_encoding_tab()

        # Initial load
        self.refresh_games()

        # Auto-refresh
        self.auto_refresh()

    def create_main_tab(self):
        """Main tab with watcher control and games list."""
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="Games")

        # === Status Section ===
        status_frame = ttk.LabelFrame(tab, text="Status", padding=10)
        status_frame.pack(fill=tk.X, pady=(0, 10))

        self.watcher_status = ttk.Label(status_frame, text="Watcher: Unknown")
        self.watcher_status.pack(anchor=tk.W)

        self.state_label = ttk.Label(status_frame, text="State: Unknown")
        self.state_label.pack(anchor=tk.W)

        btn_frame = ttk.Frame(status_frame)
        btn_frame.pack(fill=tk.X, pady=(10, 0))

        self.start_btn = ttk.Button(btn_frame, text="Start Watcher", command=self.start_watcher)
        self.start_btn.pack(side=tk.LEFT, padx=(0, 5))

        self.stop_btn = ttk.Button(btn_frame, text="Stop Watcher", command=self.stop_watcher)
        self.stop_btn.pack(side=tk.LEFT)

        ttk.Button(btn_frame, text="View Recordings", command=self.open_recordings_viewer).pack(side=tk.RIGHT)
        ttk.Button(btn_frame, text="Open OBS", command=self.open_obs).pack(side=tk.RIGHT, padx=(0, 5))

        # === Games Section ===
        games_frame = ttk.LabelFrame(tab, text="Games", padding=10)
        games_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 10))

        list_frame = ttk.Frame(games_frame)
        list_frame.pack(fill=tk.BOTH, expand=True)

        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Treeview with icon and text columns
        self.games_list = ttk.Treeview(list_frame, columns=('name', 'selector', 'status'),
                                        show='tree', yscrollcommand=scrollbar.set, selectmode='browse')
        self.games_list.pack(fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.games_list.yview)

        # Configure column widths - wider to show full icons
        self.games_list.column('#0', width=400, minwidth=350, stretch=True)

        game_btn_frame = ttk.Frame(games_frame)
        game_btn_frame.pack(fill=tk.X, pady=(10, 0))

        ttk.Button(game_btn_frame, text="Remove", command=self.remove_game).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(game_btn_frame, text="Toggle", command=self.toggle_game).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(game_btn_frame, text="Edit Scene", command=self.edit_scene).pack(side=tk.LEFT)

        # === Add Game Section ===
        add_frame = ttk.LabelFrame(tab, text="Add New Game", padding=10)
        add_frame.pack(fill=tk.X)

        name_frame = ttk.Frame(add_frame)
        name_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(name_frame, text="Name:", width=10).pack(side=tk.LEFT)
        self.name_entry = ttk.Entry(name_frame)
        self.name_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)

        selector_frame = ttk.Frame(add_frame)
        selector_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(selector_frame, text="Selector:", width=10).pack(side=tk.LEFT)
        self.selector_var = tk.StringVar()
        self.selector_combo = ttk.Combobox(selector_frame, textvariable=self.selector_var)
        self.selector_combo.pack(side=tk.LEFT, fill=tk.X, expand=True)

        scene_frame = ttk.Frame(add_frame)
        scene_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(scene_frame, text="Scene:", width=10).pack(side=tk.LEFT)
        self.scene_entry = ttk.Entry(scene_frame)
        self.scene_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Label(scene_frame, text="(optional)", font=('Segoe UI', 8), foreground='gray').pack(side=tk.LEFT, padx=(5, 0))

        add_btn_frame = ttk.Frame(add_frame)
        add_btn_frame.pack(fill=tk.X, pady=(5, 0))
        ttk.Button(add_btn_frame, text="Refresh Windows", command=self.refresh_windows).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(add_btn_frame, text="Add Game", command=self.add_game).pack(side=tk.LEFT)

        self.refresh_windows()

    def create_settings_tab(self):
        """Settings tab for auto-organization configuration."""
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="Settings")

        # Scrollable container
        canvas = tk.Canvas(tab, highlightthickness=0)
        scrollbar = ttk.Scrollbar(tab, orient="vertical", command=canvas.yview)
        scroll_frame = ttk.Frame(canvas, padding=10)

        scroll_frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas_window = canvas.create_window((0, 0), window=scroll_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        # Make the inner frame expand to canvas width
        def on_canvas_configure(event):
            canvas.itemconfig(canvas_window, width=event.width)
        canvas.bind("<Configure>", on_canvas_configure)

        # Mousewheel scrolling
        def on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        canvas.bind_all("<MouseWheel>", on_mousewheel, add='+')

        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # === OBS Executable Path ===
        obs_exe_frame = ttk.LabelFrame(scroll_frame, text="OBS Executable", padding=10)
        obs_exe_frame.pack(fill=tk.X, pady=(0, 10))

        obs_exe_path_frame = ttk.Frame(obs_exe_frame)
        obs_exe_path_frame.pack(fill=tk.X)

        self.obs_exe_var = tk.StringVar(value=self.settings.get('obs_path', ''))
        self.obs_exe_entry = ttk.Entry(obs_exe_path_frame, textvariable=self.obs_exe_var)
        self.obs_exe_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(obs_exe_path_frame, text="Browse", command=self.browse_obs_exe).pack(side=tk.LEFT, padx=(5, 0))
        ttk.Button(obs_exe_path_frame, text="Auto-Find", command=self.auto_find_obs).pack(side=tk.LEFT, padx=(5, 0))

        self.obs_exe_status = ttk.Label(obs_exe_frame, text="", font=('Segoe UI', 8))
        self.obs_exe_status.pack(anchor=tk.W, pady=(2, 0))
        self.update_obs_exe_status()

        # === OBS Detection ===
        obs_frame = ttk.LabelFrame(scroll_frame, text="OBS Recording Folder (Auto-Detected)", padding=10)
        obs_frame.pack(fill=tk.X, pady=(0, 10))

        obs_path_display = self.obs_recording_path or "(Not found - is OBS installed?)"
        self.obs_path_label = ttk.Label(obs_frame, text=obs_path_display, font=('Consolas', 9))
        self.obs_path_label.pack(anchor=tk.W)

        # === Auto-Organization ===
        org_frame = ttk.LabelFrame(scroll_frame, text="Automatic Recording Organization", padding=10)
        org_frame.pack(fill=tk.X, pady=(0, 10))

        # Enable checkbox
        self.auto_organize_var = tk.BooleanVar(value=self.settings.get('auto_organize', True))
        ttk.Checkbutton(org_frame, text="Automatically organize recordings when game closes",
                       variable=self.auto_organize_var).pack(anchor=tk.W, pady=(0, 10))

        # Start watcher on startup checkbox
        self.start_watcher_on_startup_var = tk.BooleanVar(value=self.settings.get('start_watcher_on_startup', False))
        ttk.Checkbutton(org_frame, text="Start watcher automatically when app launches",
                       variable=self.start_watcher_on_startup_var).pack(anchor=tk.W, pady=(0, 5))

        # Organized Path
        ttk.Label(org_frame, text="Organize recordings into:").pack(anchor=tk.W)
        path_frame = ttk.Frame(org_frame)
        path_frame.pack(fill=tk.X, pady=(5, 0))

        # Default to OBS path if no organized_path is set
        default_path = self.settings.get('organized_path', '') or self.obs_recording_path or ''
        self.org_path_var = tk.StringVar(value=default_path)
        self.org_path_entry = ttk.Entry(path_frame, textvariable=self.org_path_var)
        self.org_path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(path_frame, text="Browse", command=self.browse_org_path).pack(side=tk.LEFT, padx=(5, 0))

        ttk.Label(org_frame, text="Game subfolders will be created here automatically",
                 font=('Segoe UI', 8), foreground='gray').pack(anchor=tk.W, pady=(2, 0))

        # Save button
        ttk.Button(org_frame, text="Save Settings", command=self.save_settings_click).pack(anchor=tk.W, pady=(10, 0))

        # === Clip Marker Hotkey ===
        hotkey_frame = ttk.LabelFrame(scroll_frame, text="Clip Marker Hotkey", padding=10)
        hotkey_frame.pack(fill=tk.X, pady=(0, 10))

        ttk.Label(hotkey_frame, text="Press this key while recording to mark a moment for clipping:").pack(anchor=tk.W)

        hotkey_select_frame = ttk.Frame(hotkey_frame)
        hotkey_select_frame.pack(fill=tk.X, pady=(5, 0))

        self.hotkey_var = tk.StringVar(value=self.settings.get('clip_hotkey', 'F9'))
        hotkey_options = list(VK_CODES.keys())
        self.hotkey_combo = ttk.Combobox(hotkey_select_frame, textvariable=self.hotkey_var,
                                         values=hotkey_options, state='readonly', width=15)
        self.hotkey_combo.pack(side=tk.LEFT)

        ttk.Button(hotkey_select_frame, text="Save Hotkey", command=self.save_hotkey).pack(side=tk.LEFT, padx=(10, 0))

        self.hotkey_status_label = ttk.Label(hotkey_frame, text="", font=('Segoe UI', 8))
        self.hotkey_status_label.pack(anchor=tk.W, pady=(5, 0))
        self.update_hotkey_status()

        # Show notification checkbox
        self.show_marker_notification_var = tk.BooleanVar(value=self.settings.get('show_marker_notification', True))
        ttk.Checkbutton(hotkey_frame, text="Show notification when marker is added (may not work in fullscreen games)",
                       variable=self.show_marker_notification_var, command=self.save_notification_setting).pack(anchor=tk.W, pady=(5, 0))

        # Play sound checkbox
        self.play_marker_sound_var = tk.BooleanVar(value=self.settings.get('play_marker_sound', True))
        ttk.Checkbutton(hotkey_frame, text="Play sound when marker is added",
                       variable=self.play_marker_sound_var, command=self.save_notification_setting).pack(anchor=tk.W, pady=(2, 0))

        ttk.Label(hotkey_frame, text="Markers will appear as pins on the video timeline in the recordings viewer",
                 font=('Segoe UI', 8), foreground='gray').pack(anchor=tk.W, pady=(2, 0))

        # === Auto-Clip Settings ===
        autoclip_frame = ttk.LabelFrame(scroll_frame, text="Automatic Clip Creation", padding=10)
        autoclip_frame.pack(fill=tk.X, pady=(0, 10))

        ttk.Label(autoclip_frame, text="Automatically create clips from markers when a recording ends:").pack(anchor=tk.W)

        auto_clip_settings = self.settings.get('auto_clip_settings', {})
        self.auto_clip_enabled_var = tk.BooleanVar(value=auto_clip_settings.get('enabled', True))
        ttk.Checkbutton(autoclip_frame, text="Enable automatic clip creation from markers",
                       variable=self.auto_clip_enabled_var).pack(anchor=tk.W, pady=(5, 5))

        buffer_frame = ttk.Frame(autoclip_frame)
        buffer_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(buffer_frame, text="Seconds before marker:", width=22).pack(side=tk.LEFT)
        self.buffer_before_var = tk.StringVar(value=str(auto_clip_settings.get('buffer_before_seconds', 30)))
        ttk.Entry(buffer_frame, textvariable=self.buffer_before_var, width=8).pack(side=tk.LEFT)
        ttk.Label(buffer_frame, text="s", font=('Segoe UI', 8)).pack(side=tk.LEFT, padx=(2, 0))

        buffer_after_frame = ttk.Frame(autoclip_frame)
        buffer_after_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(buffer_after_frame, text="Seconds after marker:", width=22).pack(side=tk.LEFT)
        self.buffer_after_var = tk.StringVar(value=str(auto_clip_settings.get('buffer_after_seconds', 30)))
        ttk.Entry(buffer_after_frame, textvariable=self.buffer_after_var, width=8).pack(side=tk.LEFT)
        ttk.Label(buffer_after_frame, text="s", font=('Segoe UI', 8)).pack(side=tk.LEFT, padx=(2, 0))

        self.remove_markers_var = tk.BooleanVar(value=auto_clip_settings.get('remove_processed_markers', True))
        ttk.Checkbutton(autoclip_frame, text="Remove markers from list after clips are created",
                       variable=self.remove_markers_var).pack(anchor=tk.W, pady=(0, 5))

        self.delete_recording_var = tk.BooleanVar(value=auto_clip_settings.get('delete_recording_after_clips', False))
        ttk.Checkbutton(autoclip_frame, text="Delete full recording after clips are saved (keep only clips)",
                       variable=self.delete_recording_var).pack(anchor=tk.W, pady=(0, 5))

        ttk.Button(autoclip_frame, text="Save Auto-Clip Settings",
                   command=self.save_auto_clip_settings).pack(anchor=tk.W, pady=(5, 0))

        ttk.Label(autoclip_frame,
                 text="Clips are saved to the Clips subfolder of your organized recordings path",
                 font=('Segoe UI', 8), foreground='gray').pack(anchor=tk.W, pady=(2, 0))

        # === Info ===
        info_frame = ttk.LabelFrame(scroll_frame, text="How It Works", padding=10)
        info_frame.pack(fill=tk.X)

        info_text = """When a game closes and recording stops, files are organized as:

  {Destination}/{Game} - Week of {Mon DD YYYY}/
    {Game} Session {YYYY-MM-DD} #1.mp4
    {Game} Session {YYYY-MM-DD} #2.mp4

Example:
  D:/Videos/OBS-Recordings/Minecraft - Week of Jan 13 2026/
    Minecraft Session 2026-01-17 #1.mp4"""

        ttk.Label(info_frame, text=info_text, font=('Consolas', 9)).pack(anchor=tk.W)

    def create_encoding_tab(self):
        """OBS Encoding settings tab."""
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="OBS Encoding")

        # Store profile dir for save operations
        self.obs_profile_dir = None

        # === Profile Status ===
        profile_frame = ttk.Frame(tab)
        profile_frame.pack(fill=tk.X, pady=(0, 10))
        self.enc_profile_label = ttk.Label(profile_frame, text="", font=('Segoe UI', 8))
        self.enc_profile_label.pack(side=tk.LEFT)
        ttk.Button(profile_frame, text="Reload", command=self.reload_encoding_settings).pack(side=tk.RIGHT)

        # === Video Settings ===
        video_frame = ttk.LabelFrame(tab, text="Video", padding=10)
        video_frame.pack(fill=tk.X, pady=(0, 10))

        res_frame = ttk.Frame(video_frame)
        res_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(res_frame, text="Output Resolution:", width=18).pack(side=tk.LEFT)
        self.enc_res_var = tk.StringVar()
        res_values = ['1920x1080', '2560x1440', '3840x2160', '1280x720', '1600x900']
        self.enc_res_combo = ttk.Combobox(res_frame, textvariable=self.enc_res_var, values=res_values, width=15)
        self.enc_res_combo.pack(side=tk.LEFT)

        fps_frame = ttk.Frame(video_frame)
        fps_frame.pack(fill=tk.X)
        ttk.Label(fps_frame, text="FPS:", width=18).pack(side=tk.LEFT)
        self.enc_fps_var = tk.StringVar()
        self.enc_fps_combo = ttk.Combobox(fps_frame, textvariable=self.enc_fps_var,
                                          values=['30', '60', '120', '144', '240'], width=15)
        self.enc_fps_combo.pack(side=tk.LEFT)

        # === Recording Output ===
        rec_frame = ttk.LabelFrame(tab, text="Recording Output", padding=10)
        rec_frame.pack(fill=tk.X, pady=(0, 10))

        enc_frame = ttk.Frame(rec_frame)
        enc_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(enc_frame, text="Encoder:", width=18).pack(side=tk.LEFT)
        self.enc_encoder_var = tk.StringVar()
        encoder_values = [
            'obs_nvenc_hevc_tex', 'obs_nvenc_h264_tex', 'obs_nvenc_av1_tex',
            'jim_nvenc', 'jim_hevc_nvenc',
            'obs_x264', 'obs_x265',
            'amd_amf_h264', 'amd_amf_hevc', 'amd_amf_av1',
            'obs_qsv11_h264', 'obs_qsv11_hevc', 'obs_qsv11_av1',
        ]
        self.enc_encoder_combo = ttk.Combobox(enc_frame, textvariable=self.enc_encoder_var,
                                               values=encoder_values, width=25)
        self.enc_encoder_combo.pack(side=tk.LEFT)

        fmt_frame = ttk.Frame(rec_frame)
        fmt_frame.pack(fill=tk.X)
        ttk.Label(fmt_frame, text="Format:", width=18).pack(side=tk.LEFT)
        self.enc_format_var = tk.StringVar()
        self.enc_format_combo = ttk.Combobox(fmt_frame, textvariable=self.enc_format_var,
                                              values=['mkv', 'mp4', 'flv', 'ts', 'mov', 'm3u8'],
                                              state='readonly', width=15)
        self.enc_format_combo.pack(side=tk.LEFT)

        self.enc_mode_label = ttk.Label(rec_frame, text="", font=('Segoe UI', 8), foreground='gray')
        self.enc_mode_label.pack(anchor=tk.W, pady=(5, 0))

        # === Encoder Settings ===
        encoder_frame = ttk.LabelFrame(tab, text="Encoder Settings (recordEncoder.json)", padding=10)
        encoder_frame.pack(fill=tk.X, pady=(0, 10))

        rc_frame = ttk.Frame(encoder_frame)
        rc_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(rc_frame, text="Rate Control:", width=18).pack(side=tk.LEFT)
        self.enc_rc_var = tk.StringVar()
        self.enc_rc_combo = ttk.Combobox(rc_frame, textvariable=self.enc_rc_var,
                                          values=['CQP', 'CBR', 'VBR', 'CQVBR', 'Lossless'],
                                          state='readonly', width=15)
        self.enc_rc_combo.pack(side=tk.LEFT)

        br_frame = ttk.Frame(encoder_frame)
        br_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(br_frame, text="Bitrate (kbps):", width=18).pack(side=tk.LEFT)
        self.enc_bitrate_var = tk.StringVar()
        ttk.Entry(br_frame, textvariable=self.enc_bitrate_var, width=10).pack(side=tk.LEFT)

        maxbr_frame = ttk.Frame(encoder_frame)
        maxbr_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(maxbr_frame, text="Max Bitrate (kbps):", width=18).pack(side=tk.LEFT)
        self.enc_maxbr_var = tk.StringVar()
        ttk.Entry(maxbr_frame, textvariable=self.enc_maxbr_var, width=10).pack(side=tk.LEFT)

        cqp_frame = ttk.Frame(encoder_frame)
        cqp_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(cqp_frame, text="CQP Level:", width=18).pack(side=tk.LEFT)
        self.enc_cqp_var = tk.StringVar()
        ttk.Entry(cqp_frame, textvariable=self.enc_cqp_var, width=10).pack(side=tk.LEFT)

        tq_frame = ttk.Frame(encoder_frame)
        tq_frame.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(tq_frame, text="Target Quality:", width=18).pack(side=tk.LEFT)
        self.enc_tq_var = tk.StringVar()
        ttk.Entry(tq_frame, textvariable=self.enc_tq_var, width=10).pack(side=tk.LEFT)

        preset_frame = ttk.Frame(encoder_frame)
        preset_frame.pack(fill=tk.X)
        ttk.Label(preset_frame, text="Preset:", width=18).pack(side=tk.LEFT)
        self.enc_preset_var = tk.StringVar()
        self.enc_preset_combo = ttk.Combobox(preset_frame, textvariable=self.enc_preset_var,
                                              values=['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], width=15)
        self.enc_preset_combo.pack(side=tk.LEFT)
        ttk.Label(preset_frame, text="(p1=fastest, p7=best quality)", font=('Segoe UI', 8),
                 foreground='gray').pack(side=tk.LEFT, padx=(5, 0))

        # === Save Button ===
        save_frame = ttk.Frame(tab)
        save_frame.pack(fill=tk.X, pady=(5, 0))
        ttk.Button(save_frame, text="Save Encoding Settings", command=self.save_encoding_settings).pack(side=tk.LEFT)

        # Load initial values
        self.reload_encoding_settings()

    def reload_encoding_settings(self):
        """Load encoding settings from OBS profile into the UI."""
        settings, profile_dir = read_obs_encoding_settings()
        if not settings:
            self.enc_profile_label.config(text="OBS profile not found", foreground='red')
            return

        self.obs_profile_dir = profile_dir
        profile_name = os.path.basename(profile_dir) if profile_dir else "Unknown"
        self.enc_profile_label.config(text=f"Profile: {profile_name}", foreground='green')

        res = f"{settings.get('output_cx', '1920')}x{settings.get('output_cy', '1080')}"
        self.enc_res_var.set(res)
        self.enc_fps_var.set(settings.get('fps_common', '60'))

        self.enc_encoder_var.set(settings.get('rec_encoder', ''))
        self.enc_format_var.set(settings.get('rec_format', 'mkv'))
        mode = settings.get('output_mode', 'Simple')
        self.enc_mode_label.config(text=f"Output mode: {mode}")

        self.enc_rc_var.set(settings.get('rate_control', ''))
        self.enc_bitrate_var.set(settings.get('bitrate', ''))
        self.enc_maxbr_var.set(settings.get('max_bitrate', ''))
        self.enc_cqp_var.set(settings.get('cqp', ''))
        self.enc_tq_var.set(settings.get('target_quality', ''))
        self.enc_preset_var.set(settings.get('preset', ''))

    def save_encoding_settings(self):
        """Save encoding settings back to OBS profile files."""
        if not self.obs_profile_dir:
            messagebox.showwarning("Error", "No OBS profile found.")
            return

        if is_obs_running():
            if not messagebox.askyesno("OBS Is Running",
                    "OBS is currently running. Changes may be overwritten when OBS closes.\n\n"
                    "Save anyway?"):
                return

        # Parse resolution
        res = self.enc_res_var.get()
        if 'x' in res:
            cx, cy = res.split('x', 1)
        else:
            messagebox.showwarning("Invalid", "Resolution must be in WIDTHxHEIGHT format (e.g. 1920x1080)")
            return

        settings = {
            'output_cx': cx.strip(),
            'output_cy': cy.strip(),
            'fps_common': self.enc_fps_var.get(),
            'rec_encoder': self.enc_encoder_var.get(),
            'rec_format': self.enc_format_var.get(),
            'rate_control': self.enc_rc_var.get(),
            'bitrate': self.enc_bitrate_var.get(),
            'max_bitrate': self.enc_maxbr_var.get(),
            'cqp': self.enc_cqp_var.get(),
            'target_quality': self.enc_tq_var.get(),
            'preset': self.enc_preset_var.get(),
        }

        try:
            save_obs_encoding_settings(settings, self.obs_profile_dir)
            messagebox.showinfo("Saved", "OBS encoding settings saved successfully.")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to save settings:\n{e}")

    def browse_org_path(self):
        path = filedialog.askdirectory(title="Select Organized Recordings Folder")
        if path:
            self.org_path_var.set(path)

    def save_settings_click(self):
        organized_path = self.org_path_var.get().strip()
        auto_organize = self.auto_organize_var.get()

        # Validate path exists
        if organized_path and not os.path.exists(organized_path):
            if messagebox.askyesno("Create Folder?", f"Folder does not exist:\n{organized_path}\n\nCreate it?"):
                try:
                    os.makedirs(organized_path, exist_ok=True)
                except Exception as e:
                    messagebox.showerror("Error", f"Could not create folder:\n{e}")
                    return
            else:
                return

        self.settings['organized_path'] = organized_path
        self.settings['auto_organize'] = auto_organize
        self.settings['start_watcher_on_startup'] = self.start_watcher_on_startup_var.get()

        if save_settings(self.settings):
            messagebox.showinfo("Settings", f"Settings saved!\n\nOrganized path: {organized_path or '(not set)'}\nAuto-organize: {'Enabled' if auto_organize else 'Disabled'}")
        else:
            messagebox.showerror("Error", "Failed to save settings. Check file permissions.")

    def refresh_all(self):
        self.refresh_status()
        self.refresh_games()

    def refresh_status(self):
        running, pid = is_watcher_running()
        state = get_watcher_state()

        if running:
            self.watcher_status.config(text=f"Watcher: Running (PID: {pid})", foreground='green')
            self.start_btn.config(state=tk.DISABLED)
            self.stop_btn.config(state=tk.NORMAL)
        else:
            self.watcher_status.config(text="Watcher: Stopped", foreground='red')
            self.start_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.DISABLED)

        if state:
            if state.startswith("RECORDING"):
                parts = state.split("|")
                game = parts[1] if len(parts) > 1 else "Unknown"
                self.state_label.config(text=f"State: Recording {game}", foreground='red')
            elif state == "IDLE":
                self.state_label.config(text="State: Idle", foreground='gray')
            else:
                self.state_label.config(text=f"State: {state}", foreground='gray')
        else:
            self.state_label.config(text="State: No state file", foreground='gray')

    def load_icon(self, icon_path, size=(24, 24)):
        """Load and resize an icon, returning a PhotoImage."""
        if not icon_path or not os.path.exists(icon_path):
            return None
        try:
            img = Image.open(icon_path)
            img = img.resize(size, Image.Resampling.LANCZOS)
            return ImageTk.PhotoImage(img)
        except Exception as e:
            print(f"Error loading icon {icon_path}: {e}")
            return None

    def refresh_games(self):
        # Clear existing items
        for item in self.games_list.get_children():
            self.games_list.delete(item)

        config = load_config()
        self.game_icons.clear()  # Clear old icon references

        for i, game in enumerate(config.get("games", [])):
            status = "✓" if game.get("enabled", True) else "✗"
            scene = game.get("scene", "")
            scene_info = f" [Scene: {scene}]" if scene else ""
            display_text = f"[{status}] {game['name']} ({game['selector']}){scene_info}"

            # Load icon if available
            icon_path = game.get("icon_path", "")
            icon = self.load_icon(icon_path)

            if icon:
                self.game_icons[i] = icon  # Keep reference to prevent garbage collection
                self.games_list.insert('', 'end', iid=str(i), text=display_text, image=icon)
            else:
                self.games_list.insert('', 'end', iid=str(i), text=display_text)

    def refresh_windows(self):
        windows = get_visible_windows()
        processes = get_process_list()

        system_procs = ['explorer.exe', 'searchhost.exe', 'textinputhost.exe',
                       'shellexperiencehost.exe', 'applicationframehost.exe']

        window_list = []
        for w in windows:
            proc = processes.get(w['pid'], '').lower()
            if proc not in system_procs and w['title'].strip():
                window_list.append(w['title'])

        self.selector_combo['values'] = window_list
        if window_list:
            self.selector_combo.set(window_list[0])

    def start_watcher(self):
        running, _ = is_watcher_running()
        if running:
            return

        watcher_path = os.path.join(SCRIPT_DIR, "game_watcher.pyw")
        subprocess.Popen(["pythonw", watcher_path], creationflags=subprocess.CREATE_NO_WINDOW)
        time.sleep(0.5)
        self.refresh_status()

    def stop_watcher(self):
        running, pid = is_watcher_running()
        if not running:
            return

        try:
            kernel32.TerminateProcess(kernel32.OpenProcess(1, False, pid), 0)
            if os.path.exists(PID_FILE):
                os.remove(PID_FILE)
            if os.path.exists(STATE_FILE):
                os.remove(STATE_FILE)
        except:
            pass

        self.refresh_status()

    def add_game(self):
        name = self.name_entry.get().strip()
        selector = self.selector_var.get().strip()
        scene = self.scene_entry.get().strip()

        if not name or not selector:
            messagebox.showwarning("Warning", "Please enter name and selector")
            return

        config = load_config()

        for game in config.get("games", []):
            if game.get("selector", "").lower() == selector.lower():
                messagebox.showwarning("Warning", "Game with this selector already exists")
                return

        config["games"].append({
            "name": name,
            "selector": selector,
            "icon_path": "",
            "scene": scene,
            "enabled": True
        })
        save_config(config)

        self.name_entry.delete(0, tk.END)
        self.selector_var.set("")
        self.scene_entry.delete(0, tk.END)
        self.refresh_games()
        messagebox.showinfo("Success", f"Added: {name}")

    def remove_game(self):
        selection = self.games_list.selection()
        if not selection:
            return

        index = int(selection[0])
        config = load_config()
        games = config.get("games", [])

        if 0 <= index < len(games):
            game = games[index]
            if messagebox.askyesno("Confirm", f"Remove '{game['name']}'?"):
                games.pop(index)
                save_config(config)
                self.refresh_games()

    def toggle_game(self):
        selection = self.games_list.selection()
        if not selection:
            return

        index = int(selection[0])
        config = load_config()
        games = config.get("games", [])

        if 0 <= index < len(games):
            games[index]['enabled'] = not games[index].get('enabled', True)
            save_config(config)
            self.refresh_games()

    def edit_scene(self):
        selection = self.games_list.selection()
        if not selection:
            messagebox.showwarning("Warning", "Please select a game first")
            return

        index = int(selection[0])
        config = load_config()
        games = config.get("games", [])

        if 0 <= index < len(games):
            game = games[index]
            current_scene = game.get('scene', '')

            # Create a simple dialog to edit the scene
            dialog = tk.Toplevel(self.root)
            dialog.title(f"Edit Scene - {game['name']}")
            dialog.geometry("400x150")
            dialog.resizable(False, False)
            dialog.transient(self.root)
            dialog.grab_set()

            # Center the dialog
            dialog.update_idletasks()
            x = self.root.winfo_x() + (self.root.winfo_width() - 400) // 2
            y = self.root.winfo_y() + (self.root.winfo_height() - 150) // 2
            dialog.geometry(f"+{x}+{y}")

            frame = ttk.Frame(dialog, padding=15)
            frame.pack(fill=tk.BOTH, expand=True)

            ttk.Label(frame, text=f"OBS Scene for {game['name']}:").pack(anchor=tk.W)
            scene_var = tk.StringVar(value=current_scene)
            scene_entry = ttk.Entry(frame, textvariable=scene_var, width=50)
            scene_entry.pack(fill=tk.X, pady=(5, 5))
            scene_entry.focus_set()
            scene_entry.select_range(0, tk.END)

            ttk.Label(frame, text="Leave empty to use default scene", font=('Segoe UI', 8), foreground='gray').pack(anchor=tk.W)

            def save_scene():
                games[index]['scene'] = scene_var.get().strip()
                save_config(config)
                self.refresh_games()
                dialog.destroy()

            def on_enter(event):
                save_scene()

            scene_entry.bind('<Return>', on_enter)

            btn_frame = ttk.Frame(frame)
            btn_frame.pack(fill=tk.X, pady=(10, 0))
            ttk.Button(btn_frame, text="Save", command=save_scene).pack(side=tk.RIGHT, padx=(5, 0))
            ttk.Button(btn_frame, text="Cancel", command=dialog.destroy).pack(side=tk.RIGHT)

    def open_recordings_viewer(self):
        """Launch the recordings viewer webapp."""
        viewer_path = os.path.join(SCRIPT_DIR, "recordings_viewer.pyw")
        if os.path.exists(viewer_path):
            # Kill existing viewer if running
            if self.viewer_process and self.viewer_process.poll() is None:
                self.viewer_process.terminate()
            self.viewer_process = subprocess.Popen(
                ["pythonw", viewer_path],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        else:
            messagebox.showerror("Error", "recordings_viewer.pyw not found")

    def browse_obs_exe(self):
        """Browse for the OBS executable."""
        path = filedialog.askopenfilename(
            title="Select OBS Executable",
            filetypes=[("Executable", "*.exe"), ("All files", "*.*")],
            initialdir=os.environ.get('ProgramFiles', 'C:\\')
        )
        if path:
            self.obs_exe_var.set(path)
            self.settings['obs_path'] = path
            save_settings(self.settings)
            self.update_obs_exe_status()

    def auto_find_obs(self):
        """Automatically find the OBS executable."""
        found = find_obs_executable()
        if found:
            self.obs_exe_var.set(found)
            self.settings['obs_path'] = found
            save_settings(self.settings)
            self.update_obs_exe_status()
            messagebox.showinfo("OBS Found", f"Found OBS at:\n{found}")
        else:
            messagebox.showwarning("Not Found", "Could not find OBS automatically.\nUse Browse to locate it manually.")

    def update_obs_exe_status(self):
        """Update the OBS executable status label."""
        path = self.obs_exe_var.get()
        if path and os.path.isfile(path):
            self.obs_exe_status.config(text=f"Found: {path}", foreground='green')
        elif path:
            self.obs_exe_status.config(text="Path not valid - file does not exist", foreground='red')
        else:
            self.obs_exe_status.config(text="Not configured - use Browse or Auto-Find", foreground='gray')

    def open_obs(self):
        """Launch OBS from the configured path."""
        path = self.settings.get('obs_path', '')
        if not path or not os.path.isfile(path):
            # Try auto-finding before giving up
            found = find_obs_executable()
            if found:
                path = found
                self.obs_exe_var.set(found)
                self.settings['obs_path'] = found
                save_settings(self.settings)
                self.update_obs_exe_status()
            else:
                messagebox.showwarning("OBS Not Found",
                    "OBS path is not configured.\nGo to Settings tab to set the OBS executable path.")
                return
        try:
            obs_dir = os.path.dirname(path)
            subprocess.Popen([path], cwd=obs_dir, creationflags=subprocess.DETACHED_PROCESS)
        except Exception as e:
            messagebox.showerror("Error", f"Failed to launch OBS:\n{e}")

    def save_hotkey(self):
        """Save the selected hotkey to settings."""
        hotkey = self.hotkey_var.get()
        self.settings['clip_hotkey'] = hotkey
        if save_settings(self.settings):
            self.update_hotkey_status()
            # Restart hotkey listener with new key
            self.stop_hotkey_listener()
            self.start_hotkey_listener()
            messagebox.showinfo("Hotkey", f"Clip marker hotkey set to {hotkey}")
        else:
            messagebox.showerror("Error", "Failed to save hotkey setting")

    def save_auto_clip_settings(self):
        """Save auto-clip settings."""
        try:
            buffer_before = int(self.buffer_before_var.get())
            buffer_after = int(self.buffer_after_var.get())

            if buffer_before < 0 or buffer_after < 0:
                messagebox.showwarning("Warning", "Buffer values must be non-negative")
                return

            if buffer_before == 0 and buffer_after == 0:
                messagebox.showwarning("Warning", "Both buffer values are 0. Clips would have zero duration.")
                return
        except ValueError:
            messagebox.showwarning("Warning", "Buffer values must be whole numbers")
            return

        self.settings['auto_clip_settings'] = {
            'enabled': self.auto_clip_enabled_var.get(),
            'buffer_before_seconds': buffer_before,
            'buffer_after_seconds': buffer_after,
            'remove_processed_markers': self.remove_markers_var.get(),
            'delete_recording_after_clips': self.delete_recording_var.get()
        }

        if save_settings(self.settings):
            messagebox.showinfo("Auto-Clip Settings",
                f"Settings saved!\n\n"
                f"Auto-clip: {'Enabled' if self.auto_clip_enabled_var.get() else 'Disabled'}\n"
                f"Buffer: {buffer_before}s before, {buffer_after}s after\n"
                f"Remove markers: {'Yes' if self.remove_markers_var.get() else 'No'}\n"
                f"Delete recording: {'Yes' if self.delete_recording_var.get() else 'No'}")
        else:
            messagebox.showerror("Error", "Failed to save settings")

    def save_notification_setting(self):
        """Save the notification preference."""
        self.settings['show_marker_notification'] = self.show_marker_notification_var.get()
        self.settings['play_marker_sound'] = self.play_marker_sound_var.get()
        save_settings(self.settings)

    def update_hotkey_status(self):
        """Update the hotkey status label."""
        hotkey = self.settings.get('clip_hotkey', 'F9')
        if self.hotkey_listener_running:
            self.hotkey_status_label.config(
                text=f"Listening for {hotkey} (active while watcher is running)",
                foreground='green'
            )
        else:
            self.hotkey_status_label.config(
                text=f"Hotkey: {hotkey} (will activate when watcher starts)",
                foreground='gray'
            )

    def start_hotkey_listener(self):
        """Start the global hotkey listener in a background thread."""
        if self.hotkey_listener_running:
            return

        hotkey = self.settings.get('clip_hotkey', 'F9')
        vk_code = VK_CODES.get(hotkey)
        if not vk_code:
            return

        self.hotkey_listener_running = True

        def listener_thread():
            # Use GetAsyncKeyState for simple polling
            GetAsyncKeyState = ctypes.windll.user32.GetAsyncKeyState
            key_was_pressed = False

            while self.hotkey_listener_running:
                # Check if key is pressed (high bit set means currently pressed)
                state = GetAsyncKeyState(vk_code)
                key_pressed = (state & 0x8000) != 0

                if key_pressed and not key_was_pressed:
                    # Key just pressed - check if we're recording
                    watcher_state = get_watcher_state()
                    if watcher_state and watcher_state.startswith("RECORDING"):
                        parts = watcher_state.split("|")
                        game_name = parts[1] if len(parts) > 1 else "Unknown"
                        add_clip_marker(game_name)
                        
                        # Play sound if enabled
                        if self.settings.get('play_marker_sound', True):
                            try:
                                # Play a subtle beep sound (async so it doesn't block)
                                winsound.MessageBeep(winsound.MB_OK)
                            except:
                                pass
                        
                        # Show brief notification if enabled (thread-safe)
                        if self.settings.get('show_marker_notification', True):
                            self.root.after(0, lambda g=game_name: self.show_marker_toast(g))

                key_was_pressed = key_pressed
                time.sleep(0.05)  # 50ms polling interval

        self.hotkey_thread = threading.Thread(target=listener_thread, daemon=True)
        self.hotkey_thread.start()
        self.root.after(100, self.update_hotkey_status)

    def stop_hotkey_listener(self):
        """Stop the hotkey listener."""
        self.hotkey_listener_running = False
        self.root.after(100, self.update_hotkey_status)

    def show_marker_toast(self, game_name):
        """Show a brief toast notification that a marker was added."""
        # Create a temporary toplevel window as toast
        toast = tk.Toplevel(self.root)
        toast.overrideredirect(True)
        
        # Position at bottom-right of screen
        screen_width = toast.winfo_screenwidth()
        screen_height = toast.winfo_screenheight()
        toast.geometry(f"+{screen_width - 300}+{screen_height - 100}")

        frame = ttk.Frame(toast, padding=10)
        frame.pack()
        ttk.Label(frame, text=f"✓ Clip marker added for {game_name}",
                 font=('Segoe UI', 10, 'bold')).pack()

        # Update to ensure window is created
        toast.update_idletasks()
        
        # Use Windows API to set the window as topmost and prevent focus stealing
        hwnd = ctypes.windll.user32.FindWindowW(None, toast.winfo_toplevel().title() if toast.winfo_toplevel().title() else None)
        if not hwnd:
            # Try getting hwnd from the window
            hwnd = toast.winfo_id()
        
        # HWND_TOPMOST = -1, SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040
        HWND_TOPMOST = -1
        SWP_NOACTIVATE = 0x0010
        SWP_SHOWWINDOW = 0x0040
        ctypes.windll.user32.SetWindowPos(
            hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | 0x0001 | 0x0002  # SWP_NOMOVE | SWP_NOSIZE
        )
        
        # Make it semi-transparent and disable interaction
        toast.attributes('-alpha', 0.9)
        toast.attributes('-disabled', True)

        # Auto-close after 1.5 seconds
        toast.after(1500, toast.destroy)

    def on_close(self):
        """Clean up subprocesses when closing the manager."""
        # Stop hotkey listener
        self.stop_hotkey_listener()
        # Terminate recordings viewer if running
        if self.viewer_process and self.viewer_process.poll() is None:
            self.viewer_process.terminate()
        self.root.destroy()

    def auto_refresh(self):
        self.refresh_status()
        self.root.after(2000, self.auto_refresh)


def main():
    root = tk.Tk()
    app = GameManagerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
