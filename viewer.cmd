@echo off
rem Serve the repo so the viewer can fetch data/<trail>/derived/viewer assets.
title trail-analytics viewer (8351)
start "" http://127.0.0.1:8351/viewer/
py -m http.server 8351 --directory "%~dp0" --bind 127.0.0.1
