"use strict";

const byId = (id) => document.getElementById(id);
const albumSelect = byId("album");
const jump = byId("jump");
const destinations = byId("destinations");
const image = byId("image");
const guestName = byId("guest-name");
const printedInput = byId("printed");
const printList = byId("print-list");
const feedback = byId("feedback");
const errorBox = byId("error");
const browser = window.browserCurator;
function preference(key, value) {
  if (value === undefined) return browser.preference(key);
  const waiting = pending.findLastIndex((item) => item.path === "/api/preference" && item.changes.key === key);
  const latest = waiting >= 0 ? pending[waiting].changes.value : browser.preference(key);
  if (String(latest) !== String(value)) {
    if (waiting >= 0 && (!saving || waiting > 0)) pending.splice(waiting, 1);
    queueSave("/api/preference", {key, value});
  }
}
let album = null;
let state = null;
let index = 0;
let busy = false;
let saving = false;
let saveFailed = false;
let printTimer = null;
const pending = [];

const request = browser.request;

function currentPhoto() {
  return state?.photos[index];
}

function updateControls() {
  const hasPhoto = Boolean(currentPhoto());
  const blocked = busy || saving || pending.length > 0;
  byId("browser-set-workspace").disabled = blocked;
  for (const id of ["browser-remember-external", "browser-add-source", "browser-folder", "browser-zip",
    "browser-import", "browser-backup"]) {
    byId(id).disabled = blocked || !browser.diskStatus();
  }
  for (const button of byId("browser-source-list").querySelectorAll("button")) {
    button.disabled = busy || saving || pending.length > 0;
  }
  albumSelect.disabled = busy || saving || albumSelect.options.length === 0;
  byId("reload").disabled = busy || saving || !browser.diskStatus();
  byId("previous").disabled = busy || index <= 0;
  byId("next").disabled = busy || !hasPhoto || index >= state.photos.length - 1;
  for (const id of ["jump", "destinations", "printed", "show-prints"]) {
    byId(id).disabled = busy || !hasPhoto;
  }
  byId("guest-name").disabled = busy || saving || !hasPhoto;
  byId("add-guest").disabled = busy || saving || !hasPhoto;
  byId("retry-save").hidden = !saveFailed;
  byId("retry-save").disabled = busy || saving;
}

async function perform(action) {
  if (busy) return;
  busy = true;
  errorBox.hidden = true;
  updateControls();
  try {
    await action();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    busy = false;
    byId("loading").hidden = true;
    updateControls();
    if (!saveFailed) savePending();
  }
}

async function savePending() {
  if (busy || saving || !pending.length) return;
  saving = true;
  saveFailed = false;
  feedback.textContent = "Saving…";
  errorBox.hidden = true;
  updateControls();
  try {
    while (pending.length) {
      const {path, changes} = pending[0];
      await request(path, {...changes, album, revision: state.revision});
      // Each successful write advances our revision once, even if another tab saves before the response.
      if (path !== "/api/preference") state.revision += 1;
      pending.shift();
    }
    feedback.textContent = "Saved";
  } catch (error) {
    saveFailed = true;
    feedback.textContent = "Changes waiting to save";
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    saving = false;
    updateControls();
  }
}

function queueSave(path, changes) {
  pending.push({path, changes});
  if (!saveFailed) savePending();
}

function renderDestinations() {
  const photo = currentPhoto().path;
  const selected = new Set(state.reviews[photo] ?? []);
  const choices = [["", "All destinations"], ...state.guests.map((name) => [name, name])];
  destinations.replaceChildren(...choices.map(([name, label]) => {
    const row = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(name);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(name);
      else selected.delete(name);
      state.reviews[photo] = [...selected];
      renderAssignmentSummary();
      queueSave("/api/review", {photo, destinations: [...selected]});
    });
    row.append(checkbox, label);
    return row;
  }));
}

function printNeeds(path) {
  const printed = state.printed[path] ?? 0;
  const needed = (state.reviews[path] ?? []).filter((name) => name !== "").length;
  const remaining = Math.max(0, needed - printed);
  return {printed, needed, remaining};
}

function renderPrintStatus() {
  const {needed, remaining} = printNeeds(currentPhoto().path);
  byId("print-status").textContent = `${needed} needed · ${remaining} still to print`;
}

function savePrinted() {
  clearTimeout(printTimer);
  printTimer = null;
  if (!currentPhoto() || !printedInput.validity.valid) return;
  const photo = currentPhoto().path;
  const printed = printedInput.valueAsNumber;
  if (printed === (state.printed[photo] ?? 0)) return;
  state.printed[photo] = printed;
  renderPrintStatus();
  queueSave("/api/print-count", {photo, printed});
}

function showPrintList() {
  savePrinted();
  let total = 0;
  const rows = state.photos.map(({path}, position) => {
    const {printed, needed, remaining} = printNeeds(path);
    total += remaining;
    const row = document.createElement("tr");
    const photo = row.insertCell();
    const link = document.createElement("button");
    link.type = "button";
    link.className = "photo-link";
    link.textContent = path;
    link.addEventListener("click", () => {
      printList.close();
      navigate(position);
    });
    photo.append(link);
    for (const value of [needed, printed, remaining]) {
      row.insertCell().textContent = value;
    }
    return row;
  });
  byId("print-summary").textContent = `${total} copies still to print`;
  byId("print-rows").replaceChildren(...rows);
  printList.showModal();
}

function renderAssignmentSummary() {
  const assigned = Object.values(state.reviews).filter((choices) => choices.length > 0).length;
  const count = state.photos.length;
  byId("progress").max = count;
  byId("progress").value = assigned;
  byId("progress-label").textContent = `${assigned} of ${count} assigned`;
  const destinationsCount = state.reviews[currentPhoto().path]?.length ?? 0;
  byId("assignment-status").textContent = `${destinationsCount} selected`;
  renderPrintStatus();
}

function renderPhoto() {
  const photo = currentPhoto();
  byId("workspace").hidden = !photo;
  byId("empty").hidden = Boolean(photo);
  if (!photo) {
    image.removeAttribute("src");
    browser.preview(image, byId("preview-error"), album, null);
    updateControls();
    return;
  }
  jump.selectedIndex = index;
  byId("filename").textContent = photo.path;
  byId("date").textContent = photo.date ? photo.date.replace("T", " ") : "No capture timestamp";
  browser.preview(image, byId("preview-error"), album, photo.path);
  renderDestinations();
  printedInput.value = state.printed[photo.path] ?? 0;
  renderAssignmentSummary();
  updateControls();
}

function showPhoto(position) {
  index = position;
  if (currentPhoto()) preference(`curator-photo:${album}`, currentPhoto().path);
  renderPhoto();
}

async function openAlbum(key) {
  const result = await request("/api/open", {album: key});
  state = result;
  album = key;
  pending.length = 0;
  saveFailed = false;
  feedback.textContent = "";
  preference("curator-album", key);
  albumSelect.value = key;
  guestName.value = "";
  browser.preview(image, byId("preview-error"), album, null);
  jump.replaceChildren(...state.photos.map((photo, position) =>
    new Option(`${position + 1}. ${photo.path}`, photo.path)));
  const lastPhoto = preference(`curator-photo:${key}`);
  let position = state.photos.findIndex((photo) => photo.path === lastPhoto);
  if (position < 0) position = state.photos.findIndex((photo) => photo.path === state.resume);
  showPhoto(Math.max(position, 0));
}

async function reloadAlbums(preferredAlbum) {
  const choices = await request("/api/albums");
  const preferred = preferredAlbum ?? album ?? preference("curator-album");
  const choice = choices.find(({id}) => id === preferred) ?? choices[0];
  albumSelect.replaceChildren(...choices.map(({id, label}) =>
    new Option(!browser.available(id) ? label + " (reopen source)" : label, id)));
  if (choice) await openAlbum(choice.id);
  else {
    album = null;
    state = null;
    index = 0;
    guestName.value = "";
    feedback.textContent = "";
    renderPhoto();
  }
}

function navigate(position) {
  if (!busy && position >= 0 && position < state.photos.length && position !== index) {
    savePrinted();
    showPhoto(position);
  }
  jump.selectedIndex = index;
}

function switchAlbum(action) {
  savePrinted();
  if (saving) return;
  if (pending.length && !window.confirm("Discard changes that could not be saved and reload from the workspace file?")) return;
  perform(action);
}

byId("reload").addEventListener("click", () => switchAlbum(reloadAlbums));
albumSelect.addEventListener("change", () => {
  const key = albumSelect.value;
  albumSelect.value = album;
  switchAlbum(() => openAlbum(key));
});
byId("previous").addEventListener("click", () => navigate(index - 1));
byId("next").addEventListener("click", () => navigate(index + 1));
jump.addEventListener("change", () => navigate(jump.selectedIndex));
byId("retry-save").addEventListener("click", savePending);
byId("show-prints").addEventListener("click", showPrintList);
printedInput.addEventListener("input", () => {
  clearTimeout(printTimer);
  printTimer = setTimeout(savePrinted, 350);
});
printedInput.addEventListener("change", savePrinted);
byId("print-form").addEventListener("submit", (event) => {
  event.preventDefault();
  savePrinted();
});
document.addEventListener("keydown", (event) => {
  if (busy || !currentPhoto() || printList.open || byId("browser-source-dialog").open || event.defaultPrevented ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.target.isContentEditable || event.target.matches('input:not([type="checkbox"]), select, textarea')) {
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    navigate(index + (event.key === "ArrowLeft" ? -1 : 1));
  }
});
byId("guest-form").addEventListener("submit", (event) => {
  event.preventDefault();
  savePrinted();
  if (saving || pending.length) return;
  perform(async () => {
    const {added} = await request("/api/guest", {album, name: guestName.value});
    state.guests.push(added);
    state.guests.sort((a, b) => a.localeCompare(b));
    guestName.value = "";
    renderDestinations();
    feedback.textContent = `Added ${added}.`;
  });
});
image.addEventListener("error", () => {
  image.hidden = true;
  byId("preview-error").hidden = false;
});
window.addEventListener("beforeunload", (event) => {
  if (pending.length || printTimer !== null) {
    event.preventDefault();
    event.returnValue = true;
  }
});

byId("browser-tools").hidden = false;
byId("browser-privacy").hidden = false;
byId("empty").textContent = "Set Workspace to choose where to save your project, then open a photo folder or ZIP.";
const status = byId("browser-project-status");
const remember = byId("browser-remember-external");
const sourceList = byId("browser-source-list");
const progress = (message) => { status.textContent = message; };
function showDiskStatus() {
  const disk = browser.diskStatus();
  byId("final-link").hidden = !disk;
  byId("browser-remember-label").hidden = !disk;
  byId("browser-album-controls").hidden = !disk;
  if (!disk) return;
  remember.checked = disk.rememberExternal;
  progress(`Workspace: ${disk.name} · Saving to ${disk.filename}`);
  const unavailable = disk.sources.filter((source) => !source.available);
  sourceList.hidden = !unavailable.length;
  sourceList.replaceChildren(...unavailable.map((source) => {
    const row = document.createElement("li");
    row.textContent = source.name + " · Reopen source";
    if (source.reconnect) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Reconnect";
      button.addEventListener("click", () => perform(async () => {
        await browser.reconnectSource(source.id, progress);
        await reloadAlbums();
        showDiskStatus();
      }));
      row.append(button);
    }
    return row;
  }));
}
byId("browser-set-workspace").addEventListener("click", () => {
  savePrinted();
  if (saving || pending.length) return;
  if (!window.showDirectoryPicker || !navigator.locks) {
    errorBox.textContent = "Use Chrome or Microsoft Edge to save a project directly to a workspace folder.";
    errorBox.hidden = false;
    return;
  }
  perform(async () => {
    try {
      await browser.setWorkspace(progress);
    } catch (error) {
      if (error.name === "AbortError") return;
      throw error;
    }
    album = null;
    state = null;
    showDiskStatus();
    byId("empty").textContent = "Use Add Source Album to add a photo folder or ZIP to this workspace.";
    await reloadAlbums();
  });
});
remember.addEventListener("change", () => {
  const enabled = remember.checked;
  perform(async () => {
    try {
      await browser.rememberExternal(enabled);
    } finally {
      showDiskStatus();
    }
  });
});
const sourceDialog = byId("browser-source-dialog");
byId("browser-add-source").addEventListener("click", () => {
  savePrinted();
  if (!saving && !pending.length) sourceDialog.showModal();
});
byId("browser-cancel-source").addEventListener("click", () => sourceDialog.close());
for (const kind of ["folder", "zip"]) {
  byId("browser-" + kind).addEventListener("click", () => {
    sourceDialog.close();
    savePrinted();
    if (saving || pending.length) return;
    perform(async () => {
      try {
        const opened = await browser.chooseSource(kind, progress);
        await reloadAlbums(opened.includes(album) ? album : opened[0]);
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      } finally {
        showDiskStatus();
      }
    });
  });
}
const importInput = byId("browser-import-input");
byId("browser-import").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", () => {
  const file = importInput.files[0];
  importInput.value = "";
  if (!file) return;
  savePrinted();
  if (saving || pending.length) return;
  perform(async () => {
    const filename = browser.diskStatus().filename;
    if (!window.confirm(
      `Importing ${file.name} will overwrite ${filename} in the current workspace.\n\n` +
      "Any progress missing from the selected file will be lost. Continue?"
    )) return;
    try {
      await browser.importProject(file, progress);
      album = null;
      await reloadAlbums();
    } finally {
      showDiskStatus();
    }
  });
});
byId("browser-backup").addEventListener("click", () => {
  savePrinted();
  if (saving || pending.length) return;
  perform(async () => {
    const path = await browser.backup();
    progress(`Backup saved to ${path}`);
  });
});
byId("final-link").addEventListener("click", (event) => {
  event.preventDefault();
  savePrinted();
  if (!busy && !saving && !pending.length) browser.showFinal();
});
byId("browser-final").addEventListener("close", () => {
  byId("browser-final").querySelector("iframe").removeAttribute("src");
  perform(reloadAlbums);
});
byId("loading").hidden = true;
renderPhoto();
