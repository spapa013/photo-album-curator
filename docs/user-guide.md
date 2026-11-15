# User guide

Use Photo Album Curator to browse a photo collection, assign photos to destination albums, and arrange each album for export. No photos are uploaded. All photos stay on your device.

- [Set up a workspace](#set-up-a-workspace)
- [Add sources](#add-sources)
- [Assign photos](#assign-photos)
- [Curate destinations](#curate-destinations)
- [Render destination albums](#render-destination-albums)
- [Back up and restore](#back-up-and-restore)
- [Reopen or relink sources](#reopen-or-relink-sources)

## Set up a workspace

Open the app in Chrome or Microsoft Edge. Click **Set Workspace** and choose a folder the app can write to. The app opens or creates `photo_album_curator_data.json` in that folder. It stores your source locations, destinations, photo assignments, inclusion and position choices, and viewing preferences. Choose the same folder with **Set Workspace** when you return.

You can add sources from inside or outside the workspace. The workspace file stores information about the photos. Keep the original folders or ZIPs available for previews and rendering.

## Add sources

1. Click **Add Source**.
2. Set **Album folder depth** in the dialog. The default is **1**.
3. Select **Choose folder** for a photo folder or **Choose ZIP** for one or more ZIP archives.

The depth counts folders from the root of the source. For a `Trip` folder with photos under `City/Day 1/Museum/`:

| Depth | Album for a photo in the Museum folder |
| --- | --- |
| 0 | `Trip` |
| 1 | `Trip/City` |
| 2 | `Trip/City/Day 1` |
| 3 | `Trip/City/Day 1/Museum` |

Photos in shallower folders go into albums named after those folders. Photos directly in the source root go into an album named after the source. Each photo keeps its full path within its source, so identical filenames in different folders stay distinct. ZIPs directly inside a selected folder use the same depth and are grouped separately from the folder’s photos. The depth is saved per source and reused when the source reopens.

The app supports JPEG (including JFIF), PNG, WebP, GIF, BMP, and AVIF. It reads EXIF capture dates from JPEG, PNG, and WebP. Photos with capture dates appear chronologically, with filename as a tiebreaker. Photos without a readable date follow in filename order. Convert HEIC, TIFF, or camera RAW files to a supported format before adding them.

## Assign photos

1. Select a **Source album** and browse with **Previous**, **Next**, **←**, **→**, or the photo dropdown. When you pause, the workspace quietly saves the last photo you viewed so you can pick up there next time.
2. Use **Add a destination** to name a destination album. Destinations are available across all source albums.
3. Check each destination that should get the current photo. Use **All destinations** to make the photo available to every destination. Each photo can have multiple assignments, and changes save automatically.

To rename a destination, click the pencil beside its name, edit the name, and choose **Save**. Its assignments, inclusion choices, and photo order carry over to the new name. Future renders use the new name for the ZIP.

The assignment screen’s progress count shows how many photos in the source album have at least one selection.

## Curate destinations

1. Click **Curate Destination Albums** below **Add a destination**, then choose a destination. Directly assigned photos start included. Photos available only through **All destinations** are eligible for that album and can be included individually.
2. Use **All**, **Included**, **Positioned**, or **Excluded**, or search by filename or source album. Select a photo in the list to preview it. The inclusion count covers the entire destination, even when the visible list is filtered.
3. Use **Include** below the preview to choose whether the photo goes into the ZIP. Included photos show an **Included** badge in the list.
4. Check **Position** to give an included photo the next position. Its number appears to the left of the **Included** badge. Drag positioned rows to reorder them, or enter a number next to **Position** and click **Move**. Uncheck **Position** to return a photo to capture order. Excluding an image also clears its position.

Positioned photos appear first, followed by unpositioned included photos in capture order and then excluded photos. Each destination saves its own inclusion and order choices across source albums.

Use **Previous** and **Next** below the preview or the arrow keys to browse the visible list in order. Use **Reload** to refresh the selected destination from the workspace file.

| Key | Action |
| --- | --- |
| **←** / **→** | Browse the visible photos in their current order |
| **I** | Toggle inclusion for the selected photo |
| **P** | Toggle position for the selected included photo |
| **Esc** | Return to assignments |

## Render destination albums

Choose **Render destination album** for the selected destination or **Render all destination albums** for every destination, then confirm. Each ZIP is written to the workspace’s `destinations/` folder. It contains the included originals across source albums, regardless of the current filter. Filenames have sortable prefixes such as `0001 - `. Positioned photos come first in the ZIP, followed by the remaining included photos in capture order.

**Overwrite previous renders** is checked by default. A confirmed render replaces the ZIP at the destination’s stable filename, such as `Sam.zip`. Clear the checkbox to create timestamped ZIPs and keep earlier renders. The app replaces characters that are unsafe in filenames and adds a destination ID when needed to distinguish otherwise conflicting names.

Batch rendering skips destinations with no included photos and reports any albums it could not render. If an included photo shows **Source missing**, reopen or relink the source to render the album.

## Back up and restore

- **Save backup** writes a project snapshot to `backups/photo_album_curator_data_backup_<timestamp>.json` inside the workspace. It stores project data and source references.
- **Import state** accepts a compatible backup or a `photo_album_curator_data.json` file. The confirmation explains that import will replace the active workspace state. Save a backup first if you want to retain changes absent from the selected file.
- To use the project on another computer, copy the workspace and its source photos. Browser permissions for external sources are specific to the browser and app address. Select those sources again where needed. Older workspace formats require conversion before opening or importing them.

## Reopen or relink sources

Sources stored inside the workspace reopen by relative path when you select the workspace again. Enable **Remember external albums** to let the browser remember access to sources outside the workspace. Use **Reconnect** for a remembered source that needs permission again. With remembering off, reselect the external source from **Add Source** when you return.

If a source folder or ZIP moves or is renamed, click **Relink Source** next to the source album selector or on the missing source’s row. Select the same folder or ZIP at its new location. The workspace retains its album names and depth, and matches saved assignments and positions using paths within the source. If a photo or subfolder inside the source was renamed, its former path remains in the workspace and the app reports missing paths.

Use **Reload albums** to reload the saved album list. To scan the files again after adding photos to a source, select the workspace again or reselect the source.
