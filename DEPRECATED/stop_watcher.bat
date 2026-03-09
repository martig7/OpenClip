@echo off
echo Stopping Game Watcher...
if exist "%~dp0watcher.pid" (
    set /p PID=<"%~dp0watcher.pid"
    taskkill /PID %PID% /F >nul 2>&1
    del "%~dp0watcher.pid" >nul 2>&1
    del "%~dp0game_state" >nul 2>&1
    echo Watcher stopped.
) else (
    echo Watcher not running.
)
pause
