"use strict";

(() => {
  if (!document.getElementById("album")) {
    if (window.parent !== window && window.parent.browserCurator) {
      window.browserCurator = window.parent.browserCurator;
    } else {
      window.location.replace("./");
    }
    return;
  }

  let sources = new Map();
  let disk = null;
  let externalHandles = new Map();
  const projectFilename = "photo_album_curator_data.json";
  const diskLock = "photo-album-curator-workspace-file";
  const photoType = /\.(jpe?g|jfif|png|webp|gif|bmp|avif)$/i;
  const basename = (path) => path.split("/").at(-1);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const folded = (value) => value.normalize("NFC").toLowerCase();
  const comparePhotos = (a, b) => compare(a.date ?? "~", b.date ?? "~") ||
    compare(folded(basename(a.path)), folded(basename(b.path))) ||
    compare(folded(a.album ?? ""), folded(b.album ?? "")) ||
    compare(folded(a.path), folded(b.path)) || compare(a.path, b.path) ||
    compare(a.album ?? "", b.album ?? "");
  const projectDefault = () => ({format: "photo-album-curator", version: 1, guests: [], albums: [], choices: []});
  let handlesDatabase;
  function openHandlesDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("photo-album-curator-project", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("settings");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  zip.configure({useWebWorkers: false});

  async function handleSetting(key, fallback, update) {
    handlesDatabase ??= openHandlesDatabase();
    const db = await handlesDatabase;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("settings", update ? "readwrite" : "readonly");
      const settings = transaction.objectStore("settings");
      const request = settings.get(key);
      let value;
      let error;
      request.onsuccess = () => {
        try {
          value = request.result ?? fallback;
          if (update) {
            value = update(value) ?? value;
            settings.put(value, key);
          }
        } catch (problem) {
          error = problem;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(error ?? transaction.error ?? new Error("Could not save progress."));
    });
  }

  function project(update) {
    if (!disk) throw new Error("Set Workspace to open a project folder.");
    const target = disk;
    return navigator.locks.request(diskLock, async () => {
      const state = await readWorkspaceFile(target.file);
      if (state.workspace?.id !== target.state.workspace.id) {
        throw new Error("The project file changed. Set Workspace again.");
      }
      if (update) {
        const next = update(state) ?? state;
        await writeWorkspaceFile(target.file, next);
        target.state = next;
      } else {
        target.state = state;
      }
      return target.state;
    });
  }

  function preference(key, value) {
    if (value === undefined) return disk?.state.workspace.preferences[key] ?? null;
    return project((state) => { state.workspace.preferences[key] = String(value); });
  }

  async function readWorkspaceFile(handle) {
    const state = JSON.parse(await (await handle.getFile()).text());
    if (!validBackup(state)) throw new Error(handle.name + " is not a valid Curator project.");
    return state;
  }

  async function writeWorkspaceFile(handle, state) {
    const writer = await handle.createWritable();
    try {
      await writer.write(JSON.stringify(state, null, 2) + "\n");
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }

  async function setWorkspace(progress) {
    const folder = await window.showDirectoryPicker({mode: "readwrite", id: "curator-workspace"});
    const opened = await navigator.locks.request(diskLock, async () => {
      let file;
      try {
        file = await folder.getFileHandle(projectFilename);
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
        file = await folder.getFileHandle(projectFilename, {create: true});
      }
      const state = (await file.getFile()).size ? await readWorkspaceFile(file) : projectDefault();
      if (!state.workspace) {
        state.workspace = {id: crypto.randomUUID(), rememberExternal: false, sources: [], preferences: {}};
        await writeWorkspaceFile(file, state);
      }
      return {folder, file, state};
    });
    disk = opened;
    sources = new Map();
    externalHandles = new Map();
    await restoreSources(progress);
    return diskStatus();
  }

  function diskStatus() {
    if (!disk) return null;
    const {rememberExternal, sources: records} = disk.state.workspace;
    return {name: disk.folder.name, filename: disk.file.name, rememberExternal, sources: records.map((record) => ({
      id: record.id, name: record.name,
      available: record.albums.length > 0 && record.albums.every((key) => sources.has(key)),
      reconnect: record.relative === null && rememberExternal && externalHandles.has(sourceHandleId(record)),
    }))};
  }

  function sourceForAlbum(album) {
    return disk?.state.workspace.sources.find((record) => record.albums.includes(album))?.id;
  }

  const sourceHandleId = (record) => record.handleId ?? record.id;
  const handlesKey = (id) => `workspace-handles:${id}`;

  async function saveHandles(state) {
    await navigator.locks.request(diskLock, async () => {
      const current = await readWorkspaceFile(disk.file);
      if (current.workspace.id !== state.workspace.id || !current.workspace.rememberExternal) return;
      await handleSetting(handlesKey(state.workspace.id), null, (previous) =>
        new Map([...(previous ?? []), ...externalHandles]));
    });
  }

  async function rememberExternal(enabled) {
    const target = disk;
    if (!target) return;
    const state = await project((state) => { state.workspace.rememberExternal = enabled; });
    if (enabled) await saveHandles(state);
    else await navigator.locks.request(diskLock, async () => {
      const current = await readWorkspaceFile(target.file);
      if (!current.workspace.rememberExternal) {
        await handleSetting(handlesKey(state.workspace.id), null, () => new Map());
      }
    });
  }

  const validAlbumDepth = (depth) => Number.isSafeInteger(depth) && depth >= 0;

  function sourceDepth(record) {
    if (record.albumFolderDepth !== undefined) return record.albumFolderDepth;
    if (record.mergeSubfolders !== undefined) return record.mergeSubfolders ? 0 : 1;
  }

  async function scanSource(handle, kind, depth, progress, sourceName = handle.name) {
    if (kind === "folder") return scanFolder(handle, depth, progress, sourceName);
    const groups = new Map();
    await groupArchive(groups, await handle.getFile(), depth, sourceName);
    return scanGroups(groups, progress);
  }

  function registerAlbums(state, record, opened) {
    const conflict = state.workspace.sources.find((item) => item !== record &&
      item.albums.some((key) => opened.has(key)));
    if (conflict) throw new Error("An album with that name is linked to " + conflict.name + ".");
    record.albums = Array.from(new Set([...record.albums, ...opened.keys()]));
    updateAlbums(state, opened);
  }

  function updateOpenSource(record, opened) {
    for (const key of record.albums) sources.delete(key);
    for (const [key, photos] of opened) sources.set(key, photos);
  }

  function matchesLocation(record, kind, name, relative) {
    if (record.kind !== kind) return false;
    return relative !== null ? JSON.stringify(record.relative) === JSON.stringify(relative)
      : record.relative === null && record.name === name;
  }

  async function connectSource(handle, kind, depth, progress) {
    const relative = await disk.folder.resolve(handle);
    const sameSource = (record) => matchesLocation(record, kind, handle.name, relative);
    const previous = (await project()).workspace.sources.find(sameSource);
    const grouping = previous ? sourceDepth(previous) : depth;
    const opened = await scanSource(handle, kind, grouping, progress, previous?.albumRoot);
    const state = await project((state) => {
      const records = state.workspace.sources;
      let record = records.find(sameSource);
      if ((previous && (record?.id !== previous.id || sourceHandleId(record) !== sourceHandleId(previous))) ||
          (record && sourceDepth(record) !== grouping)) {
        throw new Error("The source changed in the workspace. Use Add Source again.");
      }
      if (!record) {
        record = {id: crypto.randomUUID(), kind, name: handle.name, relative, albums: [], albumFolderDepth: grouping};
        records.push(record);
      }
      registerAlbums(state, record, opened);
    });
    const record = state.workspace.sources.find(sameSource);
    if (relative === null) {
      externalHandles.set(sourceHandleId(record), handle);
      if (state.workspace.rememberExternal) await saveHandles(state);
    }
    updateOpenSource(record, opened);
    return [...opened.keys()];
  }

  async function pickSources(kind, multiple) {
    return kind === "folder"
      ? [await window.showDirectoryPicker({mode: "read", id: "curator-albums"})]
      : window.showOpenFilePicker({multiple, id: "curator-zips",
        types: [{description: "ZIP archive", accept: {"application/zip": [".zip"]}}]});
  }

  async function chooseSource(kind, progress, depth = 1) {
    if (!validAlbumDepth(depth)) throw new Error("Enter a whole number of folders, starting at zero.");
    const handles = await pickSources(kind, true);
    const opened = [];
    for (const handle of handles) opened.push(...await connectSource(handle, kind, depth, progress));
    return opened;
  }

  async function relativeHandle(record) {
    let handle = disk.folder;
    for (const [index, name] of record.relative.entries()) {
      handle = record.kind === "zip" && index === record.relative.length - 1
        ? await handle.getFileHandle(name) : await handle.getDirectoryHandle(name);
    }
    return handle;
  }

  async function refreshSource(record, handle, progress) {
    const depth = sourceDepth(record);
    const opened = await scanSource(handle, record.kind, depth, progress, record.albumRoot);
    const state = await project((state) => {
      const current = state.workspace.sources.find(({id}) => id === record.id);
      if (!current || sourceHandleId(current) !== sourceHandleId(record) || sourceDepth(current) !== depth) {
        throw new Error("The source changed in the workspace. Set Workspace again.");
      }
      registerAlbums(state, current, opened);
    });
    updateOpenSource(state.workspace.sources.find(({id}) => id === record.id), opened);
  }

  async function restoreSources(progress) {
    const {workspace} = disk.state;
    if (workspace.rememberExternal) {
      const saved = await handleSetting(handlesKey(workspace.id), null).catch(() => null);
      for (const [id, handle] of saved ?? []) externalHandles.set(id, handle);
    }
    for (const record of workspace.sources) {
      try {
        const handle = record.relative === null ? externalHandles.get(sourceHandleId(record)) : await relativeHandle(record);
        if (handle && await handle.queryPermission({mode: "read"}) === "granted") {
          await refreshSource(record, handle, progress);
        }
      } catch {
        // The source remains listed so the user can reconnect it after a move or permission change.
      }
    }
  }

  async function reconnectSource(id, progress) {
    const record = disk.state.workspace.sources.find((item) => item.id === id);
    if (!record) return;
    const handle = externalHandles.get(sourceHandleId(record));
    if (handle && await handle.requestPermission({mode: "read"}) === "granted") {
      await refreshSource(record, handle, progress);
    }
  }

  async function relinkSource(id, progress) {
    const workspace = disk;
    const record = workspace?.state.workspace.sources.find((item) => item.id === id);
    if (!record) throw new Error("Choose a source to relink.");
    const [handle] = await pickSources(record.kind, false);
    const relative = await workspace.folder.resolve(handle);
    const albumRoot = record.albumRoot ?? record.name;
    const opened = await scanSource(handle, record.kind, sourceDepth(record), progress, albumRoot);
    if (!opened.size) throw new Error("The replacement source has no supported photos.");
    if (disk !== workspace) throw new Error("Reopen the workspace and relink the source again.");

    let missing = 0;
    const state = await project((state) => {
      const records = state.workspace.sources;
      const current = records.find((item) => item.id === id);
      if (!current || sourceHandleId(current) !== sourceHandleId(record) || sourceDepth(current) !== sourceDepth(record)) {
        throw new Error("The source changed in the workspace. Set Workspace again.");
      }
      if (records.some((item) => item !== current && matchesLocation(item, record.kind, handle.name, relative))) {
        throw new Error("The replacement is already linked to another source in this workspace.");
      }
      let matched = 0;
      for (const album of state.albums) {
        if (!current.albums.includes(album.key)) continue;
        const paths = new Set([...album.photos.map(({path}) => path), ...album.reviews.map(([path]) => path)]);
        for (const path of paths) {
          if (opened.get(album.key)?.has(path)) matched++;
          else missing++;
        }
        album.revision++;
      }
      if (missing && !matched) throw new Error("The replacement contains none of this source’s saved photo paths.");
      registerAlbums(state, current, opened);
      // Keep the album keys, but give the new browser handle its own storage key.
      Object.assign(current, {name: handle.name, relative, albumRoot, handleId: crypto.randomUUID()});
    });
    const current = state.workspace.sources.find((item) => item.id === id);
    externalHandles.delete(sourceHandleId(record));
    updateOpenSource(current, opened);
    if (relative === null) {
      externalHandles.set(sourceHandleId(current), handle);
      if (state.workspace.rememberExternal) await saveHandles(state);
    }
    return missing;
  }

  function captureDate(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
    function exif(start, end) {
      if (ascii(start, 6) === "Exif\0\0") start += 6;
      const little = ascii(start, 2) === "II";
      if (!little && ascii(start, 2) !== "MM") return null;
      const short = (offset) => view.getUint16(start + offset, little);
      const long = (offset) => view.getUint32(start + offset, little);
      const find = (offset, tag) => {
        const count = short(offset);
        if (start + offset + 2 + 12 * count > end) return null;
        for (let index = 0; index < count; index++) {
          const entry = offset + 2 + 12 * index;
          if (short(entry) === tag) return entry;
        }
        return null;
      };
      if (short(2) !== 42) return null;
      const pointer = find(long(4), 0x8769);
      const entry = pointer === null ? null : find(long(pointer + 8), 0x9003);
      if (entry === null) return null;
      const offset = start + long(entry + 8);
      if (offset + 19 > end) return null;
      const date = ascii(offset, 19);
      return /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(date)
        ? date.slice(0, 10).replaceAll(":", "-") + "T" + date.slice(11) : null;
    }
    try {
      if (view.getUint16(0) === 0xffd8) {
        let offset = 2;
        while (bytes[offset++] === 0xff) {
          while (bytes[offset] === 0xff) offset++;
          const marker = bytes[offset++];
          if (marker === 0xda || marker === 0xd9) break;
          const end = offset + view.getUint16(offset);
          if (end <= offset || end > bytes.length) break;
          if (marker === 0xe1 && ascii(offset + 2, 6) === "Exif\0\0") {
            const date = exif(offset + 2, end);
            if (date) return date;
          }
          offset = end;
        }
      } else {
        const png = view.getUint32(0) === 0x89504e47;
        const webp = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
        if (png || webp) {
          let offset = png ? 8 : 12;
          while (offset + 8 <= bytes.length) {
            const name = ascii(offset + (png ? 4 : 0), 4);
            const size = view.getUint32(offset + (png ? 0 : 4), webp);
            const end = offset + 8 + size;
            if (end > bytes.length) break;
            if (name === (png ? "eXIf" : "EXIF")) return exif(offset + 8, end);
            offset = end + (png ? 4 : size % 2);
          }
        }
      }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    return null;
  }

  const metadataLimit = 256 * 1024;
  async function zipPrefix(entry) {
    const buffer = new Uint8Array(Math.min(metadataLimit, entry.uncompressedSize));
    let length = 0;
    const enough = new Error("Metadata prefix read");
    const writable = new WritableStream({
      write(chunk) {
        const remaining = buffer.length - length;
        const part = chunk.subarray(0, remaining);
        buffer.set(part, length);
        length += part.length;
        if (length === buffer.length && entry.uncompressedSize > length) throw enough;
      },
    });
    try {
      await entry.getData(writable);
    } catch (error) {
      if (error !== enough) throw error;
    }
    return buffer.subarray(0, length);
  }

  function groupPhotos(groups, photos, sourceName, depth, legacyFolder = false) {
    const albums = new Map();
    for (const photo of photos) {
      let key = sourceName;
      let entry = photo;
      if (legacyFolder) {
        const slash = photo.path.indexOf("/");
        key = slash < 0 ? "" : photo.path.slice(0, slash);
        entry = {...photo, path: photo.path.slice(slash + 1)};
      } else if (depth > 0) {
        const parts = photo.path.split("/");
        const folder = parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
        if (folder) key = sourceName + "/" + folder;
      }
      if (!albums.has(key)) albums.set(key, []);
      albums.get(key).push(entry);
    }
    for (const [key, entries] of albums) {
      if (groups.has(key)) throw new Error("Two albums use the name " + key + ".");
      groups.set(key, entries);
    }
  }

  async function scanGroups(groups, progress) {
    const opened = new Map();
    let total = 0;
    for (const [key, candidates] of groups) {
      const photos = new Map();
      const seen = new Set();
      for (const photo of candidates) {
        if (photo.path.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
          throw new Error("Invalid photo path in " + (key || "Albums") + ".");
        }
        const normalized = folded(photo.path);
        if (seen.has(normalized)) throw new Error("Duplicate photo path in " + (key || "Albums") + ": " + photo.path);
        seen.add(normalized);
        if (total++ % 30 === 0) progress("Reading photo metadata… " + total);
        try {
          if (/\.(jpe?g|jfif|png|webp)$/i.test(photo.path)) {
            const bytes = photo.file ? new Uint8Array(await photo.file.slice(0, metadataLimit).arrayBuffer())
              : await zipPrefix(photo.entry);
            photo.date = captureDate(bytes);
          }
        } catch (error) {
          throw new Error("Could not read " + photo.path + ": " + error.message);
        }
        photos.set(photo.path, photo);
      }
      if (photos.size) opened.set(key, photos);
    }
    return opened;
  }

  function updateAlbums(state, opened) {
    for (const [key, photos] of opened) {
      const album = addAlbum(state, key);
      album.photos = Array.from(photos.values(), ({path, date}) => ({path, date: date ?? null}));
    }
  }

  async function scanFolder(folder, depth, progress, sourceName) {
    const photos = [];
    const archives = [];
    async function collect(directory, prefix) {
      for await (const entry of directory.values()) {
        if (entry.kind === "directory") {
          await collect(entry, prefix + entry.name + "/");
        } else if (photoType.test(entry.name)) {
          photos.push({path: prefix + entry.name, file: await entry.getFile()});
        } else if (!prefix && /\.zip$/i.test(entry.name)) {
          archives.push(await entry.getFile());
        }
      }
    }
    await collect(folder, "");
    const groups = new Map();
    // Older workspaces use album keys and photo paths from the original grouping rules.
    const legacyFolder = depth === undefined && sourceName.toLowerCase() === "albums";
    groupPhotos(groups, photos, sourceName, depth, legacyFolder);
    for (const file of archives) await groupArchive(groups, file, depth);
    return scanGroups(groups, progress);
  }

  async function groupArchive(groups, file, depth, sourceName = file.name) {
    if (!/\.zip$/i.test(file.name)) return;
    const archive = new zip.ZipReader(new zip.BlobReader(file));
    const entries = (await archive.getEntries()).filter((entry) => !entry.directory &&
      photoType.test(entry.filename) && !entry.filename.startsWith("__MACOSX/"));
    const first = entries[0]?.filename.split("/")[0] + "/";
    const prefix = depth === undefined && entries.every((entry) => entry.filename.startsWith(first))
      ? first.length : 0;
    groupPhotos(groups, entries.map((entry) => ({path: entry.filename.slice(prefix), entry})), sourceName, depth);
  }

  function addAlbum(state, key) {
    let album = state.albums.find((item) => item.key === key);
    if (!album) {
      // Keep the legacy printed field in the version 1 file for older builds.
      album = {key, resume: null, revision: 0, photos: [], reviews: [], printed: []};
      state.albums.push(album);
    }
    return album;
  }

  const albumLabel = (key) => key || "Photos directly in Albums";
  const guestList = (state) => state.guests.slice().sort((a, b) => compare(folded(a.name), folded(b.name)));
  const photoKey = (album, path) => JSON.stringify([album, path]);

  function albumState(state, key) {
    const album = state.albums.find((item) => item.key === key);
    if (!album) throw new Error("Open a photo folder or ZIP first.");
    const photos = album.photos.slice().sort(comparePhotos);
    return {photos, resume: album.resume, revision: album.revision,
      guests: guestList(state).map(({name}) => name), reviews: Object.fromEntries(album.reviews)};
  }

  function finalPlan(state, guest) {
    const person = state.guests.find(({id}) => id === guest);
    if (!person) throw new Error("Choose a destination.");
    const choices = new Map(state.choices.filter((row) => row.guest === guest)
      .map((row) => [photoKey(row.album, row.path), row]));
    const photos = [];
    for (const album of state.albums) {
      const dates = new Map(album.photos.map(({path, date}) => [path, date]));
      for (const [path, destinations] of album.reviews) {
        const assigned = destinations.includes(person.name);
        const shared = destinations.includes("");
        if (!assigned && !shared) continue;
        const choice = choices.get(photoKey(album.key, path));
        const included = choice?.included ?? assigned;
        photos.push({album: album.key, path, assigned, shared, included,
          rank: included ? choice?.rank ?? null : null, date: dates.get(path) ?? null,
          available: sources.get(album.key)?.has(path) ?? false});
      }
    }
    photos.sort((a, b) => Number(b.included) - Number(a.included) ||
      (a.rank ?? Infinity) - (b.rank ?? Infinity) || comparePhotos(a, b));
    const token = JSON.stringify(photos);
    let rank = 0;
    for (const photo of photos) if (photo.rank !== null) photo.rank = ++rank;
    return {guest, name: person.name, photos, token};
  }

  function editFinal(state, data) {
    const plan = finalPlan(state, data.guest);
    if (plan.token !== data.token) throw new Error("Album choices changed. Reload this destination album.");
    const photo = plan.photos.find((item) => item.album === data.album && item.path === data.photo);
    if (!photo) throw new Error("This photo is unavailable for this destination.");
    let choice = state.choices.find((item) => item.guest === data.guest &&
      item.album === data.album && item.path === data.photo);
    if (!choice) {
      choice = {guest: data.guest, album: data.album, path: data.photo, included: null, rank: null};
      state.choices.push(choice);
    }
    const ordered = plan.photos.filter((item) => item !== photo && item.rank !== null)
      .map((item) => photoKey(item.album, item.path));
    let position = photo.rank;
    if (data.action === "include" && typeof data.included === "boolean") {
      choice.included = data.included;
      if (!data.included || !photo.included) choice.rank = null;
    } else if (data.action === "unrank") {
      choice.rank = null;
    } else if (data.action === "rank" && photo.included) {
      if (!Number.isInteger(data.position) || data.position < 1 || data.position > ordered.length + 1) {
        throw new Error("Choose a position within the custom order.");
      }
      position = data.position;
      choice.rank = position;
    } else {
      throw new Error("Choose a valid album action.");
    }
    if (choice.rank !== null) ordered.splice(position - 1, 0, photoKey(photo.album, photo.path));
    const ranks = new Map(ordered.map((key, index) => [key, index + 1]));
    for (const item of state.choices) {
      if (item.guest !== data.guest) continue;
      const rank = ranks.get(photoKey(item.album, item.path));
      if (rank !== undefined) item.rank = rank;
    }
    state.choices = state.choices.filter((item) => item.included !== null || item.rank !== null);
  }

  async function request(path, data) {
    if (path === "/api/preference") return preference(data.key, data.value);
    if (path === "/api/albums") {
      const state = await project();
      return state.albums.map(({key}) => ({id: key, label: albumLabel(key)}))
        .sort((a, b) => compare(folded(a.label), folded(b.label)));
    }
    if (path === "/api/open") return albumState(await project(), data.album);
    if (path === "/api/final/guests") return guestList(await project());
    if (path === "/api/final/open") return finalPlan(await project(), data.guest);
    if (path === "/api/final/edit") return finalPlan(await project((state) => editFinal(state, data)), data.guest);
    if (path === "/api/guest") {
      const name = data.name.trim().normalize("NFC");
      if (!name || name.length > 80) throw new Error("Enter a guest name.");
      await project((state) => {
        if (state.guests.some((guest) => folded(guest.name) === folded(name))) {
          throw new Error("A guest with that name already exists.");
        }
        state.guests.push({name, id: Math.max(0, ...state.guests.map(({id}) => id)) + 1});
      });
      return {added: name};
    }
    if (path !== "/api/review") throw new Error("Unknown album action.");
    const state = await project((state) => {
      const album = state.albums.find(({key}) => key === data.album);
      if (!album || album.revision !== data.revision) throw new Error("This album changed. Reload it to continue.");
      if (!album.photos.some(({path}) => path === data.photo)) throw new Error("Reopen the source album.");
      const destinationNames = new Set(["", ...state.guests.map(({name}) => name)]);
      if (!Array.isArray(data.destinations) || data.destinations.some((name) => !destinationNames.has(name))) {
        throw new Error("Choose a valid destination.");
      }
      const reviews = new Map(album.reviews);
      reviews.set(data.photo, [...new Set(data.destinations)]);
      album.reviews = Array.from(reviews);
      album.resume = data.photo;
      album.revision++;
    });
    return {revision: state.albums.find(({key}) => key === data.album).revision};
  }

  function mime(path) {
    const extension = path.split(".").at(-1).toLowerCase();
    return "image/" + (["jpg", "jpeg", "jfif"].includes(extension) ? "jpeg" : extension);
  }

  const previews = new WeakMap();
  async function preview(image, error, album, path) {
    const id = photoKey(album, path);
    const old = previews.get(image);
    if (old?.id === id) return;
    if (old?.url) URL.revokeObjectURL(old.url);
    const pending = {id};
    previews.set(image, pending);
    image.removeAttribute("src");
    image.hidden = true;
    error.hidden = true;
    if (path === null) return;
    const photo = sources.get(album)?.get(path);
    try {
      if (!photo) throw new Error("Reopen the source.");
      const blob = photo.file ?? await photo.entry.getData(new zip.BlobWriter(mime(path)), {checkSignature: true});
      if (previews.get(image) !== pending) return;
      pending.url = URL.createObjectURL(blob);
      image.hidden = false;
      image.src = pending.url;
    } catch {
      if (previews.get(image) === pending) error.hidden = false;
    }
  }

  const safeName = (name) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "") || "Album";

  function archiveStem(name) {
    // Leave room for the destination ID, timestamp, and extension.
    const stem = safeName(name.normalize("NFC").trim().slice(0, 64).replace(/[\uD800-\uDFFF]/gu, "_"));
    const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$) *(?:\.|$)/i;
    return reserved.test(stem) ? "_" + stem : stem;
  }

  const fileTimestamp = () => new Date().toISOString().replaceAll(":", "-").replace(".", "-");

  function archiveStems(guests) {
    const claimed = new Set();
    // Keep literal destination names from taking a disambiguated or timestamped filename.
    const generatedEnding = /(?: \[\d+\]| - \d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?: \(\d+\))?)$/i;
    return new Map(guests.slice().sort((a, b) => a.id - b.id).map(({id, name}) => {
      const stem = archiveStem(name);
      const key = folded(stem);
      const needsId = claimed.has(key) || generatedEnding.test(stem);
      claimed.add(key);
      return [id, needsId ? `${stem} [${id}]` : stem];
    }));
  }

  async function openArchive(directory, stem, overwrite) {
    const existing = new Set();
    if (!overwrite) {
      for await (const name of directory.keys()) existing.add(folded(name));
    }
    for (let index = 1; ; index++) {
      const name = (index === 1 ? stem : `${stem} (${index})`) + ".zip";
      if (existing.has(folded(name))) continue;
      try {
        const file = await directory.getFileHandle(name);
        if (overwrite) return {file, created: false};
      } catch (error) {
        if (!overwrite && error.name === "TypeMismatchError") continue;
        if (error.name !== "NotFoundError") throw error;
        return {file: await directory.getFileHandle(name, {create: true}), created: true};
      }
    }
  }

  async function writeArchive(directory, job, photoSources, timestamp, progress) {
    const {plan, photos, stem} = job;
    if (photos.some(({available}) => !available)) throw new Error("Reopen all source albums used by this destination.");

    const {file, created} = await openArchive(directory, timestamp ? `${stem} - ${timestamp}` : stem, !timestamp);
    const width = Math.max(4, String(photos.length).length);
    let writable;
    try {
      writable = await file.createWritable();
      const writer = new zip.ZipWriter(writable, {level: 0});
      for (const [index, {album, path}] of photos.entries()) {
        progress(`Rendering photo ${index + 1} of ${photos.length} for ${plan.name}…`);
        const photo = photoSources.get(album).get(path);
        const label = String(index + 1).padStart(width, "0") + " - " + safeName(basename(path));
        if (photo.file) {
          await writer.add(label, new zip.BlobReader(photo.file));
        } else {
          const stream = new TransformStream();
          await Promise.all([
            photo.entry.getData(stream.writable, {checkSignature: true}),
            writer.add(label, stream.readable, {zip64: true}),
          ]);
        }
      }
      await writer.close();
    } catch (error) {
      await writable?.abort().catch(() => {});
      if (created) await directory.removeEntry(file.name).catch(() => {});
      throw error;
    }
  }

  async function renderAlbums(destination, overwrite, progress) {
    const workspace = disk;
    const lock = "photo-album-curator-render:" + workspace.state.workspace.id;
    return navigator.locks.request(lock, async () => {
      if (disk !== workspace) throw new Error("Reopen the destination albums in their workspace.");
      const snapshot = await project();
      if (disk !== workspace) throw new Error("Reopen the destination albums in their workspace.");
      const photoSources = sources;
      const plans = destination
        ? [finalPlan(snapshot, destination.guest)]
        : guestList(snapshot).map(({id}) => finalPlan(snapshot, id));
      if (destination && plans[0].token !== destination.token) {
        throw new Error("Album choices changed. Reload this destination album.");
      }
      const stems = archiveStems(snapshot.guests);
      const jobs = plans.map((plan) => ({
        plan, photos: plan.photos.filter(({included}) => included), stem: stems.get(plan.guest),
      })).filter(({photos}) => photos.length);
      if (destination && !jobs.length) throw new Error("Include at least one photo.");
      const failures = [];
      if (!jobs.length) return failures;

      const directory = await workspace.folder.getDirectoryHandle("destinations", {create: true});
      const timestamp = overwrite ? "" : fileTimestamp();
      for (const job of jobs) {
        try {
          await writeArchive(directory, job, photoSources, timestamp, progress);
        } catch (error) {
          if (destination) throw error;
          failures.push(`${job.plan.name} — ${error.message}`);
        }
      }
      return failures;
    });
  }

  function validBackup(state) {
    const pairs = (rows, valid) => Array.isArray(rows) && rows.every((row) =>
      Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && valid(row[1]));
    return state?.format === "photo-album-curator" && state.version === 1 &&
      validWorkspace(state.workspace) &&
      Array.isArray(state.guests) && state.guests.every((guest) => guest && Number.isSafeInteger(guest.id) &&
        guest.id > 0 && typeof guest.name === "string" && guest.name.length > 0) &&
      Array.isArray(state.albums) && state.albums.every((album) => album && typeof album.key === "string" &&
        (album.resume === null || typeof album.resume === "string") &&
        Number.isSafeInteger(album.revision) && album.revision >= 0 &&
        Array.isArray(album.photos) && album.photos.every((photo) => photo && typeof photo.path === "string" &&
          (photo.date === null || typeof photo.date === "string")) &&
        pairs(album.reviews, (names) => Array.isArray(names) && names.every((name) =>
          name === "" || state.guests.some((guest) => guest.name === name))) &&
        pairs(album.printed, (count) => Number.isSafeInteger(count) && count >= 0)) &&
      Array.isArray(state.choices) && state.choices.every((choice) => choice &&
        state.guests.some(({id}) => id === choice.guest) && typeof choice.album === "string" &&
        typeof choice.path === "string" && (choice.included === null || typeof choice.included === "boolean") &&
        (choice.rank === null || (Number.isSafeInteger(choice.rank) && choice.rank > 0)));
  }

  function validWorkspace(value) {
    return value && typeof value.id === "string" && value.id.length > 0 &&
      typeof value.rememberExternal === "boolean" &&
      value.preferences && typeof value.preferences === "object" && !Array.isArray(value.preferences) &&
      Object.values(value.preferences).every((preference) => typeof preference === "string") &&
      Array.isArray(value.sources) && value.sources.every((record) => record &&
        typeof record.id === "string" && typeof record.name === "string" &&
        ["folder", "zip"].includes(record.kind) &&
        (record.albumRoot === undefined || (typeof record.albumRoot === "string" && record.albumRoot.length > 0)) &&
        (record.handleId === undefined || (typeof record.handleId === "string" && record.handleId.length > 0)) &&
        (record.albumFolderDepth === undefined || validAlbumDepth(record.albumFolderDepth)) &&
        (record.mergeSubfolders === undefined || typeof record.mergeSubfolders === "boolean") &&
        (record.relative === null || (Array.isArray(record.relative) &&
          record.relative.every((name) => typeof name === "string" && name !== "." && name !== ".." &&
            name.length > 0 && !name.includes("/") && !name.includes("\\")))) &&
        Array.isArray(record.albums) && record.albums.every((key) => typeof key === "string"));
  }

  async function importProject(file, progress) {
    const backupName = /^photo_album_curator_data_backup_.+\.json$/i;
    if (file.name.toLowerCase() !== projectFilename && !backupName.test(file.name)) {
      throw new Error("Choose photo_album_curator_data.json or a Curator backup JSON file.");
    }
    const state = JSON.parse(await file.text());
    if (!validBackup(state)) throw new Error("The file is not a valid Photo Album Curator project.");
    const importedWorkspace = state.workspace;
    await project((previous) => {
      state.workspace = {...importedWorkspace, id: previous.workspace.id};
      for (const album of state.albums) {
        const existing = previous.albums.find(({key}) => key === album.key);
        album.revision = Math.max(album.revision, existing?.revision ?? 0) + 1;
      }
      return state;
    });
    sources = new Map();
    externalHandles = new Map();
    await restoreSources(progress);
  }

  async function backup() {
    const target = disk;
    return navigator.locks.request(diskLock, async () => {
      const state = await readWorkspaceFile(target.file);
      const directory = await target.folder.getDirectoryHandle("backups", {create: true});
      const timestamp = fileTimestamp();
      const prefix = `photo_album_curator_data_backup_${timestamp}`;
      for (let index = 0; ; index++) {
        const name = prefix + (index ? `_${index}` : "") + ".json";
        try {
          await directory.getFileHandle(name);
        } catch (error) {
          if (error.name !== "NotFoundError") throw error;
          const file = await directory.getFileHandle(name, {create: true});
          try {
            await writeWorkspaceFile(file, state);
          } catch (writeError) {
            await directory.removeEntry(name).catch(() => {});
            throw writeError;
          }
          return `backups/${name}`;
        }
      }
    });
  }

  function showFinal() {
    const dialog = document.getElementById("browser-final");
    const frame = dialog.querySelector("iframe");
    frame.src = document.getElementById("final-link").href;
    dialog.showModal();
  }

  function closeFinal() {
    const dialog = document.getElementById("browser-final");
    dialog.close();
  }

  window.browserCurator = {
    request, preview, renderAlbums, showFinal, closeFinal, importProject,
    preference, setWorkspace, diskStatus, rememberExternal, chooseSource, reconnectSource, relinkSource, sourceForAlbum,
    available: (key) => sources.has(key),
    backup,
  };
})();
