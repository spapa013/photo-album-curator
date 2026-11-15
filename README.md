# Photo Album Curator

Create personalized albums from a shared photo collection.

No photos are uploaded. All photos stay on your device.

## Open the app

Open the app in Chrome or Microsoft Edge on Windows or macOS. The hosted app requires no installation. Its version switcher lets you choose the latest release, Development, or a previous release. [Latest release](https://spapa013.github.io/photo-album-curator/) · [Development](https://spapa013.github.io/photo-album-curator/dev/)

For offline use, install Python and get `PhotoAlbumCurator-desktop.zip` from GitHub Releases when available, or build it from source. Extract it and run `StartPhotoAlbumCurator.bat` on Windows or `StartPhotoAlbumCurator.command` on macOS. Open the address printed by the launcher in Chrome or Microsoft Edge and keep the launcher running. [Python downloads](https://www.python.org/downloads/) · [GitHub releases](https://github.com/spapa013/photo-album-curator/releases)

## Build from Source

Run `python3 web/build.py` to build the app in `dist/`, then `python3 launch.py` to serve it locally. Run `python3 web/build_desktop.py` to create the offline ZIP. Building downloads the pinned ZIP library and Markdown renderer.

## How to Use

[Read the user guide](docs/user-guide.md)
