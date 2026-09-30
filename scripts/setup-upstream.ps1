param()
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$upstream = Join-Path $projectRoot 'runtime/vendor/live2d-widget-mygo'
$expectedCommit = '2ee129159f5e75e376adfa997ae1b7de52d677d6'
$electronExe = Join-Path $projectRoot 'node_modules/electron/dist/electron.exe'

if (-not (Test-Path -LiteralPath $electronExe)) {
    $electronInstaller = Join-Path $projectRoot 'node_modules/electron/install.js'
    if (-not (Test-Path -LiteralPath $electronInstaller)) { throw 'Run npm ci before setting up the desktop pet.' }
    & node $electronInstaller
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $electronExe)) {
        throw 'Electron could not be installed. Check the network and run setup again.'
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $upstream '.git'))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $upstream -Parent) | Out-Null
    & git clone --depth 1 --branch v0.2.4 https://github.com/panxuc/live2d-widget-mygo.git $upstream
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the pinned upstream widget.' }
}
$commit = (& git -C $upstream rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -ne $expectedCommit) {
    throw "Unexpected upstream commit $commit. Expected $expectedCommit."
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npmCli = Join-Path $projectRoot 'runtime/npm/package/bin/npm-cli.js'
if (-not $npm -and -not (Test-Path -LiteralPath $npmCli)) {
    throw 'Node.js with npm is required to build the upstream widget.'
}
function Invoke-Npm([string[]]$arguments) {
    if ($npm) { & $npm.Source @arguments }
    else { & node $npmCli @arguments }
    if ($LASTEXITCODE -ne 0) { throw "npm failed: $($arguments -join ' ')" }
}
Push-Location $upstream
try {
    Invoke-Npm @('ci', '--no-audit', '--no-fund')
    Invoke-Npm @('run', 'build')
} finally { Pop-Location }

$dist = Join-Path $upstream 'dist'
$public = Join-Path $upstream 'public'
foreach ($name in @('index.js', 'autoload.js', 'waifu.css', 'live2d.min.js', 'live2dcubismcore.min.js')) {
    $target = Join-Path $projectRoot $name
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath (Join-Path $dist $name) -Destination $target
    }
}
$html = Join-Path $projectRoot 'index.html'
if (-not (Test-Path -LiteralPath $html)) {
    Copy-Item -LiteralPath (Join-Path $public 'index.html') -Destination $html
}
foreach ($name in @('assets', 'model')) {
    $target = Join-Path $projectRoot $name
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath (Join-Path $public $name) -Destination $target -Recurse
    }
}

$python = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python 3 is required to apply the local widget patch.' }
& $python.Source (Join-Path $projectRoot 'tts/instrument_widget.py')
if ($LASTEXITCODE -ne 0) { throw 'Widget integration patch failed.' }
Write-Host 'Pinned upstream widget and local desktop hooks are ready.'
