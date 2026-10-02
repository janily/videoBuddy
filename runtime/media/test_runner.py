import tempfile
import unittest
from pathlib import Path
from runner import run_stage
class RunnerTests(unittest.TestCase):
    def test_completed_stage_is_reused_without_reexecuting_effect(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); calls=[]
            def render(): calls.append(1); return ['output/picture.mp4']
            self.assertEqual(run_stage(root,render)['status'],'succeeded')
            self.assertEqual(run_stage(root,render)['status'],'succeeded')
            self.assertEqual(len(calls),1)
    def test_failed_marker_does_not_auto_retry_unknown_effect(self):
        with tempfile.TemporaryDirectory() as folder:
            calls=[]
            def fail(): calls.append(1); raise RuntimeError()
            self.assertEqual(run_stage(Path(folder),fail)['status'],'failed')
            self.assertEqual(run_stage(Path(folder),fail)['status'],'failed')
            self.assertEqual(len(calls),1)
if __name__=='__main__': unittest.main()

class CrashTests(unittest.TestCase):
    def test_abandoned_process_without_terminal_marker_is_not_restarted(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'process.json').write_text('{"pid":123,"startTimeNs":1}');calls=[]
            state=run_stage(root,lambda:calls.append(1))
            self.assertEqual(state['status'],'failed');self.assertEqual(state['errorCode'],'STAGE_UNKNOWN');self.assertEqual(calls,[])
