"""Prevent concurrent local GPU jobs from loading incompatible voice models."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def gpu_lock():
    folder = ROOT / 'experiments/training'
    folder.mkdir(parents=True, exist_ok=True)
    handle = (folder / '.gpu.lock').open('a+b')
    handle.write(b'0')
    handle.flush()
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise SystemExit('Another local process owns the GPU.')
    return handle
