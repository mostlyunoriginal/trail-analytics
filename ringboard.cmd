@echo off
rem Workspace-root launcher shim - installed at <repo>\ringboard.cmd.
rem The real launcher (project title, error pause) lives in tools\ringboard\ringboard.cmd.
call "%~dp0tools\ringboard\ringboard.cmd" %*
