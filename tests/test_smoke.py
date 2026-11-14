from contextlib import contextmanager
from html.parser import HTMLParser
import os
from pathlib import Path
from queue import Queue
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def running_curator(app):
    args = ["--port", "0", "--no-browser"]
    if os.name == "nt":
        command = 'call "Start Wedding Sorter.bat" ' + subprocess.list2cmdline(args)
    else:
        command = ["./Start Wedding Sorter.command", *args]
    with subprocess.Popen(
        command, shell=os.name == "nt", cwd=app,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    ) as process:
        output = Queue()
        Thread(target=lambda: output.put(process.stdout.readline().strip()), daemon=True).start()
        try:
            line = output.get(timeout=20)
            prefix = "Photo Album Curator is ready at "
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


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "script" and "src" in attributes:
            self.urls.append(attributes["src"])
        if tag == "link" and attributes.get("rel") == "stylesheet":
            self.urls.append(attributes["href"])


class PlatformSmokeTest(unittest.TestCase):
    def test_desktop_bundle_serves_the_browser_build(self):
        with TemporaryDirectory(prefix="Photo Album Curator ") as temp:
            with ZipFile(ROOT / "PhotoAlbumCurator-desktop.zip") as archive:
                members = archive.infolist()
                self.assertFalse(any("sqlite" in member.filename or "Albums/" in member.filename for member in members))
                archive.extractall(temp)
                if os.name != "nt":
                    for member in members:
                        (Path(temp) / member.filename).chmod((member.external_attr >> 16) & 0o777)
            app = Path(temp) / "Photo Album Curator"
            (app / "private.json").write_text("private", encoding="utf-8")

            with running_curator(app) as base:
                def get(path):
                    with urlopen(base + path, timeout=10) as response:
                        return response.read()

                for filename, route, label in [
                    ("index.html", "", b"Set Workspace"),
                    ("final.html", "final.html", b"Download ZIP"),
                ]:
                    page = get(route)
                    self.assertIn(label, page)
                    self.assertEqual(page, (app / "dist" / filename).read_bytes())
                    assets = PageAssets()
                    assets.feed(page.decode())
                    self.assertIn("browser.js", [urlsplit(url).path for url in assets.urls])
                    for url in assets.urls:
                        parts = urlsplit(url)
                        self.assertFalse(parts.scheme or parts.netloc)
                        self.assertEqual(get(url), (app / "dist" / parts.path).read_bytes())

                for route in ("private.json", "../private.json", "api/albums"):
                    with self.assertRaises(HTTPError) as error:
                        get(route)
                    self.assertEqual(error.exception.code, 404)
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(base, headers={"Host": "example.test"}), timeout=10)
                self.assertEqual(error.exception.code, 403)


if __name__ == "__main__":
    unittest.main()
