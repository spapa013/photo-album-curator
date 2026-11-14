@echo off
setlocal
cd /d "%~dp0"

where py.exe >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
        py -3 launch.py %*
        goto :done
    )
)

for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%~fD\python.exe" (
        "%%~fD\python.exe" -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
        if not errorlevel 1 (
            "%%~fD\python.exe" launch.py %*
            goto :done
        )
    )
)

where python.exe >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
        python launch.py %*
        goto :done
    )
)

echo Photo Album Curator needs Python 3.10 or newer.
pause
exit /b 1

:done
if errorlevel 1 pause
