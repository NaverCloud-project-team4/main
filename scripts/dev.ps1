# Windows PowerShell version of scripts/dev.sh (PowerShell 5.1+).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Python = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) {
  [Console]::Error.WriteLine('먼저 README의 의존성 설치 단계를 실행해주세요.')
  exit 1
}
$Backend = Join-Path $Root 'backend'
if ($env:PYTHONPATH) { $env:PYTHONPATH = "$Backend;$env:PYTHONPATH" } else { $env:PYTHONPATH = $Backend }
# Korean Windows defaults to cp949; data files are UTF-8.
$env:PYTHONUTF8 = '1'

$Node = $env:NODE_EXECUTABLE
if (-not $Node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}
$Vite = Join-Path $Root 'frontend\node_modules\vite\bin\vite.js'
if (-not $Node -or -not (Test-Path $Vite)) {
  [Console]::Error.WriteLine('Node.js와 프론트 의존성을 먼저 설치해주세요.')
  exit 1
}

& $Python -m app.cli init --demo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$procs = @()
try {
  $procs += Start-Process -FilePath $Python -NoNewWindow -PassThru -WorkingDirectory $Root `
    -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--workers', '2', '--no-access-log'
  $procs += Start-Process -FilePath $Python -NoNewWindow -PassThru -WorkingDirectory $Root `
    -ArgumentList '-m', 'app.worker', '--aggregate'
  $procs += Start-Process -FilePath $Node -NoNewWindow -PassThru -WorkingDirectory (Join-Path $Root 'frontend') `
    -ArgumentList 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'

  Write-Host "`n화면: http://127.0.0.1:5173`nAPI: http://127.0.0.1:8000/docs`nCtrl+C로 종료합니다.`n"

  # Exit if any child fails; finally stops the remaining processes.
  while ($true) {
    foreach ($p in $procs) {
      if ($p.HasExited) {
        [Console]::Error.WriteLine('개발 프로세스 하나가 종료되어 나머지도 정리합니다.')
        exit 1
      }
    }
    Start-Sleep -Seconds 1
  }
}
finally {
  # taskkill /T also stops uvicorn's worker subprocesses.
  foreach ($p in $procs) {
    if (-not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
  }
}
