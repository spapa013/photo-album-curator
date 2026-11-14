from contextlib import contextmanager
import json
import os
from pathlib import Path
from queue import Queue
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def running_sorter(workspace):
    args = ["--workspace", str(workspace), "--port", "0", "--no-browser"]
    if os.name == "nt":
        command = 'call "Start Wedding Sorter.bat" ' + subprocess.list2cmdline(args)
    else:
        command = ["/bin/bash", "Start Wedding Sorter.command", *args]
    with subprocess.Popen(
        command, shell=os.name == "nt", cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    ) as process:
        output = Queue()
        Thread(target=lambda: output.put(process.stdout.readline().strip()), daemon=True).start()
        try:
            line = output.get(timeout=20)
            prefix = "Wedding Photo Sorter is ready at "
            if not line.startswith(prefix):
                raise RuntimeError(f"Unexpected launcher output: {line!r}")
            yield line.removeprefix(prefix)
        finally:
            if os.name == "nt":
                subprocess.run(["taskkill", "/pid", str(process.pid), "/t", "/f"],
                               capture_output=True, timeout=10)
            else:
                process.terminate()
            process.wait(timeout=10)


class PlatformSmokeTest(unittest.TestCase):
    def test_preview_assign_and_render(self):
        with TemporaryDirectory(prefix="Wedding Sorter ") as temp:
            workspace = Path(temp)
            albums = workspace / "Albums"
            albums.mkdir()
            photo = "portrait.jpg"
            jpeg = b"\xff\xd8\xff\xd9"
            source = "Sample Album.zip"
            with ZipFile(albums / source, "w") as archive:
                archive.writestr(f"Sample Album/{photo}", jpeg)

            with running_sorter(workspace) as base:
                def get(path):
                    with urlopen(base + path, timeout=10) as response:
                        return response.read()

                def post(path, **data):
                    request = Request(base + path, data=json.dumps(data).encode(), headers={
                        "Origin": base,
                        "Content-Type": "application/json",
                    })
                    with urlopen(request, timeout=10) as response:
                        return json.load(response)

                self.assertIn(b"Wedding Photo Sorter", get("/"))
                state = post("/api/open", album=source)
                self.assertEqual([item["path"] for item in state["photos"]], [photo])
                self.assertEqual(get("/photo?" + urlencode({"album": source, "path": photo})), jpeg)
                post("/api/guest", album=source, name="Guest")
                post("/api/review", album=source, photo=photo, destinations=["Guest", ""],
                     printed=2, revision=state["revision"])
                state = post("/api/open", album=source)
                self.assertEqual(state["printed"][photo], 2)
                self.assertEqual(state["reviews"][photo], ["", "Guest"])
                guest, = json.loads(get("/api/final/guests"))
                plan = post("/api/final/open", guest=guest["id"])
                result = post("/api/final/render", guest=guest["id"], token=plan["token"])
                self.assertEqual(result["count"], 1)
                output = Path(result["path"]) / "0001 - portrait.jpg"
                self.assertEqual(output.read_bytes(), jpeg)


if __name__ == "__main__":
    unittest.main()
