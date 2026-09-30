"""Fail closed if staged Git content includes private media, weights or keys."""
import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_TOP = {'runtime', 'experiments', 'output', 'assets', 'model', 'node_modules'}
FORBIDDEN_FILES = {
    'index.js', 'autoload.js', 'waifu.css', 'index.html',
    'live2d.min.js', 'live2dcubismcore.min.js',
    'tts/cosy-production.json', 'tts/original-fixed-recordings.json',
    'tts/tts_infer.yaml', 'tts/voices.local.json', 'tts/voices.experimental.json',
    'agent-memory.json', 'agent-secret.json',
}
FORBIDDEN_SUFFIXES = {
    '.wav', '.mp3', '.flac', '.ogg', '.m4a', '.safetensors', '.ckpt',
    '.pth', '.pt', '.onnx', '.bin', '.zip', '.7z', '.tar', '.gz', '.sqlite', '.db',
}
TOKEN_PATTERNS = [
    re.compile(rb'sk-[A-Za-z0-9]{20,}'),
    re.compile(rb'github_pat_[A-Za-z0-9_]{20,}'),
    re.compile(rb'gh[pousr]_[A-Za-z0-9]{20,}'),
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tracked', action='store_true', help='Inspect every tracked file in CI')
    args = parser.parse_args()
    command = ['git', 'ls-files', '-z'] if args.tracked else [
        'git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'
    ]
    names = subprocess.check_output(command, cwd=ROOT)
    paths = [Path(raw.decode('utf-8')) for raw in names.split(b'\0') if raw]
    if not paths:
        raise SystemExit('No files to verify.')
    failures = []
    for rel in paths:
        name = rel.as_posix()
        if (rel.parts[0] in FORBIDDEN_TOP or name in FORBIDDEN_FILES
                or rel.suffix.lower() in FORBIDDEN_SUFFIXES
                or name.startswith('tts/cache/')
                or name.startswith('tts/widget-bank/') and name not in {
                    'tts/widget-bank/catalog.json', 'tts/widget-bank/translations.json'
                }):
            failures.append(f'{name}: private or generated path')
            continue
        full = (ROOT / rel).resolve()
        if not full.is_relative_to(ROOT) or not full.is_file():
            failures.append(f'{name}: invalid path')
            continue
        if full.stat().st_size > 5 * 1024 * 1024:
            failures.append(f'{name}: larger than 5 MiB')
            continue
        content = full.read_bytes()
        if any(pattern.search(content) for pattern in TOKEN_PATTERNS):
            failures.append(f'{name}: possible credential or private key')
    if failures:
        raise SystemExit('Public-tree check failed:\n' + '\n'.join(failures))
    scope = 'tracked' if args.tracked else 'staged'
    print(f'Public-tree check passed: {len(paths)} {scope} source files; no private media, weights or key patterns.')


if __name__ == '__main__':
    main()
