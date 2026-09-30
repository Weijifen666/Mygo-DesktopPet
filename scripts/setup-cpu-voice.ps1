param([Parameter(Mandatory = $true)][string]$PrivatePack)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$pack = (Resolve-Path -LiteralPath $PrivatePack).Path
$python = Join-Path $root 'runtime/cosy-venv310/Scripts/python.exe'
$deepestDependency = Join-Path $root 'runtime/cosy-venv310/Lib/site-packages/modelscope/msdatasets/dataset_cls/custom_datasets/image_quality_assessment_degradation/image_quality_assessment_degradation_dataset.py'
if ($deepestDependency.Length -ge 260) {
    throw 'The checkout path is too long for some Windows Python packages. Move it to a short path such as C:\MyGO\Mygo-DesktopPet.'
}

Push-Location $root
try {
    & py -3.10 -c 'import sys; assert sys.version_info[:2] == (3, 10)'
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.10 (64-bit) and its Windows py launcher first.' }
    if (-not (Test-Path -LiteralPath $python)) {
        & py -3.10 -m venv (Join-Path $root 'runtime/cosy-venv310')
        if ($LASTEXITCODE -ne 0) { throw 'Could not create Python 3.10 virtual environment.' }
    }
    & $python -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw 'Could not update pip.' }
    & $python -m pip install torch==2.6.0+cpu torchaudio==2.6.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the official CPU-only PyTorch wheels.' }
    & $python -m pip install -r (Join-Path $root 'tts/requirements-cpu.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the CosyVoice CPU dependencies.' }
    & $python -c 'import torch, torchaudio, onnxruntime, fastapi, faster_whisper, pyopenjtalk; assert not torch.cuda.is_available(); print("CPU Python environment ready")'
    if ($LASTEXITCODE -ne 0) { throw 'The CPU Python environment failed its import check.' }

    & $python (Join-Path $root 'scripts/private_voice_transfer.py') import $pack
    if ($LASTEXITCODE -ne 0) { throw 'The private voice transfer failed integrity checks.' }
    & $python -c 'import sys; sys.path.insert(0, "tts"); from cosy_runtime import CosyRuntime; from cosyvoice.cli.cosyvoice import AutoModel; print("CosyVoice CPU modules ready")'
    if ($LASTEXITCODE -ne 0) { throw 'CosyVoice CPU modules could not be imported.' }
    & $python (Join-Path $root 'tts/verify_voice_bank.py')
    if ($LASTEXITCODE -ne 0) { throw 'The fixed voice bank failed validation.' }

    # Import checks cannot catch missing dependencies loaded from the model YAML.
    # Generate and recognize one new line before reporting that CPU voices work.
    $env:CUDA_VISIBLE_DEVICES = '-1'
    $env:MYGO_COSY_CPU = '1'
    $env:PYTHONUTF8 = '1'
    $env:HF_HOME = Join-Path $root 'runtime/hf-cache'
    $seed = Get-Random -Minimum 1 -Maximum 2147483647
    & $python (Join-Path $root 'scripts/diagnose-voice-quality.py') --direct --generation-seed $seed
    if ($LASTEXITCODE -ne 0) { throw 'CPU voice synthesis or intelligibility check failed; inspect experiments/voice-diagnostics/latest.json.' }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { throw 'Install Node.js (with npm) first.' }
    & $npm.Source ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Could not install Electron dependencies.' }
    $env:PATH = "$(Split-Path -Parent $python);$env:PATH"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/setup-upstream.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the Live2D widget.' }
    Write-Host 'Offline voices installed. Start the pet with start-cpu-voice.cmd.'
} finally {
    Pop-Location
}
