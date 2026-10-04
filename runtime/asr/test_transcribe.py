"""Runtime identity checks only; this is not acoustic model QA."""
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class ModelIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('transcribe', Path(__file__).with_name('transcribe.py'))
        cls.runtime = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'faster_whisper': types.SimpleNamespace(WhisperModel=None)}):
            spec.loader.exec_module(cls.runtime)

    def test_default_identity_preserves_original_small_runtime(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.runtime.model_identity(), 'Systran/faster-whisper-small')

    def test_medium_identity_is_explicit_and_unknown_identity_is_rejected(self):
        with patch.dict(os.environ, {'VIDEO_ASR_MODEL': 'Systran/faster-whisper-medium'}):
            self.assertEqual(self.runtime.model_identity(), 'Systran/faster-whisper-medium')
        with patch.dict(os.environ, {'VIDEO_ASR_MODEL': 'unknown'}):
            with self.assertRaisesRegex(ValueError, 'ASR_MODEL_UNAVAILABLE'):
                self.runtime.model_identity()


if __name__ == '__main__':
    unittest.main()
