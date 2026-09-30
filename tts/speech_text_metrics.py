"""Offline ASR comparison for private chat speech before it reaches the UI."""

import re
import unicodedata


def edit_distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1] + 1, row[j] + 1, row[j - 1] + (x != y)))
        row = current
    return row[-1]


def kana(text):
    import pyopenjtalk
    return re.sub(r'[^ァ-ヶー]', '', unicodedata.normalize('NFKC', pyopenjtalk.g2p(text, kana=True)))


def metrics(expected, transcript):
    target = kana(expected)
    actual = kana(transcript)
    clauses = [part.strip() for part in re.split(r'[。！？!?…]+', expected) if part.strip()]
    last_clause = kana(clauses[-1]) if clauses else target
    ending = last_clause if len(last_clause) >= 4 else target
    tail = ending[-min(14, max(4, len(ending) // 3 if ending == target else len(ending))):]
    tail_error = min((edit_distance(tail, actual[i:i + len(tail)]) / len(tail)
                      for i in range(max(1, len(actual) - len(tail) + 1))), default=1.)
    error = edit_distance(target, actual) / max(1, len(target))
    return dict(kana_error=round(error, 4), tail_error=round(tail_error, 4),
                target_kana=target, asr_kana=actual,
                suspect=bool(len(target) >= 10 and (error > .6 or tail_error > .65)))
