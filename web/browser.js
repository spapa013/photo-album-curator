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
  const projectFilename = "Photo Album Curator.json";
  const diskLock = "photo-album-curator-workspace-file";
  let workspace = "default";
  const defaultWorkspace = {id: "default", name: "Default workspace"};
  const workspaceSetting = (key, id = workspace) => id === "default" ? key : `workspace:${id}:${key}`;
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
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open("photo-album-curator-project", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  zip.configure({useWebWorkers: false});

  async function setting(key, fallback, update) {
    const db = await database;
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
            value = update(value, settings) ?? value;
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
    if (disk) {
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
    return setting(workspaceSetting("project"), projectDefault(), update);
  }

  async function readWorkspaceFile(handle) {
    const state = JSON.parse(await (await handle.getFile()).text());
    if (!validBackup(state)) throw new Error(projectFilename + " is not a valid Curator project.");
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

  async function setWorkspace(copyBrowser, progress) {
    const folder = await window.showDirectoryPicker({mode: "readwrite", id: "curator-workspace"});
    const legacy = copyBrowser ? await project() : null;
    const previousFolder = copyBrowser ? rememberedFolder : null;
    const preferences = {};
    if (legacy) {
      for (const key of ["wedding-sorter-album", "wedding-sorter-final-guest",
        ...legacy.albums.map(({key}) => `wedding-sorter-photo:${key}`)]) {
        const value = preference(key);
        if (value !== null) preferences[key] = value;
      }
    }
    const opened = await navigator.locks.request(diskLock, async () => {
      let file;
      try {
        file = await folder.getFileHandle(projectFilename);
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      if (file && copyBrowser) throw new Error("Choose a folder without an existing Curator project.");
      if (!file) {
        file = await folder.getFileHandle(projectFilename, {create: true});
      }
      const state = !copyBrowser && (await file.getFile()).size
        ? await readWorkspaceFile(file) : legacy ?? projectDefault();
      if (!state.workspace) {
        state.workspace = {id: crypto.randomUUID(), rememberExternal: false, sources: [], preferences};
        await writeWorkspaceFile(file, state);
      }
      return {folder, file, state};
    });
    disk = opened;
    sources = new Map();
    externalHandles = new Map();
    rememberedFolder = null;
    if (previousFolder) {
      try {
        if (await previousFolder.queryPermission({mode: "read"}) === "granted") {
          await connectSource(previousFolder, "folder", progress);
        }
      } catch {
        // The imported project is usable even when its previous source is unavailable.
      }
    }
    await restoreSources(progress);
    return diskStatus();
  }

  function diskStatus() {
    if (!disk) return null;
    const {rememberExternal, sources: records} = disk.state.workspace;
    return {name: disk.folder.name, rememberExternal, sources: records.map((record) => ({
      id: record.id, name: record.name,
      available: record.albums.length > 0 && record.albums.every((key) => sources.has(key)),
      reconnect: record.relative === null && rememberExternal && externalHandles.has(record.id),
    }))};
  }

  const handlesKey = (id) => `workspace-handles:${id}`;

  async function saveHandles(state) {
    await navigator.locks.request(diskLock, async () => {
      const current = await readWorkspaceFile(disk.file);
      if (current.workspace.id !== state.workspace.id || !current.workspace.rememberExternal) return;
      await setting(handlesKey(state.workspace.id), null, (previous) =>
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
        await setting(handlesKey(state.workspace.id), null, () => new Map());
      }
    });
  }

  async function scanSource(handle, kind, progress) {
    if (kind === "folder") return scanFolder(handle, progress);
    const file = await handle.getFile();
    return scanEntries([{file, path: file.name}], null, progress);
  }

  async function connectSource(handle, kind, progress) {
    const relative = await disk.folder.resolve(handle);
    const opened = await scanSource(handle, kind, progress);
    const samePath = (record) => relative !== null
      ? JSON.stringify(record.relative) === JSON.stringify(relative)
      : record.relative === null && record.name === handle.name;
    const state = await project((state) => {
      const records = state.workspace.sources;
      let record = records.find((item) => item.kind === kind && samePath(item));
      const conflict = records.find((item) => item !== record &&
        item.albums.some((key) => opened.has(key)));
      if (conflict) throw new Error("An album with that name is linked to " + conflict.name + ".");
      if (!record) {
        record = {id: crypto.randomUUID(), kind, name: handle.name, relative, albums: []};
        records.push(record);
      }
      record.albums = Array.from(new Set([...record.albums, ...opened.keys()]));
      updateAlbums(state, opened);
    });
    if (relative === null) {
      const record = state.workspace.sources.find((item) => item.kind === kind && samePath(item));
      externalHandles.set(record.id, handle);
      if (state.workspace.rememberExternal) await saveHandles(state);
    }
    for (const [key, photos] of opened) sources.set(key, photos);
    return [...opened.keys()];
  }

  async function chooseSource(kind, progress) {
    const handles = kind === "folder"
      ? [await window.showDirectoryPicker({mode: "read", id: "curator-albums"})]
      : await window.showOpenFilePicker({multiple: true, id: "curator-zips",
        types: [{description: "ZIP archive", accept: {"application/zip": [".zip"]}}]});
    const opened = [];
    for (const handle of handles) opened.push(...await connectSource(handle, kind, progress));
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

  async function restoreSources(progress) {
    const {workspace} = disk.state;
    if (workspace.rememberExternal) {
      const saved = await setting(handlesKey(workspace.id), null);
      for (const [id, handle] of saved ?? []) externalHandles.set(id, handle);
    }
    for (const record of workspace.sources) {
      try {
        const handle = record.relative === null ? externalHandles.get(record.id) : await relativeHandle(record);
        if (handle && await handle.queryPermission({mode: "read"}) === "granted") {
          await openScanned(await scanSource(handle, record.kind, progress));
        }
      } catch {
        // The source remains listed so the user can reconnect it after a move or permission change.
      }
    }
  }

  async function reconnectSource(id, progress) {
    const handle = externalHandles.get(id);
    if (!handle || await handle.requestPermission({mode: "read"}) !== "granted") return;
    const record = disk.state.workspace.sources.find((item) => item.id === id);
    if (record) await openScanned(await scanSource(handle, record.kind, progress));
  }

  async function workspaces() {
    const entries = await setting("workspaces", [defaultWorkspace]);
    return {entries, active: workspace};
  }

  function activateWorkspace(id) {
    if (disk) {
      disk = null;
      sources = new Map();
      externalHandles = new Map();
    }
    if (id !== workspace) {
      workspace = id;
      sources = new Map();
      rememberedFolder = null;
    }
    localStorage.setItem("curator-active-workspace", id);
  }

  async function selectWorkspace(id) {
    const {entries} = await workspaces();
    activateWorkspace(entries.some((entry) => entry.id === id) ? id : defaultWorkspace.id);
    return {entries, active: workspace};
  }

  async function createWorkspace(value, progress, files) {
    const name = value.trim().normalize("NFC");
    if (!name || name.length > 80) throw new Error("Enter a workspace name up to 80 characters.");
    const folder = files ? null : await window.showDirectoryPicker({mode: "read"});
    const root = folder?.name ?? files[0].webkitRelativePath.split("/")[0];
    const opened = folder ? await scanFolder(folder, progress)
      : await scanEntries(folderEntries(files, root), root, progress);
    const entry = {id: crypto.randomUUID(), name, folderName: root};
    const entries = await setting("workspaces", [defaultWorkspace], (existing, settings) => {
      if (existing.some((item) => folded(item.name) === folded(name))) {
        throw new Error("A workspace with that name already exists.");
      }
      const state = projectDefault();
      updateAlbums(state, opened);
      settings.put(state, workspaceSetting("project", entry.id));
      if (folder) settings.put(folder, workspaceSetting("album-folder", entry.id));
      return [...existing, entry];
    });
    activateWorkspace(entry.id);
    sources = opened;
    rememberedFolder = folder;
    return {entries, active: workspace, folder: {name: root, opened: [...opened.keys()], temporary: !folder}};
  }

  function preference(key, value) {
    if (disk) {
      if (value === undefined) return disk.state.workspace.preferences[key] ?? null;
      return project((state) => { state.workspace.preferences[key] = String(value); });
    }
    const scoped = workspaceSetting(key);
    if (value === undefined) return localStorage.getItem(scoped);
    localStorage.setItem(scoped, value);
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

  async function openFiles(files, asFolders, progress) {
    const root = asFolders ? files[0]?.webkitRelativePath.split("/")[0] : null;
    if (asFolders && !root) throw new Error("Choose a photo folder.");
    const opened = await scanEntries(folderEntries(files, root), root, progress);
    if (!opened.size) throw new Error("No supported photos found.");
    return openScanned(opened);
  }

  function folderEntries(files, root) {
    return files.map((file) => ({
      file, path: root ? file.webkitRelativePath.slice(root.length + 1) : file.name,
    }));
  }

  async function scanEntries(entries, root, progress) {
    const groups = new Map();
    if (root !== null) {
      const loose = [];
      for (const {file, path} of entries) {
        if (!path.includes("/") && /\.zip$/i.test(path)) {
          loose.push(file);
          continue;
        }
        if (root.toLowerCase() === "albums") {
          const slash = path.indexOf("/");
          if (slash < 0) {
            loose.push(file);
            continue;
          }
          const key = path.slice(0, slash);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({path: path.slice(slash + 1), file});
        } else {
          if (!groups.has(root)) groups.set(root, []);
          groups.get(root).push({path, file});
        }
      }
      await readArchives(loose.filter((file) => /\.zip$/i.test(file.name)), groups);
      if (loose.some((file) => photoType.test(file.name))) {
        groups.set("", loose.map((file) => ({file, path: file.name})));
      }
    } else {
      await readArchives(entries.map(({file}) => file), groups);
    }

    const opened = new Map();
    let total = 0;
    for (const [key, candidates] of groups) {
      const photos = new Map();
      const seen = new Set();
      for (const photo of candidates.filter(({path}) => photoType.test(path))) {
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

  async function openScanned(opened) {
    await project((state) => updateAlbums(state, opened));
    for (const [key, photos] of opened) sources.set(key, photos);
    return Array.from(opened.keys());
  }

  let rememberedFolder = null;

  async function scanFolder(folder, progress) {
    const entries = [];
    async function collect(directory, prefix) {
      for await (const entry of directory.values()) {
        if (entry.kind === "directory") {
          await collect(entry, prefix + entry.name + "/");
        } else if (photoType.test(entry.name) ||
                    (!prefix && /\.zip$/i.test(entry.name))) {
          entries.push({path: prefix + entry.name, file: await entry.getFile()});
        }
      }
    }
    await collect(folder, "");
    return scanEntries(entries, folder.name, progress);
  }

  async function chooseFolder(progress) {
    const folder = await window.showDirectoryPicker({mode: "read"});
    const opened = await openScanned(await scanFolder(folder, progress));
    await setting(workspaceSetting("album-folder"), null, () => folder);
    rememberedFolder = folder;
    return {name: folder.name, opened};
  }

  async function restoreFolder(progress, reconnect = false) {
    if (!reconnect) rememberedFolder = await setting(workspaceSetting("album-folder"), null);
    if (!rememberedFolder) return null;
    const folder = rememberedFolder;
    const permission = reconnect ? await folder.requestPermission({mode: "read"})
      : await folder.queryPermission({mode: "read"});
    return {name: folder.name, opened: permission === "granted"
      ? await openScanned(await scanFolder(folder, progress)) : null};
  }

  async function readArchives(files, groups) {
    for (const file of files) {
      if (!/\.zip$/i.test(file.name)) continue;
      if (groups.has(file.name)) throw new Error("Two albums use the name " + file.name + ".");
      const archive = new zip.ZipReader(new zip.BlobReader(file));
      const entries = (await archive.getEntries()).filter((entry) => !entry.directory &&
        photoType.test(entry.filename) && !entry.filename.startsWith("__MACOSX/"));
      const first = entries[0]?.filename.split("/")[0] + "/";
      const prefix = entries.every((entry) => entry.filename.startsWith(first)) ? first.length : 0;
      groups.set(file.name, entries.map((entry) => ({path: entry.filename.slice(prefix), entry})));
    }
  }

  function addAlbum(state, key) {
    let album = state.albums.find((item) => item.key === key);
    if (!album) {
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
      guests: guestList(state).map(({name}) => name), reviews: Object.fromEntries(album.reviews),
      printed: Object.fromEntries(album.printed), storage: "central", final_albums: true};
  }

  function finalPlan(state, guest) {
    const person = state.guests.find(({id}) => id === guest);
    if (!person) throw new Error("Choose a guest.");
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
    if (plan.token !== data.token) throw new Error("Album choices changed. Reload this guest album.");
    const photo = plan.photos.find((item) => item.album === data.album && item.path === data.photo);
    if (!photo) throw new Error("This photo is unavailable for this guest.");
    let choice = state.choices.find((item) => item.guest === data.guest &&
      item.album === data.album && item.path === data.photo);
    if (!choice) {
      choice = {guest: data.guest, album: data.album, path: data.photo, included: null, rank: null};
      state.choices.push(choice);
    }
    if (data.action === "include" && typeof data.included === "boolean") {
      choice.included = data.included;
    } else if (data.action === "unrank") {
      choice.rank = null;
    } else if (data.action === "rank" && photo.included) {
      const ranks = state.choices.filter((item) => item.guest === data.guest && item !== choice && item.rank !== null)
        .sort((a, b) => a.rank - b.rank);
      const active = new Set(plan.photos.filter((item) => item.included).map((item) => photoKey(item.album, item.path)));
      const ordered = ranks.filter((item) => active.has(photoKey(item.album, item.path)));
      if (!Number.isInteger(data.position) || data.position < 1 || data.position > ordered.length + 1) {
        throw new Error("Choose a position within the custom order.");
      }
      const next = ordered[data.position - 1];
      ranks.splice(next ? ranks.indexOf(next) : ranks.length, 0, choice);
      ranks.forEach((item, index) => { item.rank = index + 1; });
    } else {
      throw new Error("Choose a valid album action.");
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
    if (path !== "/api/review" && path !== "/api/print-count") throw new Error("Unknown album action.");
    const state = await project((state) => {
      const album = state.albums.find(({key}) => key === data.album);
      if (!album || album.revision !== data.revision) throw new Error("This album changed. Reload it to continue.");
      if (!album.photos.some(({path}) => path === data.photo)) throw new Error("Reopen the source album.");
      if (path === "/api/review") {
        const destinationNames = new Set(["", ...state.guests.map(({name}) => name)]);
        if (!Array.isArray(data.destinations) || data.destinations.some((name) => !destinationNames.has(name))) {
          throw new Error("Choose a valid destination.");
        }
        const reviews = new Map(album.reviews);
        reviews.set(data.photo, [...new Set(data.destinations)]);
        album.reviews = Array.from(reviews);
        album.resume = data.photo;
      } else {
        if (!Number.isSafeInteger(data.printed) || data.printed < 0) throw new Error("Enter a nonnegative whole number.");
        const printed = new Map(album.printed);
        if (data.printed) printed.set(data.photo, data.printed);
        else printed.delete(data.photo);
        album.printed = Array.from(printed);
      }
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

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const safeName = (name) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "") || "Album";
  async function render(guest, token, filename, progress) {
    const activeWorkspace = workspace;
    const photoSources = sources;
    // Call the native picker before awaiting the project transaction, while activation is available.
    const name = safeName(filename) + ".zip";
    let handle;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{description: "ZIP archive", accept: {"application/zip": [".zip"]}}],
        });
      } catch (error) {
        if (error.name === "AbortError") return null;
        if (error.name !== "SecurityError" && error.name !== "NotAllowedError") throw error;
      }
    }
    if (workspace !== activeWorkspace) throw new Error("Reopen the guest album in its workspace.");
    const snapshot = await project();
    if (workspace !== activeWorkspace) throw new Error("Reopen the guest album in its workspace.");
    const plan = finalPlan(snapshot, guest);
    if (plan.token !== token) throw new Error("Album choices changed. Reload this guest album.");
    const photos = plan.photos.filter(({included}) => included);
    if (!photos.length) throw new Error("Include at least one photo.");
    if (photos.some(({available}) => !available)) throw new Error("Reopen all source albums used by this guest.");
    const writable = handle ? await handle.createWritable() : null;
    const writer = new zip.ZipWriter(writable ?? new zip.BlobWriter("application/zip"), {level: 0});
    const width = Math.max(4, String(photos.length).length);
    try {
      for (const [index, {album, path}] of photos.entries()) {
        progress("Exporting photo " + (index + 1) + " of " + photos.length + "…");
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
      const output = await writer.close();
      if (!writable) download(output, name);
      return {count: photos.length, name: handle?.name ?? name};
    } catch (error) {
      if (writable) await writable.abort().catch(() => {});
      throw error;
    }
  }

  let sqlite;
  async function importSqlite(file) {
    sqlite ??= initSqlJs({locateFile: (name) => new URL(name, document.baseURI).href});
    const SQL = await sqlite;
    const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    const query = (sql) => db.exec(sql)[0]?.values ?? [];
    try {
      const version = query("PRAGMA user_version")[0]?.[0];
      if (![1, 2].includes(version)) throw new Error("Choose the v0.1.0 Wedding Sorter.sqlite3 file.");
      const state = projectDefault();
      const names = new Map(query("SELECT id, name FROM destinations"));
      state.guests = Array.from(names).filter(([id]) => id !== 0).map(([id, name]) => ({id, name}));
      const reviews = new Map();
      for (const [key, resume] of query("SELECT key, resume FROM source_albums")) addAlbum(state, key).resume = resume;
      for (const [album, path] of query("SELECT album, photo FROM reviews")) {
        const destinations = [];
        addAlbum(state, album).reviews.push([path, destinations]);
        reviews.set(photoKey(album, path), destinations);
      }
      for (const [album, path, guest] of query("SELECT album, photo, destination FROM assignments")) {
        reviews.get(photoKey(album, path)).push(names.get(guest));
      }
      for (const [album, path, count] of query("SELECT album, photo, printed FROM print_counts")) {
        addAlbum(state, album).printed.push([path, count]);
      }
      if (version === 2) {
        state.choices = query("SELECT destination, album, photo, included, position FROM final_choices")
          .map(([guest, album, path, included, rank]) => ({guest, album, path, included: included === null ? null : Boolean(included), rank}));
      }
      for (const album of state.albums) {
        const paths = new Set([...album.reviews, ...album.printed].map(([path]) => path));
        album.photos = Array.from(paths, (path) => ({path, date: null}));
      }
      return state;
    } finally {
      db.close();
    }
  }

  function validBackup(state) {
    const pairs = (rows, valid) => Array.isArray(rows) && rows.every((row) =>
      Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && valid(row[1]));
    return state?.format === "photo-album-curator" && state.version === 1 &&
      (state.workspace === undefined || validWorkspace(state.workspace)) &&
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
        (record.relative === null || (Array.isArray(record.relative) &&
          record.relative.every((name) => typeof name === "string" && name !== "." && name !== ".." &&
            name.length > 0 && !name.includes("/") && !name.includes("\\")))) &&
        Array.isArray(record.albums) && record.albums.every((key) => typeof key === "string"));
  }

  async function importProject(file) {
    const state = /\.json$/i.test(file.name) ? JSON.parse(await file.text()) : await importSqlite(file);
    if (!validBackup(state)) throw new Error("The file is not a valid Photo Album Curator project.");
    await project((previous) => {
      if (previous.workspace) {
        state.workspace = {...previous.workspace,
          preferences: state.workspace?.preferences ?? previous.workspace.preferences};
      }
      for (const album of state.albums) {
        const existing = previous.albums.find(({key}) => key === album.key);
        if (sources.has(album.key) && existing) album.photos = existing.photos;
        album.revision = Math.max(album.revision, existing?.revision ?? 0) + 1;
      }
      for (const key of sources.keys()) {
        if (!state.albums.some((album) => album.key === key)) {
          addAlbum(state, key).photos = previous.albums.find((album) => album.key === key).photos;
        }
      }
      return state;
    });
    return {assignments: state.albums.reduce((total, album) =>
      total + album.reviews.reduce((count, [, names]) => count + names.length, 0), 0),
    printed: state.albums.reduce((total, album) => total + album.printed.length, 0)};
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
    request, preview, render, showFinal, closeFinal, openFiles, importProject,
    chooseFolder, restoreFolder,
    createWorkspace, selectWorkspace, preference, setWorkspace, diskStatus, rememberExternal, chooseSource, reconnectSource,
    restoreWorkspace: () => selectWorkspace(localStorage.getItem("curator-active-workspace")),
    available: (key) => sources.has(key),
    async backup() {
      if (disk) {
        download(new Blob([JSON.stringify(await project())], {type: "application/json"}), projectFilename);
        return;
      }
      const {entries, active} = await workspaces();
      const {name} = entries.find(({id}) => id === active);
      download(new Blob([JSON.stringify(await project())], {type: "application/json"}), safeName(name) + ".json");
    },
  };
})();
