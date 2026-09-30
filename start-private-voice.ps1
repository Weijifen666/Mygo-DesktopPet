param()
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$configPath = Join-Path $projectRoot 'tts/cosy-production.json'
$manifestPath = Join-Path $projectRoot 'tts/widget-bank/manifest.json'
$pythonExe = Join-Path $projectRoot 'runtime/cosy-venv310/Scripts/python.exe'
$electronExe = Join-Path $projectRoot 'node_modules/electron/dist/electron.exe'
$ownedService = $null

if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $manifestPath)) {
    throw 'Local private voices are missing. Run start-source-only.cmd for the text desktop pet.'
}
if (-not (Test-Path -LiteralPath $pythonExe) -or -not (Test-Path -LiteralPath $electronExe)) {
    throw 'Install the local CosyVoice runtime and npm dependencies before starting voices.'
}
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.status -ne 'completed' -or $manifest.voice_revision -ne $config.revision -or
        @($manifest.rows.PSObject.Properties).Count -ne 836) {
    throw 'The fixed voice bank is incomplete or uses another model revision.'
}
& $pythonExe (Join-Path $projectRoot 'tts/verify_voice_bank.py')
if ($LASTEXITCODE -ne 0) { throw 'The local private voice bank failed validation.' }

try {
    $health = $null
    try { $health = Invoke-RestMethod 'http://127.0.0.1:9881/health' -TimeoutSec 3 } catch {}
    if ($health) {
        if (-not $health.backend_ready -or $health.revision -ne $config.revision -or $health.project_root -ne $projectRoot) {
            throw 'Port 9881 is occupied by a different voice service.'
        }
    } else {
        $env:HF_HOME = Join-Path $projectRoot 'runtime/hf-cache'
        $ownedService = Start-Process -FilePath $pythonExe -ArgumentList @('tts/cosy_service.py') -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'experiments/cosy-service.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'experiments/cosy-service.stderr.log')
        $deadline = (Get-Date).AddMinutes(5)
        do {
            if ($ownedService.HasExited) { throw 'Local voice service exited during startup.' }
            Start-Sleep -Seconds 2
            try { $health = Invoke-RestMethod 'http://127.0.0.1:9881/health' -TimeoutSec 3 } catch { $health = $null }
        } while (-not $health.backend_ready -and (Get-Date) -lt $deadline)
        if (-not $health.backend_ready -or $health.revision -ne $config.revision -or $health.project_root -ne $projectRoot) {
            throw 'Local voice service failed its readiness check.'
        }
    }
    $desktop = Start-Process -FilePath $electronExe -ArgumentList ('"' + $projectRoot + '"') -WorkingDirectory $projectRoot -Wait -PassThru -WindowStyle Hidden
    if ($desktop.ExitCode -ne 0) { throw 'Desktop pet exited with an error.' }
} finally {
    if ($ownedService -and -not $ownedService.HasExited) {
        Stop-Process -Id $ownedService.Id -Force
    }
}
