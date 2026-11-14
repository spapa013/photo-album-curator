"""Build a single Pages artifact containing the stable, pinned, and edge apps."""

from hashlib import sha256
from html import escape
from io import BytesIO
import os
from os.path import relpath
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tarfile import open as open_tar
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
FIRST_VERSION = "v0.3.0"
RELEASE_TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def github(*args):
    return subprocess.check_output(["gh", "api", *args], cwd=ROOT, text=True).strip()


def build(ref, destination):
    print(f"Building {ref} for {destination.name}", flush=True)
    source = subprocess.check_output(["git", "archive", "--format=tar", ref], cwd=ROOT)
    with TemporaryDirectory() as directory:
        checkout = Path(directory)
        with open_tar(fileobj=BytesIO(source)) as archive:
            archive.extractall(checkout, filter="data")
        environment = os.environ.copy()
        environment.pop("GH_TOKEN", None)
        subprocess.run([sys.executable, "web/build.py"], cwd=checkout, env=environment, check=True)
        shutil.copytree(checkout / "dist", destination)


def add_version_navigation(output, latest, tags, edge_commit):
    routes = [
        (output, f"Latest release ({latest})", f"{latest} · Latest release"),
        *((output / "versions" / tag, tag, f"{tag} · Pinned release") for tag in tags),
        (output / "edge", "Edge", f"Edge · {edge_commit}"),
    ]
    for directory, _, current_version in routes:
        links = []
        for target, label, _ in routes:
            if target == directory:
                links.append(f'<li><span aria-current="page">{escape(label)}</span></li>')
            else:
                href = Path(relpath(target, directory)).as_posix() + "/"
                links.append(f'<li><a href="{escape(href)}" target="_top">{escape(label)}</a></li>')
        navigation = (
            '\n    <nav aria-label="App versions" class="browser-tools">\n'
            f'      <details><summary>Version {escape(current_version)}</summary>\n'
            f'        <ul>{"".join(links)}</ul>\n'
            '      </details>\n    </nav>'
        )
        final = directory / "final.html"
        final.write_text(final.read_text(encoding="utf-8").replace(
            "</header>", "</header>" + navigation, 1), encoding="utf-8")
        fingerprint = sha256(final.read_bytes()).hexdigest()[:16]
        index = directory / "index.html"
        page = re.sub(r'href="final\.html\?v=[0-9a-f]+"', f'href="final.html?v={fingerprint}"',
                      index.read_text(encoding="utf-8"))
        index.write_text(page.replace("</header>", "</header>" + navigation, 1), encoding="utf-8")


def main():
    repository = os.environ["GITHUB_REPOSITORY"]
    latest = github(f"repos/{repository}/releases/latest", "--jq", ".tag_name")
    if not RELEASE_TAG.fullmatch(latest):
        raise ValueError(f"The latest release must have a vMAJOR.MINOR.PATCH tag, got {latest!r}.")
    published = github(f"repos/{repository}/releases", "--paginate", "--jq",
                       ".[] | select(.draft == false and .prerelease == false) | .tag_name")
    tags = {FIRST_VERSION, latest}
    for tag in published.splitlines():
        match = RELEASE_TAG.fullmatch(tag)
        if match and tuple(map(int, match.groups())) >= (0, 3, 0):
            tags.add(tag)

    with TemporaryDirectory(dir=ROOT) as directory:
        output = Path(directory) / "site"
        build(f"refs/tags/{latest}", output)
        versions = output / "versions"
        shutil.copytree(output, versions / latest, ignore=shutil.ignore_patterns("versions"))
        for tag in sorted(tags - {latest}):
            build(f"refs/tags/{tag}", versions / tag)
        build("HEAD", output / "edge")
        edge_commit = subprocess.check_output(
            ["git", "rev-parse", "--short=8", "HEAD"], cwd=ROOT, text=True).strip()
        add_version_navigation(output, latest, sorted(tags, key=lambda tag: tuple(map(int, tag[1:].split("."))),
                                                      reverse=True), edge_commit)
        dist = ROOT / "dist"
        if dist.exists():
            shutil.rmtree(dist)
        output.rename(dist)


if __name__ == "__main__":
    main()
