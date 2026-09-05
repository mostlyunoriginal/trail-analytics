@echo off
rem Set at install: project name + port, so the console window says which board this is.
title Ringboard - trail-analytics (8350)
py "%~dp0ringboard.py" %*
if errorlevel 1 pause
