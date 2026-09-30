"""Compare a transferred fixed voice with a newly generated local voice.

Run this with the voice service already started. The output stays in the
ignored experiments directory and contains no training recordings.
"""

import argparse
import hashlib
import json
import os
import platform
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:9881'
DEFAULT_TEXT = '今日はいい天気だね。少し散歩しようか。'


def request(path, payload=None, timeout=15):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        URL + path, data=body,
        headers={'Content-Type': 'application/json'} if body else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read(), dict(response.headers)


def wav_metrics(path):
    import numpy as np

    with wave.open(str(path), 'rb') as audio:
        channels = audio.getnchannels()
        width = audio.getsampwidth()
        rate = audio.getframerate()
        frames = audio.getnframes()
        raw = audio.readframes(frames)
    if width != 2:
        return {'sample_rate': rate, 'channels': channels, 'sample_width': width,
                'duration_s': round(frames / rate, 2), 'pcm16_metrics': 'unavailable'}
    samples = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
    return {'sample_rate': rate, 'channels': channels, 'duration_s': round(frames / rate, 2),
            'rms': round(float(np.sqrt(np.mean(samples ** 2))), 5),
            'peak': round(float(np.max(np.abs(samples))), 5),
            'clipped_fraction': round(float(np.mean(np.abs(samples) >= .999)), 5),
            'silent_fraction': round(float(np.mean(np.abs(samples) < .001)), 5)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--character', choices=('tomori', 'anon', 'rana', 'soyo', 'taki'), default='anon')
    parser.add_argument('--text', default=DEFAULT_TEXT, help='Japanese test line, up to 300 characters')
    parser.add_argument('--generation-seed', type=int, default=1234)
    parser.add_argument('--direct', action='store_true',
                        help='Load and test the local model without a running service')
    parser.add_argument('--skip-asr', action='store_true')
    args = parser.parse_args()
    if not 1 <= len(args.text) <= 300:
        parser.error('--text must be 1 to 300 characters')
    if not 0 <= args.generation_seed <= 2147483647:
        parser.error('--generation-seed must be from 0 to 2147483647')

    import torch
    import torchaudio
    import onnxruntime

    report = {'time': time.strftime('%Y-%m-%d %H:%M:%S %z'),
              'python': sys.version.split()[0], 'platform': platform.platform(),
              'torch': torch.__version__, 'torchaudio': torchaudio.__version__,
              'onnxruntime': onnxruntime.__version__, 'cuda_available': torch.cuda.is_available(),
              'character': args.character, 'text': args.text,
              'generation_seed': args.generation_seed}
    config = json.loads((ROOT / 'tts/cosy-production.json').read_text(encoding='utf-8'))
    manifest = json.loads((ROOT / 'tts/widget-bank/manifest.json').read_text(encoding='utf-8'))
    report['revision'] = config['revision']
    report['voice_bank_rows'] = len(manifest['rows'])
    row = next(row for row in manifest['rows'].values() if row['role'] == args.character)
    fixed_path = ROOT / 'tts/widget-bank' / row['file']
    report['fixed'] = {'file': str(fixed_path), 'source': row['source'],
                       'metrics': wav_metrics(fixed_path)}
    runtime = None
    if args.direct:
        if not torch.cuda.is_available():
            os.environ['MYGO_COSY_CPU'] = '1'
        sys.path.insert(0, str(ROOT / 'tts'))
        from cosy_runtime import CosyRuntime
        runtime = CosyRuntime()
        report['service'] = {'model': 'CosyVoice3 combined',
                             'revision': runtime.config['revision'], 'backend_ready': True,
                             'direct': True}
    else:
        health_data, _ = request('/health')
        health = json.loads(health_data)
        report['service'] = {'model': health['model'], 'revision': health['revision'],
                             'backend_ready': health['backend_ready']}
    if report['service']['revision'] != config['revision']:
        raise RuntimeError('Service and private voice pack have different revisions')

    destination = ROOT / 'experiments/voice-diagnostics'
    destination.mkdir(parents=True, exist_ok=True)
    audio_path = destination / (args.character + '-' + time.strftime('%Y%m%d-%H%M%S') + '.wav')
    started = time.monotonic()
    try:
        if args.direct:
            audio, meta = runtime.synthesize(args.character, args.text,
                                              generation_seed=args.generation_seed,
                                              validate_content=True)
            headers = {'X-Voice-Revision': meta['revision'], 'X-Cache': meta['cache'],
                       'X-Reference-Id': meta['reference_id'],
                       'X-Reference-Mode': meta['mode'],
                       'X-Generation-Seed': str(meta['seed']),
                       'X-Content-Check': meta['content_validation']['status']}
        else:
            audio, headers = request('/synthesize', {'character': args.character,
                                                      'text': args.text, 'emotion': 'neutral',
                                                      'generationSeed': args.generation_seed,
                                                      'checkContent': True}, timeout=900)
    except urllib.error.HTTPError as error:
        report['synthesis_error'] = {'status': error.code,
                                     'body': error.read().decode('utf-8', errors='replace')}
    else:
        audio_path.write_bytes(audio)
        report['generated'] = {'file': str(audio_path), 'elapsed_s': round(time.monotonic() - started, 1),
                               'sha256': hashlib.sha256(audio).hexdigest(),
                               'headers': {key: value for key, value in headers.items() if key.lower().startswith('x-')},
                               'metrics': wav_metrics(audio_path)}
        if not args.skip_asr:
            try:
                sys.path.insert(0, str(ROOT / 'tts'))
                os.environ['PYTHONUTF8'] = '1'
                if not torch.cuda.is_available():
                    os.environ['MYGO_COSY_CPU'] = '1'
                from speech_content_check import check
                report['generated']['asr'] = check(audio, args.text)
            except Exception as error:
                report['generated']['asr_error'] = f'{type(error).__name__}: {error}'
    report_path = destination / 'latest.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True, indent=2))
    print('Report:', report_path)
    if 'synthesis_error' in report or 'generated' not in report:
        raise SystemExit(1)
    generated = report['generated']
    if (generated['metrics']['rms'] < .01 or generated['metrics']['clipped_fraction'] > .02
            or 'asr_error' in generated
            or generated.get('asr', {}).get('suspect', False)):
        raise SystemExit('Voice quality diagnostic failed; inspect the report and WAV file')


if __name__ == '__main__':
    main()
