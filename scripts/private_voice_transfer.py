"""Move the user's private, accepted voice runtime to another owned computer.

The output is deliberately a local directory, never a GitHub artifact. Python
environments are rebuilt on the receiving computer rather than copied.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = Path('runtime/cosy-models/Fun-CosyVoice3-0.5B-2512')
ASR = Path('runtime/asr-models/models--Systran--faster-whisper-small/snapshots')
EXCLUDE = {'__pycache__', '.git'}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def all_files(folder):
    return (path for path in folder.rglob('*')
            if path.is_file() and not any(part in EXCLUDE for part in path.parts)
            and path.suffix != '.pyc')


def private_files():
    config = json.loads((ROOT / 'tts/cosy-production.json').read_text(encoding='utf-8'))
    bank = json.loads((ROOT / 'tts/widget-bank/manifest.json').read_text(encoding='utf-8'))
    catalog = json.loads((ROOT / 'tts/widget-bank/catalog.json').read_text(encoding='utf-8'))
    if bank.get('status') != 'completed' or bank.get('voice_revision') != config['revision']:
        raise RuntimeError('Private bank and trained model revisions differ')
    if set(bank['rows']) != {row['id'] for row in catalog['rows']} or len(bank['rows']) != 836:
        raise RuntimeError('The fixed voice bank is incomplete')

    paths = {Path('tts/cosy-production.json'), Path('tts/widget-bank/manifest.json')}
    required_model = {'cosyvoice3.yaml', 'campplus.onnx', 'speech_tokenizer_v3.onnx',
                      'llm.pt', 'flow.pt', 'hift.pt', 'CosyVoice-BlankEN/config.json',
                      'CosyVoice-BlankEN/model.safetensors',
                      'CosyVoice-BlankEN/generation_config.json',
                      'CosyVoice-BlankEN/tokenizer_config.json',
                      'CosyVoice-BlankEN/vocab.json', 'CosyVoice-BlankEN/merges.txt'}
    paths.update(MODEL / name for name in required_model)
    paths.update(path.relative_to(ROOT) for folder in (
        ROOT / 'runtime/CosyVoice/cosyvoice',
        ROOT / 'runtime/CosyVoice/third_party/Matcha-TTS/matcha',
        ROOT / ASR,
    ) for path in all_files(folder))
    paths.update({Path('runtime/CosyVoice/LICENSE'),
                  Path('runtime/CosyVoice/third_party/Matcha-TTS/LICENSE')})
    for role in config['roles'].values():
        for stage in ('llm', 'flow'):
            paths.add(Path(role[stage]['adapter']))
        for reference in role['references']:
            paths.add(Path(reference['audio']))
    for row in bank['rows'].values():
        path = (ROOT / 'tts/widget-bank' / row['file']).resolve()
        if not path.is_relative_to((ROOT / 'tts/widget-bank/wave').resolve()):
            raise RuntimeError('Voice-bank path escapes its audio directory')
        paths.add(path.relative_to(ROOT))
    # Two Taki chat pronunciations use an original reference outside the
    # production reference set. Keep only those recordings plus the manifest.
    taki_manifest = Path('experiments/cosy-training-v1/taki.manifest.json')
    paths.add(taki_manifest)
    originals = json.loads((ROOT / taki_manifest).read_text(encoding='utf-8'))
    for identity in ('85cffee24e2cece29a02', '8b7c545cf86e1fe2d240'):
        sample = next((row for row in originals if row['id'] == identity), None)
        if sample is None:
            raise RuntimeError(f'Missing Taki pronunciation reference {identity}')
        paths.add(Path(sample['audio']))
    for path in paths:
        if path.is_absolute() or '..' in path.parts or not (ROOT / path).is_file():
            raise RuntimeError(f'Missing or unsafe private asset: {path}')
    return config['revision'], sorted(paths)


def export(destination):
    destination = destination.resolve()
    if destination == ROOT or ROOT.is_relative_to(destination):
        raise RuntimeError('Choose a dedicated output directory for private files')
    revision, paths = private_files()
    destination.mkdir(parents=True, exist_ok=True)
    records = {}
    total = 0
    for index, relative in enumerate(paths, 1):
        source = ROOT / relative
        target = destination / relative
        digest = sha256(source)
        if not target.is_file() or target.stat().st_size != source.stat().st_size or sha256(target) != digest:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        records[relative.as_posix()] = {'bytes': source.stat().st_size, 'sha256': digest}
        total += source.stat().st_size
        if index % 200 == 0:
            print(f'Copied {index}/{len(paths)} private files', flush=True)
    manifest = {'format': 1, 'revision': revision, 'files': records}
    (destination / 'private-transfer.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Private transfer ready: {len(paths)} files, {total / 2**30:.2f} GiB at {destination}')


def import_pack(source):
    source = source.resolve()
    manifest = json.loads((source / 'private-transfer.json').read_text(encoding='utf-8'))
    if manifest.get('format') != 1 or not isinstance(manifest.get('files'), dict):
        raise RuntimeError('Invalid private transfer manifest')
    files = manifest['files']
    config = json.loads((source / 'tts/cosy-production.json').read_text(encoding='utf-8'))
    if config['revision'] != manifest['revision']:
        raise RuntimeError('Voice revisions differ')
    for name, record in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or len(relative.parts) < 2:
            raise RuntimeError(f'Unsafe path in private transfer: {name}')
        path = (source / relative).resolve()
        if not path.is_relative_to(source) or not path.is_file():
            raise RuntimeError(f'Missing private transfer file: {name}')
        if path.stat().st_size != record['bytes'] or sha256(path) != record['sha256']:
            raise RuntimeError(f'Private transfer checksum failed: {name}')
    print(f'All {len(files)} private files passed checksum verification.', flush=True)
    for index, name in enumerate(files, 1):
        relative = Path(name)
        target = ROOT / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.is_file() or target.stat().st_size != files[name]['bytes'] or sha256(target) != files[name]['sha256']:
            shutil.copy2(source / relative, target)
        if index % 200 == 0:
            print(f'Installed {index}/{len(files)} private files', flush=True)
    print(f'Private voice revision {manifest["revision"]} installed in {ROOT}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('export', 'import'))
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    if args.operation == 'export':
        export(args.directory)
    else:
        import_pack(args.directory)
