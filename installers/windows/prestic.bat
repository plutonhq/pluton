@echo off
rem Pluton wrapper for restic: uses the Pluton rclone binary and configuration.
setlocal
if not defined PLUTON_DATA_DIR set "PLUTON_DATA_DIR=%ProgramData%\Pluton"
set "PATH=%~dp0binaries\win32-x64;%PATH%"
set "RCLONE_CONFIG=%PLUTON_DATA_DIR%\config\rclone.conf"
"%~dp0binaries\win32-x64\restic.exe" %*
