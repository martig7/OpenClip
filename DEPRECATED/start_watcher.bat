@echo off
echo Starting Game Watcher...
start "" pythonw "%~dp0game_watcher.pyw"
echo Watcher started in background.
echo.
echo To stop: run stop_watcher.bat or use Task Manager
pause
