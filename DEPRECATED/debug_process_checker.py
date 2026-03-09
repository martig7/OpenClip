"""
Game Manager & Debug Tool
Manage games and control the background watcher.
"""

import ctypes
import ctypes.wintypes as wintypes
import json
import os
import sys
import time
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "games_config.json")
STATE_FILE = os.path.join(SCRIPT_DIR, "game_state")
PID_FILE = os.path.join(SCRIPT_DIR, "watcher.pid")
ICONS_DIR = os.path.join(SCRIPT_DIR, "icons")

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
                processes[entry.th32ProcessID] = entry.szExeFile.lower()
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
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if handle:
                kernel32.CloseHandle(handle)
                return True, pid
        except:
            pass
    return False, None


def start_watcher():
    running, pid = is_watcher_running()
    if running:
        print(f"  Watcher already running (PID: {pid})")
        return

    watcher_path = os.path.join(SCRIPT_DIR, "game_watcher.pyw")
    subprocess.Popen(
        ["pythonw", watcher_path],
        creationflags=subprocess.CREATE_NO_WINDOW
    )
    time.sleep(0.5)

    running, pid = is_watcher_running()
    if running:
        print(f"  Watcher started (PID: {pid})")
    else:
        print("  Failed to start watcher")


def stop_watcher():
    running, pid = is_watcher_running()
    if not running:
        print("  Watcher not running")
        return

    try:
        kernel32.TerminateProcess(
            kernel32.OpenProcess(1, False, pid), 0
        )
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
        if os.path.exists(STATE_FILE):
            os.remove(STATE_FILE)
        print(f"  Watcher stopped (PID: {pid})")
    except Exception as e:
        print(f"  Error stopping watcher: {e}")


def get_watcher_state():
    try:
        with open(STATE_FILE, 'r') as f:
            return f.read().strip()
    except:
        return None


def list_windows():
    print("\n=== VISIBLE WINDOWS ===\n")
    windows = get_visible_windows()
    procs = get_process_list()

    for i, w in enumerate(windows, 1):
        proc = procs.get(w['pid'], 'unknown')
        print(f"  {i:3}. [{proc}] {w['title']}")

    print(f"\n  Total: {len(windows)}")
    return windows


def search_windows(term):
    print(f"\n=== SEARCH: '{term}' ===\n")
    windows = get_visible_windows()
    procs = get_process_list()
    term_lower = term.lower()

    matches = []
    for w in windows:
        proc = procs.get(w['pid'], '')
        if term_lower in w['title'].lower() or term_lower in proc:
            matches.append((w, proc))

    if matches:
        for w, proc in matches:
            print(f"  [{proc}] {w['title']}")
    else:
        print("  No matches.")

    return matches


def list_games():
    config = load_config()
    print("\n=== CONFIGURED GAMES ===\n")

    games = config.get("games", [])
    if not games:
        print("  No games configured.")
        return

    for i, g in enumerate(games, 1):
        status = "ON " if g.get("enabled", True) else "OFF"
        print(f"  {i}. [{status}] {g['name']}")
        print(f"      Selector: {g['selector']}")


def add_game_interactive():
    print("\n=== ADD GAME ===\n")
    print("  Make sure game is running, then press Enter...")
    input()

    term = input("  Search term (window title): ").strip()
    if not term:
        return

    search_windows(term)

    name = input("\n  Display name: ").strip()
    if not name:
        return

    selector = input(f"  Selector (Enter for '{term}'): ").strip() or term

    config = load_config()
    for g in config.get("games", []):
        if g.get("selector", "").lower() == selector.lower():
            print("  Already exists!")
            return

    config["games"].append({
        "name": name,
        "selector": selector,
        "icon_path": "",
        "enabled": True
    })
    save_config(config)
    print(f"\n  Added: {name}")


def remove_game_interactive():
    config = load_config()
    list_games()

    games = config.get("games", [])
    if not games:
        return

    try:
        choice = int(input("\n  Number to remove (0=cancel): "))
        if choice == 0:
            return
        if 1 <= choice <= len(games):
            g = games.pop(choice - 1)
            save_config(config)
            print(f"  Removed: {g['name']}")
    except:
        pass


def toggle_game_interactive():
    config = load_config()
    list_games()

    games = config.get("games", [])
    if not games:
        return

    try:
        choice = int(input("\n  Number to toggle (0=cancel): "))
        if choice == 0:
            return
        if 1 <= choice <= len(games):
            g = games[choice - 1]
            g['enabled'] = not g.get('enabled', True)
            save_config(config)
            status = "enabled" if g['enabled'] else "disabled"
            print(f"  {g['name']}: {status}")
    except:
        pass


def show_status():
    running, pid = is_watcher_running()
    state = get_watcher_state()
    config = load_config()
    enabled = sum(1 for g in config.get("games", []) if g.get("enabled", True))
    total = len(config.get("games", []))

    print(f"\n  Watcher: {'RUNNING' if running else 'STOPPED'}", end="")
    if pid:
        print(f" (PID: {pid})")
    else:
        print()

    print(f"  State: {state or 'N/A'}")
    print(f"  Games: {enabled}/{total} enabled")


def monitor_state(interval=1):
    print("\n=== MONITORING STATE ===")
    print(f"  Interval: {interval}s")
    print("  Press Ctrl+C to stop\n")

    last = ""
    try:
        while True:
            state = get_watcher_state()
            ts = time.strftime("%H:%M:%S")

            if state != last:
                print(f"  [{ts}] {state or 'NO STATE'}")
                last = state

            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n  Stopped.")


def main_menu():
    while True:
        show_status()

        print("\n" + "=" * 50)
        print("  GAME AUTO-RECORDER - MANAGER")
        print("=" * 50)

        print("\n  --- Watcher ---")
        print("  1. Start watcher")
        print("  2. Stop watcher")
        print("  3. Monitor state")

        print("\n  --- Games ---")
        print("  4. List games")
        print("  5. Add game")
        print("  6. Remove game")
        print("  7. Toggle game")

        print("\n  --- Debug ---")
        print("  8. List windows")
        print("  9. Search windows")

        print("\n  0. Exit")

        choice = input("\n  Choice: ").strip()

        if choice == "1":
            start_watcher()
        elif choice == "2":
            stop_watcher()
        elif choice == "3":
            monitor_state()
        elif choice == "4":
            list_games()
        elif choice == "5":
            add_game_interactive()
        elif choice == "6":
            remove_game_interactive()
        elif choice == "7":
            toggle_game_interactive()
        elif choice == "8":
            list_windows()
        elif choice == "9":
            term = input("  Search: ").strip()
            if term:
                search_windows(term)
        elif choice == "0":
            print("\n  Goodbye!")
            break


if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "--start":
            start_watcher()
        elif cmd == "--stop":
            stop_watcher()
        elif cmd == "--status":
            show_status()
        elif cmd == "--list":
            list_windows()
        elif cmd == "--games":
            list_games()
        elif cmd == "--add" and len(sys.argv) > 3:
            config = load_config()
            config["games"].append({
                "name": sys.argv[2],
                "selector": sys.argv[3],
                "icon_path": "",
                "enabled": True
            })
            save_config(config)
            print(f"Added: {sys.argv[2]}")
        else:
            print("Usage:")
            print("  python debug_process_checker.py           # Interactive")
            print("  python debug_process_checker.py --start   # Start watcher")
            print("  python debug_process_checker.py --stop    # Stop watcher")
            print("  python debug_process_checker.py --status  # Show status")
            print("  python debug_process_checker.py --list    # List windows")
            print("  python debug_process_checker.py --games   # List games")
            print("  python debug_process_checker.py --add <name> <selector>")
    else:
        main_menu()
