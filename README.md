# Photo Album Curator

Create personalized albums from a shared photo collection.

The app runs on Windows and macOS and opens in your browser. Photos, assignments, and rendered albums are stored on your computer.

## Download and start

1. Install Python 3.10 or newer from [python.org](https://www.python.org/downloads/).
2. On GitHub, choose **Code → Download ZIP** and extract it. Use a folder you can write to.
3. On Windows, double-click **Start Wedding Sorter.bat**. On macOS, double-click **Start Wedding Sorter.command**. You can also run `python3 wedding_sorter.py` from the extracted folder in Terminal on macOS.
4. Open [the local sorter](http://127.0.0.1:8765/) if it does not open automatically. Keep the launcher running while you sort.
5. Put album ZIPs, folders, or loose photos in the `Albums` folder the app creates. Click **Reload albums** to find them. The sorter previews photos directly from the source, including ZIPs.

The app runs on your computer and uses a loopback address. You can use it offline after downloading the app and installing Python.

## Assign photos

- Select a source album and add the guests you want to sort for. Guest albums and the **Shared album** are available across all source albums.
- Browse with **←** and **→**, **Previous**, **Next**, or the photo dropdown. The browser remembers the last photo you viewed in each album.
- Check or uncheck any destinations to save the selection immediately. A photo with no selections has zero destinations.
- The database stores the selected destination albums for later rendering.

## Printing

- **Copies already printed** starts at zero for each photo and saves automatically when you change it.
- Open **Print list** for the whole album. It counts one print per assigned guest and treats the Shared album as digital. **Still to print** subtracts copies already printed, with a minimum of zero. Select a photo name in the list to jump to it.

## Files and formats

The workspace's `Wedding Sorter.sqlite3` stores destination albums, assignments, print counts, and saved positions. Keep it alongside `Albums` and keep source paths stable to retain progress.

On first startup, the sorter imports existing progress from the old `Sorted` databases. Once the import is verified, the old `Sorted` folder can be deleted.

The sorter previews JPEG, PNG, WebP, GIF, BMP, and AVIF files. JPEG, PNG, and WebP photos with an EXIF capture date are sorted chronologically. Photos without a readable capture date follow in filename order. Convert HEIC, TIFF, or camera RAW files to a supported format before importing them.

## Final albums

Open **Final albums** and pick a guest. Their assigned photos start included. Shared-only photos are available for every guest and can be included individually. Inclusion and ordering choices save per guest across all source albums.

Select a photo to set or clear a custom position. Numbered photos come first, followed by included photos in capture order. Photos without capture timestamps follow in filename order.

**Render album** creates a folder such as `Final Albums/Sam/Render 001`. Each image gets a sortable prefix such as `0001 - `. A later render creates the next numbered folder so you can keep earlier versions.

## Use in your browser

Open [Photo Album Curator on GitHub Pages](https://spapa013.github.io/photo-album-curator/). Use **Open ZIP** to select one or more archives or **Open folder** to select a photo folder. Selecting the desktop app's entire `Albums` folder opens its subfolders and ZIPs as separate albums. The website serves the app code. Reading photos, editing assignments, and creating ZIPs happen on your device.

In Chrome or Edge, click **Set Workspace** and choose a folder where the app can write. The app opens or creates `Photo Album Curator.json` there. Select that folder again when you return. The file holds guests, assignments, print counts, final-album choices, source locations, and viewing preferences.

Use **Open folder** or **Open ZIP** to add photos from any location. Sources inside the workspace reopen by relative path. Turn on **Remember external albums** to store access handles for outside sources in this browser, subject to browser permissions. Use **Reconnect** if an external source needs permission again. With the option off, reselect external sources when you return.

To move over from v0.1.0, select **Import progress** and choose `Wedding Sorter.sqlite3` from your desktop workspace. Import replaces the active project's assignments, guests, print counts, and final-album choices. Use **Download backup** to save a portable copy of project data.

In **Final albums**, choose a guest and select **Download ZIP**. The archive contains the included originals with numbered filenames. Browsers that offer a save dialog can stream the archive directly to disk. Other browsers assemble the ZIP before downloading, which may limit very large exports.

The main URL serves the latest GitHub release. Use [v0.3.0](https://spapa013.github.io/photo-album-curator/versions/v0.3.0/) for that fixed release, or [Edge](https://spapa013.github.io/photo-album-curator/edge/) for the current build from `main`. All three use project file format version 1.

To build a single static app locally, run `python3 web/build.py` and serve `dist/` over HTTP. The GitHub Pages workflow assembles the latest release, versioned releases starting at v0.3.0, and Edge into one artifact.
