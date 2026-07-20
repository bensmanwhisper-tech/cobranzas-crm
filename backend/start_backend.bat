@echo off
title Cobranzas XD - Backend

set DB_PATH=C:\Cobranzas\App\cobranzas.db
set STORAGE_DIR=C:\Cobranzas\Archivos

if not exist "C:\Cobranzas\App\" mkdir "C:\Cobranzas\App\"
if not exist "C:\Cobranzas\Archivos\" mkdir "C:\Cobranzas\Archivos\"

set PYTHON=
where py >nul 2>&1 && set PYTHON=py
if "%PYTHON%"=="" where python >nul 2>&1 && set PYTHON=python
if "%PYTHON%"=="" where python3 >nul 2>&1 && set PYTHON=python3

if "%PYTHON%"=="" (
    echo.
    echo  ERROR: No se encontro Python en tu sistema.
    echo  Descargalo desde https://www.python.org/downloads/
    echo  Asegurate de marcar "Add Python to PATH" al instalar.
    echo.
    pause
    exit /b 1
)

echo  Python encontrado: %PYTHON%
echo  Instalando dependencias...
%PYTHON% -m pip install -r requirements.txt --quiet

echo.
echo  =============================================
echo   COBRANZAS XD - Backend local iniciando...
echo   DB:       %DB_PATH%
echo   Archivos: %STORAGE_DIR%
echo   API:      http://localhost:8001/api/
echo  =============================================
echo.

%PYTHON% -m uvicorn server:app --host 0.0.0.0 --port 8001 --reload

pause