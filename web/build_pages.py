"""Build a single Pages artifact containing the stable, pinned, and development apps."""

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

from build_guide import build_guide


ROOT = Path(__file__).resolve().parents[1]
FIRST_VERSION = "v0.3.0"
RELEASE_TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def github(*args):
    return subprocess.check_output(["gh", "api", *args], cwd=ROOT, text=True).strip()


def build(ref, destination, version):
    print(f"Building {ref} for {destination.name}", flush=True)
    source = subprocess.check_output(["git", "archive", "--format=tar", ref], cwd=ROOT)
    with TemporaryDirectory() as directory:
        checkout = Path(directory)
        with open_tar(fileobj=BytesIO(source)) as archive:
            archive.extractall(checkout, filter="data")
        environment = os.environ.copy()
        environment.pop("GH_TOKEN", None)
        environment["CURATOR_BUILD_LABEL"] = version
        subprocess.run([sys.executable, "web/build.py"], cwd=checkout, env=environment, check=True)
        built = checkout / "dist"
        if not (built / "user-guide" / "index.html").is_file():
            readme = (checkout / "README.md").read_text(encoding="utf-8")
            _, _, body = readme.partition("\n")
            body = body.replace("](https://spapa013.github.io/photo-album-curator/)", "](../)")
            guide = "# User guide\n\nThese instructions come from this release’s README.\n" + body
            build_guide(guide, built, version)
        shutil.copytree(built, destination)


def add_version_navigation(output, latest, tags, development_commit):
    development = output / "dev"
    releases = {output / "versions" / tag: tag for tag in tags}
    stylesheet = ROOT / "web" / "versions.css"
    shutil.copyfile(stylesheet, output / stylesheet.name)
    css_version = sha256(stylesheet.read_bytes()).hexdigest()[:16]

    for directory in (output, development, *releases):
        def link(target, label):
            href = Path(relpath(target, directory)).as_posix() + "/"
            current = ' aria-current="page"' if target == directory else ""
            return f'<a href="{escape(href)}" target="_top"{current}>{escape(label)}</a>'

        label = "Select previous version" + (f" ({releases[directory]})" if directory in releases else "")
        release_links = "".join(f"<li>{link(target, tag)}</li>" for target, tag in releases.items())
        description = f'<small>Build {escape(development_commit)}</small>' if directory == development else ""
        navigation = (
            '    <nav aria-label="App versions" class="version-nav">\n'
            f'      {link(output, f"Latest Release ({latest})")}\n'
            '      <span aria-hidden="true">–</span>\n'
            f'      {link(development, "Development")}\n'
            '      <span aria-hidden="true">–</span>\n'
            f'      <details><summary>{escape(label)}</summary><ul>{release_links}</ul></details>\n'
            f'      {description}\n'
            '    </nav>\n'
        )
        css = Path(relpath(output / stylesheet.name, directory)).as_posix()
        css_link = f'<link rel="stylesheet" href="{escape(css)}?v={css_version}">\n'
        final = directory / "final.html"
        index = directory / "index.html"
        for path in (final, index):
            page = path.read_text(encoding="utf-8").replace("</head>", css_link + "</head>", 1)
            if 'href="user-guide/"' not in page:
                guide_link = (
                    '      <a class="button-link" href="user-guide/" target="_blank" rel="noopener">User guide</a>\n'
                )
                page = page.replace("    </header>", guide_link + "    </header>", 1)
            path.write_text(page.replace("    <header", navigation + "    <header", 1), encoding="utf-8")
        fingerprint = sha256(final.read_bytes()).hexdigest()[:16]
        page = re.sub(r'href="final\.html\?v=[0-9a-f]+"', f'href="final.html?v={fingerprint}"',
                      index.read_text(encoding="utf-8"))
        index.write_text(page, encoding="utf-8")


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
        build(f"refs/tags/{latest}", output, latest)
        versions = output / "versions"
        shutil.copytree(output, versions / latest, ignore=shutil.ignore_patterns("versions"))
        for tag in sorted(tags - {latest}):
            build(f"refs/tags/{tag}", versions / tag, tag)
        development_commit = subprocess.check_output(
            ["git", "rev-parse", "--short=8", "HEAD"], cwd=ROOT, text=True).strip()
        build("HEAD", output / "dev", f"Development ({development_commit})")
        add_version_navigation(output, latest, sorted(tags, key=lambda tag: tuple(map(int, tag[1:].split("."))),
                                                      reverse=True), development_commit)
        dist = ROOT / "dist"
        if dist.exists():
            shutil.rmtree(dist)
        output.rename(dist)


if __name__ == "__main__":
    main()
