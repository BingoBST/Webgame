@echo off
rem Fallback launcher: serves the game on http://localhost:8765/ (requires Python 3)
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py
start "" http://localhost:8765/
%PY% tools\serve.py 8765
