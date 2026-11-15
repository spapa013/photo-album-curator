"use strict";

const byId = (id) => document.getElementById(id);
const albumSelect = byId("album");
const jump = byId("jump");
const destinations = byId("destinations");
const image = byId("image");
const destinationName = byId("destination-name");
const feedback = byId("feedback");
const errorBox = byId("error");
const browser = window.browserCurator;
let album = null;
let state = null;
let index = 0;
let busy = false;
let saving = false;
let saveFailed = false;
const pending = [];
const viewingPreferences = new Map();
let viewingTimer = null;

const request = browser.request;

function preference(key, value) {
  const latest = viewingPreferences.get(key) ?? browser.preference(key);
  if (value === undefined) return latest;
  if (latest === value) return;
  viewingPreferences.set(key, value);
  clearTimeout(viewingTimer);
  viewingTimer = setTimeout(() => {
    viewingTimer = null;
    if (!saveFailed) savePending();
  }, 500);
}

async function saveViewingPreferences() {
  const snapshot = [...viewingPreferences];
  const changed = snapshot.filter(([key, value]) => browser.preference(key) !== value);
  if (changed.length) await browser.savePreferences(Object.fromEntries(changed));
  for (const [key, value] of snapshot) {
    if (viewingPreferences.get(key) === value) viewingPreferences.delete(key);
  }
  if (snapshot.length) saveFailed = false;
}

function endViewingPause() {
  clearTimeout(viewingTimer);
  viewingTimer = null;
}

function resetViewingPreferences() {
  endViewingPause();
  viewingPreferences.clear();
  saveFailed = false;
}

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
  byId("browser-relink").disabled = blocked || !browser.sourceForAlbum(album);
  byId("previous").disabled = busy || index <= 0;
  byId("next").disabled = busy || !hasPhoto || index >= state.photos.length - 1;
  for (const control of [jump, destinations]) {
    control.disabled = busy || !hasPhoto;
  }
  byId("destination-name").disabled = busy || saving || !hasPhoto;
  byId("add-destination").disabled = busy || saving || !hasPhoto;
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
  const viewingReady = () => viewingPreferences.size && viewingTimer === null;
  if (busy || saving || (!pending.length && !viewingReady())) return;
  saving = true;
  saveFailed = false;
  errorBox.hidden = true;
  updateControls();
  try {
    while (pending.length || viewingReady()) {
      if (!pending.length) {
        await saveViewingPreferences();
        continue;
      }
      feedback.textContent = "Saving…";
      do {
        await request("/api/assignment", {...pending[0], album, revision: state.revision});
        // Each successful write advances our revision once, even if another tab saves before the response.
        state.revision += 1;
        pending.shift();
      } while (pending.length);
      feedback.textContent = "Saved";
    }
  } catch (error) {
    saveFailed = true;
    if (pending.length) feedback.textContent = "Changes waiting to save";
    errorBox.textContent = pending.length ? error.message : `Could not save your place. ${error.message}`;
    errorBox.hidden = false;
  } finally {
    saving = false;
    updateControls();
  }
}

function renderDestinations() {
  const photo = currentPhoto().path;
  const current = state.assignments[photo];
  const selected = new Set(current?.destinationIds);
  if (current?.allDestinations) selected.add(null);
  const choices = [{id: null, name: "All destinations"}, ...state.destinations];
  destinations.replaceChildren(...choices.map(({id, name}) => {
    const row = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(id);
      else selected.delete(id);
      const assignment = {path: photo, destinationIds: [...selected].filter((id) => id !== null),
        allDestinations: selected.has(null)};
      state.assignments[photo] = assignment;
      renderAssignmentSummary();
      pending.push(assignment);
      if (!saveFailed) savePending();
    });
    row.append(checkbox, name);
    return row;
  }));
}

function countAssignments(assignment) {
  return assignment ? assignment.destinationIds.length + Number(assignment.allDestinations) : 0;
}

function renderAssignmentSummary() {
  const assigned = Object.values(state.assignments).filter((assignment) => countAssignments(assignment) > 0).length;
  const count = state.photos.length;
  byId("progress").max = count;
  byId("progress").value = assigned;
  byId("progress-label").textContent = `${assigned} of ${count} assigned`;
  const destinationsCount = countAssignments(state.assignments[currentPhoto().path]);
  byId("assignment-status").textContent = `${destinationsCount} selected`;
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
  renderAssignmentSummary();
  updateControls();
}

function showPhoto(position) {
  index = position;
  if (currentPhoto()) preference(`lastPhoto:${album}`, currentPhoto().path);
  renderPhoto();
}

async function openAlbum(key) {
  const result = await request("/api/open", {album: key});
  state = result;
  album = key;
  pending.length = 0;
  saveFailed = false;
  feedback.textContent = "";
  preference("selectedSourceAlbum", key);
  albumSelect.value = key;
  destinationName.value = "";
  browser.preview(image, byId("preview-error"), album, null);
  jump.replaceChildren(...state.photos.map((photo, position) =>
    new Option(`${position + 1}. ${photo.path}`, photo.path)));
  const lastPhoto = preference(`lastPhoto:${key}`);
  let position = state.photos.findIndex((photo) => photo.path === lastPhoto);
  if (position < 0) position = state.photos.findIndex((photo) => photo.path === state.resumePath);
  showPhoto(Math.max(position, 0));
}

async function reloadAlbums(preferredAlbum) {
  const choices = await request("/api/albums");
  const preferred = preferredAlbum ?? album ?? preference("selectedSourceAlbum");
  const choice = choices.find(({id}) => id === preferred) ?? choices[0];
  albumSelect.replaceChildren(...choices.map(({id, label}) =>
    new Option(!browser.available(id) ? label + " (reopen source)" : label, id)));
  if (choice) await openAlbum(choice.id);
  else {
    album = null;
    state = null;
    index = 0;
    destinationName.value = "";
    feedback.textContent = "";
    renderPhoto();
  }
}

function navigate(position) {
  if (!busy && position >= 0 && position < state.photos.length && position !== index) {
    showPhoto(position);
  }
  jump.selectedIndex = index;
}

function switchAlbum(action) {
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
byId("retry-save").addEventListener("click", () => {
  endViewingPause();
  savePending();
});
document.addEventListener("keydown", (event) => {
  if (busy || !currentPhoto() || byId("browser-source-dialog").open || event.defaultPrevented ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.target.isContentEditable || event.target.matches('input:not([type="checkbox"]), select, textarea')) {
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    navigate(index + (event.key === "ArrowLeft" ? -1 : 1));
  }
});
byId("destination-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (saving || pending.length) return;
  perform(async () => {
    const {added} = await request("/api/destination", {name: destinationName.value});
    state.destinations.push(added);
    state.destinations.sort((a, b) => a.name.localeCompare(b.name));
    destinationName.value = "";
    renderDestinations();
    feedback.textContent = `Added ${added.name}.`;
  });
});
image.addEventListener("error", () => {
  image.hidden = true;
  byId("preview-error").hidden = false;
});
window.addEventListener("beforeunload", (event) => {
  if (pending.length) {
    event.preventDefault();
    event.returnValue = true;
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    endViewingPause();
    if (!saveFailed) savePending();
  }
});

byId("browser-tools").hidden = false;
byId("browser-privacy").hidden = false;
byId("empty").textContent = "Set Workspace to choose where to save your project, then open a photo folder or ZIP.";
const status = byId("browser-project-status");
const remember = byId("browser-remember-external");
const sourceList = byId("browser-source-list");
const progress = (message) => { status.textContent = message; };
function relinkSource(id) {
  if (!id || saving || pending.length) return;
  perform(async () => {
    let missing = 0;
    try {
      missing = await browser.relinkSource(id, progress);
      await reloadAlbums();
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    } finally {
      showDiskStatus();
      if (missing) progress(`${status.textContent} · ${missing} original photo paths are missing. Their saved choices are kept.`);
    }
  });
}

const relinkButton = byId("browser-relink");
relinkButton.addEventListener("click", () => relinkSource(browser.sourceForAlbum(album)));
function showDiskStatus() {
  const disk = browser.diskStatus();
  byId("final-link").hidden = !disk;
  byId("browser-remember-control").hidden = !disk;
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
    const relinkControl = relinkButton.parentElement.cloneNode(true);
    const relink = relinkControl.querySelector("button");
    relink.removeAttribute("id");
    relink.setAttribute("aria-label", "Relink source " + source.name);
    relink.addEventListener("click", () => relinkSource(source.id));
    row.append(relinkControl);
    bindContextHelp(relinkControl);
    return row;
  }));
}
byId("browser-set-workspace").addEventListener("click", () => {
  if (saving || pending.length) return;
  if (!window.showDirectoryPicker || !navigator.locks) {
    errorBox.textContent = "Use Chrome or Microsoft Edge to save a project directly to a workspace folder.";
    errorBox.hidden = false;
    return;
  }
  perform(async () => {
    // Start saving against the current workspace while the picker still has user activation.
    const [viewingSave, opened] = await Promise.allSettled([saveViewingPreferences(), browser.setWorkspace(progress)]);
    if (opened.status === "fulfilled") {
      resetViewingPreferences();
      album = null;
      state = null;
      showDiskStatus();
      byId("empty").textContent = "Use Add Source to add a photo folder or ZIP to this workspace.";
      await reloadAlbums();
    } else if (opened.reason.name !== "AbortError") {
      throw opened.reason;
    }
    if (viewingSave.status === "rejected") throw viewingSave.reason;
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
const albumDepth = byId("browser-album-depth");
byId("browser-add-source").addEventListener("click", () => {
  if (saving || pending.length) return;
  albumDepth.value = albumDepth.defaultValue;
  sourceDialog.showModal();
});
byId("browser-cancel-source").addEventListener("click", () => sourceDialog.close());
for (const kind of ["folder", "zip"]) {
  byId("browser-" + kind).addEventListener("click", () => {
    if (saving || pending.length || !albumDepth.reportValidity()) return;
    const depth = albumDepth.valueAsNumber;
    sourceDialog.close();
    perform(async () => {
      try {
        const opened = await browser.chooseSource(kind, progress, depth);
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
  if (saving || pending.length) return;
  perform(async () => {
    const filename = browser.diskStatus().filename;
    if (!window.confirm(
      `Importing ${file.name} will overwrite ${filename} in the current workspace.\n\n` +
      "Any progress missing from the selected file will be lost. Continue?"
    )) return;
    try {
      await browser.importProject(file, progress);
      resetViewingPreferences();
      album = null;
      await reloadAlbums();
    } finally {
      showDiskStatus();
    }
  });
});
byId("browser-backup").addEventListener("click", () => {
  if (saving || pending.length) return;
  perform(async () => {
    await saveViewingPreferences();
    const path = await browser.backup();
    progress(`Backup saved to ${path}`);
  });
});
byId("final-link").addEventListener("click", (event) => {
  event.preventDefault();
  if (!busy && !saving && !pending.length) browser.showFinal();
});
byId("browser-final").addEventListener("close", () => {
  byId("browser-final").querySelector("iframe").removeAttribute("src");
  perform(reloadAlbums);
});
byId("loading").hidden = true;
renderPhoto();
