@echo off
cd /d "%~dp0"
if exist "artifacts\CPU-RustT.exe" (
    start "CPU-RustT" "artifacts\CPU-RustT.exe"
) else (
    echo Compilare prima l'app con scripts\build.ps1.
    pause
)
