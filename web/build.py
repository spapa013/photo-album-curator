"""Build the self-contained GitHub Pages site in dist/."""
from base64 import b64decode
from hashlib import sha256, sha512
from io import BytesIO
from pathlib import Path
import shutil
from tarfile import open as open_tar
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PACKAGES = (
    ("https://registry.npmjs.org/@zip.js/zip.js/-/zip.js-2.25.0.tgz",
     "oNRqUuU1XFu6G5d7Z0jufJ9dS9WteO0xiU/PNxsUrb4itZCsSbn191jpJzU00Gmc6S680X3DPZeF5EV4zAEMAg==",
     {"dist/zip.min.js": "zip.min.js", "LICENSE": "zip.js.LICENSE"}),
    ("https://registry.npmjs.org/sql.js/-/sql.js-1.16.0.tgz",
     "q/JOZuJfmVh8Zf8Eo+cMJvtxAWeWBqTfJ6AQYGXZmcaLGHMwhA2niH3fQYHrBtPeOss1ttzHec07K5+rHaMRMw==",
     {"dist/sql-wasm-browser.js": "sql-wasm-browser.js", "dist/sql-wasm-browser.wasm": "sql-wasm-browser.wasm",
      "LICENSE": "sql.js.LICENSE"}),
)

DIST.mkdir(exist_ok=True)
for url, integrity, files in PACKAGES:
    with urlopen(url, timeout=45) as response:
        data = response.read()
    if sha512(data).digest() != b64decode(integrity):
        raise ValueError(f"Package integrity failed for {url}")
    with open_tar(fileobj=BytesIO(data), mode="r:gz") as archive:
        for source, destination in files.items():
            with archive.extractfile(f"package/{source}") as library:
                (DIST / destination).write_bytes(library.read())

for name in ("app.js", "final.js", "style.css"):
    shutil.copyfile(ROOT / "ui" / name, DIST / name)
for name in ("browser.js", "browser.css"):
    shutil.copyfile(ROOT / "web" / name, DIST / name)

def asset_url(name):
    fingerprint = sha256((DIST / name).read_bytes()).hexdigest()[:16]
    return f"{name}?v={fingerprint}"


for name, script in (("final.html", "final.js"), ("index.html", "app.js")):
    page = (ROOT / "ui" / name).read_text(encoding="utf-8")
    page = page.replace(f'src="/{script}"', f'src="{script}"')
    if name == "index.html":
        security = """<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">"""
    else:
        security = """<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'">"""
    scripts = ("zip.min.js", "sql-wasm-browser.js") if name == "index.html" else ()
    includes = "\n".join(
        f'<script src="{asset_url(asset)}" defer></script>'
        for asset in (*scripts, "browser.js", script)
    )
    page = page.replace(f'<script src="{script}" defer></script>',
                        f'{security}\n<link rel="stylesheet" href="{asset_url("browser.css")}">\n{includes}')
    page = page.replace("Wedding Photo Sorter", "Photo Album Curator")
    page = page.replace('href="/style.css"', 'href="style.css"').replace('href="/"', 'href="./"')
    page = page.replace('href="style.css"', f'href="{asset_url("style.css")}"')
    if name == "index.html":
        page = page.replace('href="/final"', f'href="{asset_url("final.html")}"')
    (DIST / name).write_text(page, encoding="utf-8")
(DIST / ".nojekyll").touch()
