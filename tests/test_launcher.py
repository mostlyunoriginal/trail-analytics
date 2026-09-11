import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(os.name == "nt", "Windows command-line parsing regression")
class LauncherTests(unittest.TestCase):
    def test_server_directory_does_not_swallow_bind_argument(self):
        root = Path(__file__).resolve().parents[1]
        command = next(line for line in (root / "viewer.cmd").read_text().splitlines()
                       if line.startswith("py -m http.server "))
        probe = f'"{sys.executable}" -c "import json,sys; print(json.dumps(sys.argv[1:]))"'
        with tempfile.TemporaryDirectory(prefix="trail launcher ") as folder:
            for directory in (root, Path(folder)):
                expanded = command.replace("%~dp0", str(directory) + "\\")
                expanded = expanded.replace("py -m http.server", probe, 1)
                result = subprocess.run(expanded, capture_output=True, text=True, check=True)
                arguments = json.loads(result.stdout)
                self.assertEqual(arguments[:2], ["8351", "--directory"])
                self.assertEqual(Path(arguments[2]).resolve(), directory.resolve())
                self.assertEqual(arguments[3:], ["--bind", "127.0.0.1"])


if __name__ == "__main__":
    unittest.main()
