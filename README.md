# Photo Album Curator

Create personalized albums from a shared photo collection.

The app runs on Windows and macOS and opens in your browser. Photos, assignments, and rendered albums are stored on your computer.

## Open the app

Use [Photo Album Curator on GitHub Pages](https://spapa013.github.io/photo-album-curator/) in Chrome or Edge.

For offline use, download `PhotoAlbumCurator-desktop.zip` from the [releases page](https://github.com/spapa013/photo-album-curator/releases) starting with v0.4.0.

1. Install Python 3.10 or newer from [python.org](https://www.python.org/downloads/).
2. Extract the desktop ZIP and run **Start Wedding Sorter.bat** on Windows or **Start Wedding Sorter.command** on macOS. You can also run `python3 launch.py` on macOS.
3. Open [the local app](http://127.0.0.1:8765/) in Chrome or Edge and keep the launcher running.

Both editions use the same browser app and workspace file. Choose the same workspace folder in either edition. The browser grants external album access separately for the hosted and local addresses.

## Set up a workspace

Click **Set Workspace** and choose a folder where the app can write. The app opens or creates `photo_album_curator_data.json`. For a v0.3.0 folder project, rename `Photo Album Curator.json` to the new name before selecting the folder in Edge or v0.4.0.

Use **Add Source Album** to choose a photo folder or one or more ZIP archives. Selecting an entire folder named `Albums` opens its subfolders and ZIPs as separate albums. Sources inside the workspace reopen by relative path. Turn on **Remember external albums** to store access handles in this browser. Use **Reconnect** when a source needs permission again.

## Assign photos

- Select a source album and add destinations. Use **Make available to all destination albums** to let any destination include a photo.
- Browse with **←** and **→**, **Previous**, **Next**, or the photo dropdown. The browser remembers the last photo you viewed in each album.
- Check or uncheck any destinations to save the selection immediately. A photo with no selections has zero destinations.
- The workspace file stores the selected destinations for export.

## Printing

- **Copies already printed** starts at zero for each photo and saves automatically when you change it.
- Open **Print list** for the whole album. It counts one print per assigned destination. **Still to print** subtracts copies already printed, with a minimum of zero. Select a photo name in the list to jump to it.

## Files and formats

The sorter previews JPEG, PNG, WebP, GIF, BMP, and AVIF files. JPEG, PNG, and WebP photos with an EXIF capture date are sorted chronologically. Photos without a readable capture date follow in filename order. Convert HEIC, TIFF, or camera RAW files to a supported format before importing them.

## Final albums

Open **Final albums** and pick a guest. Their assigned photos start included. Shared-only photos are available for every guest and can be included individually. Inclusion and ordering choices save per guest across all source albums.

Select a photo to set or clear a custom position. Numbered photos come first, followed by included photos in capture order. Photos without capture timestamps follow in filename order.

Click **Download ZIP** to export the included originals with sortable prefixes such as `0001 - `. Browsers that offer a save dialog can stream the archive directly to disk.

## Back up and restore

**Download backup** writes a snapshot to `backups/photo_album_curator_data_backup_<timestamp>.json` inside the workspace. To restore it, use **Import progress**, select the backup or a `photo_album_curator_data.json` file, then confirm the replacement of the active workspace's saved data.

## Versions and builds

The main URL serves the latest GitHub release. Use [v0.3.0](https://spapa013.github.io/photo-album-curator/versions/v0.3.0/) for that fixed release, or [Edge](https://spapa013.github.io/photo-album-curator/edge/) for the current build from `main`. All three use project file format version 1.

From a source checkout, run `python3 web/build.py` to build the static app and `python3 launch.py` to serve it locally. Run `python3 web/build_desktop.py` to build the offline ZIP. Building downloads the pinned ZIP library. The packaged app runs offline.

The GitHub Pages workflow assembles the latest release, versioned releases starting at v0.3.0, and Edge into one artifact.
