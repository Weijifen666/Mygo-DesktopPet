"""Read the same local proper-name pronunciations used by the desktop agent."""
import json
from pathlib import Path
import re

NAMES=json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))

def normalize_spoken_names(text):
    result=str(text)
    for name,reading in sorted(NAMES.items(),key=lambda pair:len(pair[0]),reverse=True):
        result=re.sub(r'(?<![A-Za-z0-9_])'+re.escape(name)+r'(?![A-Za-z0-9_])',reading,result,flags=re.IGNORECASE)
    return result

def spoken_reading(text, g2p):
    """Convert Japanese to kana, retaining unknown English as whole words.

    OpenJTalk spells unknown Latin words letter by letter. CosyVoice supports
    English directly; leave those words intact rather than forcing that path.
    Desktop dialogue additionally requires all words to have Japanese readings.
    """
    normalized=normalize_spoken_names(text)
    pieces=re.split(r"([A-Za-z]+(?:['’-][A-Za-z]+)*)",normalized)
    return ''.join(piece if re.search('[A-Za-z]',piece) else g2p(piece,kana=True) if piece.strip() else piece for piece in pieces)
