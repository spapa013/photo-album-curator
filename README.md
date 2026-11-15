# Photo Album Curator

Create personalized albums from a shared photo collection.

The app runs on Windows and macOS and opens in your browser. Photos, assignments, and rendered albums are stored on your computer.

## Open the app

Use [Photo Album Curator on GitHub Pages](https://spapa013.github.io/photo-album-curator/) in Chrome or Microsoft Edge.

For offline use, download `PhotoAlbumCurator-desktop.zip` from the [releases page](https://github.com/spapa013/photo-album-curator/releases) starting with v0.4.0.

1. Install Python 3.10 or newer from [python.org](https://www.python.org/downloads/).
2. Extract the desktop ZIP and run **StartPhotoAlbumCurator.bat** on Windows or **StartPhotoAlbumCurator.command** on macOS. You can also run `python3 launch.py` on macOS.
3. Open [the local app](http://127.0.0.1:8765/) in Chrome or Microsoft Edge and keep the launcher running.

Both editions use the same browser app and workspace file. Choose the same workspace folder in either edition. The browser grants external album access separately for the hosted and local addresses.

## Set up a workspace

Click **Set Workspace** and choose a folder where the app can write. The app opens or creates `photo_album_curator_data.json`. For a v0.3.0 folder project, rename its existing project JSON to this filename before selecting the folder in Development or v0.4.0.

Use **Add Source Album** to choose a photo folder or one or more ZIP archives. Selecting an entire folder named `Albums` opens its subfolders and ZIPs as separate albums. Sources inside the workspace reopen by relative path. Turn on **Remember external albums** to store access handles in this browser. Use **Reconnect** when a source needs permission again.

## Assign photos

- Select a source album and add destinations. Use **All destinations** to let any destination include a photo.
- Browse with **←** and **→**, **Previous**, **Next**, or the photo dropdown. The browser remembers the last photo you viewed in each album.
- Check or uncheck any destinations to save the selection immediately. A photo with no selections has zero destinations.
- The workspace file stores the selected destinations for export.

## Printing

- **Copies already printed** starts at zero for each photo and saves automatically when you change it.
- Open **Print list** for the whole album. It counts one print per assigned destination. **Still to print** subtracts copies already printed, with a minimum of zero. Select a photo name in the list to jump to it.

## Files and formats

The sorter previews JPEG, PNG, WebP, GIF, BMP, and AVIF files. JPEG, PNG, and WebP photos with an EXIF capture date are sorted chronologically. Photos without a readable capture date follow in filename order. Convert HEIC, TIFF, or camera RAW files to a supported format before importing them.

## Destination albums

Open **Curate destination albums** and pick a destination. Photos assigned directly to it start included. Shared-only photos are available for every destination and can be included individually. Inclusion and ordering choices save per destination across all source albums.

Use **Included**, **Positioned**, or **Excluded** to filter the photo list. Select an included photo to set or clear a custom position. Numbered photos come first, followed by included photos in capture order. Photos without capture timestamps follow in filename order.

Use **Render destination album** or **Render all destination albums** to save ZIPs in `destinations/` inside the workspace. Each ZIP contains the included originals with sortable prefixes such as `0001 - `. Batch rendering skips destinations without included photos.

**Overwrite previous renders** is checked by default. A confirmed render replaces the ZIP at the destination’s stable filename, such as `Sam [1].zip`. Clear the checkbox to add a timestamp and keep existing ZIPs. The destination ID keeps filenames distinct when names sanitize to the same text.

## Back up and restore

**Download backup** writes a snapshot to `backups/photo_album_curator_data_backup_<timestamp>.json` inside the workspace. To restore it, use **Import progress**, select the backup or a `photo_album_curator_data.json` file, then confirm the replacement of the active workspace's saved data.

## Versions and builds

The main URL serves the latest GitHub release. Use [v0.3.0](https://spapa013.github.io/photo-album-curator/versions/v0.3.0/) for that fixed release, or [Development](https://spapa013.github.io/photo-album-curator/dev/) for the current build from `main`. All three use project file format version 1.

From a source checkout, run `python3 web/build.py` to build the static app and `python3 launch.py` to serve it locally. Run `python3 web/build_desktop.py` to build the offline ZIP. Building downloads the pinned ZIP library. The packaged app runs offline.

The GitHub Pages workflow assembles the latest release, versioned releases starting at v0.3.0, and Development into one artifact.
