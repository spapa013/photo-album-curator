# Photo Album Curator

Create personalized albums from a shared photo collection.

No photos are uploaded. All photos stay on your device

The app runs in your browser on Windows and macOS.

## Open the app

Open the app in Chrome or Microsoft Edge. The hosted app requires no installation. The version switcher lets you choose the latest release, Development, or a previous release. This guide describes the current Development workflow. [Latest release](https://spapa013.github.io/photo-album-curator/) · [Development](https://spapa013.github.io/photo-album-curator/dev/)

For offline use, download `PhotoAlbumCurator-desktop.zip` when available, or build it from source using the instructions below. [GitHub releases](https://github.com/spapa013/photo-album-curator/releases)

1. Install a current release of Python. [Python downloads](https://www.python.org/downloads/)
2. Extract the desktop ZIP and run **StartPhotoAlbumCurator.bat** on Windows or **StartPhotoAlbumCurator.command** on macOS. You can also run `python3 launch.py` on macOS.
3. Open [the local app](http://127.0.0.1:8765/) in Chrome or Microsoft Edge and keep the launcher running.

Both editions use the same browser app and workspace file. Choose the same workspace folder in either edition. The browser grants external album access separately for the hosted and local addresses.

## Set up a workspace

Click **Set Workspace** and choose a folder where the app can write. The app opens or creates `photo_album_curator_data.json` in that folder. Choose the same folder when you return to reopen your saved project.

Use **Add Source** to choose a photo folder or one or more ZIP archives. Set **Album folder depth** in that dialog. Depth **0** puts all photos in one album. The default, depth **1**, groups by the first folder level, such as `Trip/City` and `Trip/Coast`. Depth **2** also gives second-level folders their own albums, such as `Trip/City/Day 1`. Photos in shallower folders go into albums named after those folders.

Each photo keeps its full path within the folder or ZIP. ZIPs directly inside a selected folder use the same depth and are grouped separately from the folder's photos.

The workspace remembers the depth for each source. Sources inside the workspace reopen by relative path. Turn on **Remember external albums** to let this browser remember access to sources outside the workspace. Use **Reconnect** when a remembered source needs permission again.

If a source moves or is renamed, choose **Relink Source** next to the source album selector or on the missing source’s row. Select the same folder or ZIP at its new location. The workspace keeps its album names and depth. Assignments and custom positions follow photos with the same paths within the source. Saved choices for missing paths stay in the workspace.

## Assign photos

- Select a source album and add destinations. Use **All destinations** to let any destination include a photo.
- Browse with **←** and **→**, **Previous**, **Next**, or the photo dropdown. The workspace remembers the last photo you viewed in each source album.
- Check or uncheck destinations to save assignments automatically.

## Files and formats

The app previews JPEG, PNG, WebP, GIF, BMP, and AVIF files. JPEG, PNG, and WebP photos with an EXIF capture date are sorted chronologically. Photos without a readable capture date follow in filename order. Convert HEIC, TIFF, or camera RAW files to a supported format before importing them.

## Destination albums

Open **Curate destinations** and pick a destination. Photos assigned directly to it start included. Shared-only photos are available for every destination and can be included individually. Inclusion and ordering choices save per destination across all source albums.

Use **All**, **Included**, **Positioned**, or **Excluded** to filter the list. Select an included photo and check **Position** below the preview to place it at the end of the positioned group. Drag positioned rows to reorder them, or enter a position below the preview and click **Move**. Use **Clear position** below the preview or exclude a photo to clear its position.

Use **←** and **→** to browse the visible photos in their displayed order.

Positioned photos come first, then unpositioned included photos in capture order, then excluded photos. Photos without capture timestamps follow in filename order within their group.

Use **Render destination album** or **Render all destination albums**, then confirm to save ZIPs in `destinations/` inside the workspace. Each ZIP contains the included originals with sortable prefixes such as `0001 - `. Batch rendering skips destinations without included photos.

**Overwrite previous renders** is checked by default. A confirmed render replaces the ZIP at the destination’s stable filename, such as `Sam.zip`. The app adds a destination ID only when it needs to distinguish filenames. Clear the checkbox to add a timestamp and keep existing ZIPs.

## Back up and restore

**Save backup** writes a snapshot to `backups/photo_album_curator_data_backup_<timestamp>.json` inside the workspace. To restore it, use **Import state**, select the backup or a `photo_album_curator_data.json` file, then confirm the replacement of the active workspace's saved data.

## Build from source

From a source checkout, run `python3 web/build.py` to build the static app and `python3 launch.py` to serve it locally. Run `python3 web/build_desktop.py` to build the offline ZIP. Building downloads the pinned ZIP library. The packaged app runs offline.

The GitHub Pages workflow publishes the latest release, versioned release pages, and Development from `main`.
