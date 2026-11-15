"""Package the local launcher and the standard browser build for offline use."""

from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "PhotoAlbumCurator-desktop.zip"


def main():
    with TemporaryDirectory() as directory:
        site = Path(directory) / "dist"
        subprocess.run([sys.executable, str(ROOT / "web" / "build.py"), "--output", str(site)], check=True)
        with ZipFile(PACKAGE, "w", compression=ZIP_DEFLATED) as archive:
            for name in ("launch.py", "StartPhotoAlbumCurator.bat", "StartPhotoAlbumCurator.command", "README.md",
                         "docs/user-guide.md"):
                source = ROOT / name
                entry = ZipInfo.from_file(source, f"PhotoAlbumCurator/{name}")
                if source.suffix == ".command":
                    entry.create_system = 3
                    entry.external_attr |= 0o111 << 16
                archive.writestr(entry, source.read_bytes(), compress_type=ZIP_DEFLATED)
            for path in sorted(site.rglob("*")):
                if path.is_file():
                    archive.write(path, f"PhotoAlbumCurator/dist/{path.relative_to(site).as_posix()}")
    print(PACKAGE)


if __name__ == "__main__":
    main()
