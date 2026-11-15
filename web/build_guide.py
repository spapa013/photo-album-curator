"""Render a build's Markdown user guide to a self-contained static page."""

from hashlib import sha256
from html import escape
from io import BytesIO
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZipFile


MARKDOWN_WHEEL = (
    "https://files.pythonhosted.org/packages/43/af/"
    "4b3891eb0a49d6cfd5cbf3e9bf514c943afc2b0f13e2c57cc57cd88ecc21/"
    "markdown2-2.5.5-py3-none-any.whl"
)
MARKDOWN_SHA256 = "be798587e09d1f52d2e4d96a649c4b82a778c75f9929aad52a2c95747fa26941"
STYLESHEET = Path(__file__).with_name("user-guide.css")


def render_markdown(source):
    with urlopen(MARKDOWN_WHEEL, timeout=45) as response:
        wheel = response.read()
    if sha256(wheel).hexdigest() != MARKDOWN_SHA256:
        raise ValueError("Markdown renderer integrity check failed.")
    with TemporaryDirectory() as directory, ZipFile(BytesIO(wheel)) as archive:
        renderer = Path(directory) / "markdown2.py"
        renderer.write_bytes(archive.read(renderer.name))
        return subprocess.run(
            [sys.executable, "-X", "utf8", str(renderer), "--safe", "escape", "--extras", "header-ids,tables"],
            input=source.replace("\r\n", "\n"), encoding="utf-8", capture_output=True, check=True,
        ).stdout


def build_guide(markdown, output, version=""):
    guide = output / "user-guide"
    guide.mkdir(exist_ok=True)
    (guide / "user-guide.md").write_bytes(markdown.encode("utf-8"))
    article = render_markdown(markdown)
    label = f"Photo Album Curator · {escape(version)}" if version else "Photo Album Curator"
    styles = STYLESHEET.read_bytes()
    (guide / STYLESHEET.name).write_bytes(styles)
    (guide / "index.html").write_text(f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <title>User guide · Photo Album Curator</title>
  <link rel="stylesheet" href="../style.css">
  <link rel="stylesheet" href="{STYLESHEET.name}?v={sha256(styles).hexdigest()[:16]}">
</head>
<body>
  <main class="guide">
    <header class="top">
      <p class="hint">{label}</p>
      <a href="../" class="button-link">Go to app</a>
    </header>
    <article>
{article}
    </article>
  </main>
</body>
</html>
""", encoding="utf-8")
