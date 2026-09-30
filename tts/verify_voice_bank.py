"""Reject an incomplete or mismatched private fixed-speech bank at startup."""

import hashlib
import json
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'tts/widget-bank'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    config = read(ROOT / 'tts/cosy-production.json')
    manifest = read(BANK / 'manifest.json')
    catalog = read(BANK / 'catalog.json')
    expected = {row['id'] for row in catalog['rows']}
    if (manifest.get('status') != 'completed' or
            manifest.get('voice_revision') != config['revision'] or
            set(manifest['rows']) != expected):
        raise RuntimeError('Private fixed-speech bank does not match this release')
    for identity, row in manifest['rows'].items():
        relative = Path(row['file'])
        audio = (BANK / relative).resolve()
        if (not audio.is_relative_to(BANK / 'wave') or audio.suffix.lower() != '.wav'
                or hashlib.sha256(audio.read_bytes()).hexdigest() != row['wav_sha256']):
            raise RuntimeError(f'Fixed audio is missing or changed: {identity}')
        with wave.open(str(audio), 'rb') as wav:
            if wav.getframerate() != 24000 or wav.getnchannels() != 1 or wav.getnframes() < 3600:
                raise RuntimeError(f'Invalid fixed audio format: {identity}')
    print(f'Private voice bank verified: {len(expected)} lines.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
