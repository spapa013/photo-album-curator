"""Build a single Pages artifact containing the stable, pinned, and edge apps."""

from io import BytesIO
import os
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
        dist = ROOT / "dist"
        if dist.exists():
            shutil.rmtree(dist)
        output.rename(dist)


if __name__ == "__main__":
    main()
