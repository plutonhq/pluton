@echo off
rem Pluton wrapper for rclone: uses the Pluton rclone configuration.
setlocal
if not defined PLUTON_DATA_DIR set "PLUTON_DATA_DIR=%ProgramData%\Pluton"
"%~dp0binaries\win32-x64\rclone.exe" --config "%PLUTON_DATA_DIR%\config\rclone.conf" %*
