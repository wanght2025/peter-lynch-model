@echo off
setlocal
set "MODEL_NODE_BIN=C:\Users\Austin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "PATH=%MODEL_NODE_BIN%;%PATH%"
cd /d "%~dp0"
echo.
echo  彼得林奇投资模型正在启动...
echo  启动完成后，请打开 http://localhost:3000/
echo  关闭此窗口即可停止本地程序。
echo.
call node_modules\.bin\vinext.CMD dev
pause
