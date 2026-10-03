"""Pinned input-only Mandarin frontend; no expected transcript or network."""
import json
import re
import sys
from misaki.zh import ZHG2P
from misaki.tone_sandhi import ToneSandhi


class LexicalToneSandhi(ToneSandhi):
    def _neural_sandhi(self, word, pos, finals):
        lexical = list(finals)
        result = super()._neural_sandhi(word, pos, finals)
        # Jieba separates grammatical particles. A compound lexical word's
        # dictionary reading must not be overwritten merely by its last glyph.
        # Preserve genuinely neutral dictionary readings and particle tags.
        if (len(word) > 1 and word[-1] in '的地得' and
                not pos.startswith('u') and lexical[-1][-1] != '5'):
            result[-1] = lexical[-1]
        return result


def main():
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        raise ValueError('VOICE_PHONEMIZATION_INVALID')
    job = json.loads(raw)
    if (not isinstance(job, dict) or set(job) != {'text', 'english', 'mode'} or
            job['mode'] not in ('discover', 'phonemize')):
        raise ValueError('VOICE_PHONEMIZATION_INVALID')
    text, english = job['text'], job['english']
    if (not isinstance(text, str) or not 1 <= len(text) <= 250 or
            any(ord(char) < 32 or ord(char) == 127 for char in text) or
            not isinstance(english, dict) or len(english) > 125 or
            any(not isinstance(key, str) or not isinstance(value, str) or
                not 1 <= len(key) <= 250 or len(value) > 4000
                for key, value in english.items())):
        raise ValueError('VOICE_PHONEMIZATION_INVALID')
    # English uses the original pinned package's native frontend, captured by
    # the trusted Node adapter. Missing fragments fail rather than disappear.
    fragments = []
    def convert_english(fragment):
        if job['mode'] == 'discover':
            fragments.append(fragment)
            return 'h'
        return english[fragment]
    engine = ZHG2P(version='1.1', en_callable=convert_english)
    engine.frontend.tone_modifier = LexicalToneSandhi()
    # A hyphen joining a Latin identifier to its version number is silent,
    # whereas an independent minus sign must keep its numeric meaning.
    # Apply identically during discovery and final conversion.
    normalized = re.sub(r'(?<=[A-Za-z])-(?=[0-9])', ' ', text)
    phonemes, _ = engine(normalized)
    if job['mode'] == 'discover':
        print(json.dumps({'fragments': fragments}, ensure_ascii=False))
        return
    if not phonemes.strip() or '❓' in phonemes:
        raise ValueError('VOICE_PHONEMIZATION_INVALID')
    print(json.dumps({'phonemes': phonemes}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('VOICE_PHONEMIZATION_FAILED', file=sys.stderr)
        sys.exit(1)
