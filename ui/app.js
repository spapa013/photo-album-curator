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
let album = null;
let state = null;
let index = 0;
let busy = false;
let saving = false;
let saveFailed = false;
let printTimer = null;
const pending = [];

async function request(path, body) {
  if (browser) return browser.request(path, body);
  const options = body === undefined ? {} : {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  };
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function currentPhoto() {
  return state?.photos[index];
}

function updateControls() {
  const hasPhoto = Boolean(currentPhoto());
  if (browser) {
    for (const id of ["browser-folder", "browser-reconnect", "browser-zip", "browser-import", "browser-backup"]) {
      byId(id).disabled = busy || saving || pending.length > 0;
    }
  }
  albumSelect.disabled = busy || saving || albumSelect.options.length === 0;
  byId("reload").disabled = busy || saving;
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
      state.revision += 1;
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
  const choices = [["", "Shared album"], ...state.guests.map((name) => [name, name])];
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
    if (browser) browser.preview(image, byId("preview-error"), album, null);
    return;
  }
  jump.selectedIndex = index;
  byId("filename").textContent = photo.path;
  byId("date").textContent = photo.date ? photo.date.replace("T", " ") : "No capture timestamp";
  const src = "/photo?" + new URLSearchParams({album, path: photo.path});
  if (browser) {
    browser.preview(image, byId("preview-error"), album, photo.path);
  } else if (image.getAttribute("src") !== src) {
    image.hidden = false;
    byId("preview-error").hidden = true;
    image.src = src;
  }
  renderDestinations();
  printedInput.value = state.printed[photo.path] ?? 0;
  renderAssignmentSummary();
  updateControls();
}

function showPhoto(position) {
  index = position;
  if (currentPhoto()) localStorage.setItem(`wedding-sorter-photo:${album}`, currentPhoto().path);
  renderPhoto();
}

async function openAlbum(key) {
  const result = await request("/api/open", {album: key});
  if (result.storage !== "central") {
    throw new Error("An earlier sorter is still running. Close its terminal window, " +
      "run the launcher for your operating system, then refresh this tab.");
  }
  state = result;
  album = key;
  byId("final-link").hidden = !result.final_albums;
  pending.length = 0;
  saveFailed = false;
  feedback.textContent = "";
  localStorage.setItem("wedding-sorter-album", key);
  albumSelect.value = key;
  guestName.value = "";
  if (browser) browser.preview(image, byId("preview-error"), album, null);
  else image.removeAttribute("src");
  jump.replaceChildren(...state.photos.map((photo, position) =>
    new Option(`${position + 1}. ${photo.path}`, photo.path)));
  const lastPhoto = localStorage.getItem(`wedding-sorter-photo:${key}`);
  let position = state.photos.findIndex((photo) => photo.path === lastPhoto);
  if (position < 0) position = state.photos.findIndex((photo) => photo.path === state.resume);
  showPhoto(Math.max(position, 0));
}

async function reloadAlbums(preferredAlbum) {
  const choices = await request("/api/albums");
  const preferred = preferredAlbum ?? album ?? localStorage.getItem("wedding-sorter-album");
  const choice = choices.find(({id}) => id === preferred) ?? choices[0];
  albumSelect.replaceChildren(...choices.map(({id, label}) =>
    new Option(browser && !browser.available(id) ? label + " (reopen source)" : label, id)));
  if (choice) await openAlbum(choice.id);
  else byId("empty").hidden = false;
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
  if (pending.length && !window.confirm("Discard changes that could not be saved and reload from the database?")) return;
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
  if (busy || !currentPhoto() || printList.open || event.defaultPrevented ||
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

if (browser) {
  byId("browser-tools").hidden = false;
  byId("final-link").hidden = false;
  byId("local-file-help").remove();
  byId("empty").textContent = "Open a photo folder or ZIP to get started.";
  const status = byId("browser-project-status");
  const reconnect = byId("browser-reconnect");
  const progress = (message) => { status.textContent = message; };
  function showFolder(result) {
    if (!result) return;
    reconnect.hidden = Boolean(result.opened);
    progress(result.opened ? `Remembered folder: ${result.name}`
      : `Reconnect ${result.name} to reopen your photos.`);
  }
  async function restoreFolder(ask) {
    try {
      showFolder(await browser.restoreFolder(progress, ask));
    } catch (error) {
      if (error.name !== "AbortError") {
        progress("Could not reopen the saved folder. Open the folder again.");
      }
    }
    await reloadAlbums();
  }
  reconnect.addEventListener("click", () => {
    savePrinted();
    if (!saving && !pending.length) perform(() => restoreFolder(true));
  });
  for (const kind of ["folder", "zip", "import"]) {
    const input = byId("browser-" + kind + "-input");
    byId("browser-" + kind).addEventListener("click", () => {
      if (kind !== "folder" || !window.showDirectoryPicker) {
        input.click();
        return;
      }
      savePrinted();
      if (saving || pending.length) return;
      perform(async () => {
        try {
          const result = await browser.chooseFolder(progress);
          showFolder(result);
          await reloadAlbums(result.opened.includes(album) ? album : result.opened[0]);
        } catch (error) {
          if (error.name === "SecurityError") input.click();
          else if (error.name !== "AbortError") throw error;
        }
      });
    });
    input.addEventListener("change", () => {
      const files = Array.from(input.files);
      input.value = "";
      if (!files.length) return;
      savePrinted();
      if (saving || pending.length) return;
      perform(async () => {
        if (kind === "import") {
          if (!window.confirm("Replace this browser's saved project with the imported project?")) return;
          const counts = await browser.importProject(files[0]);
          await reloadAlbums();
          status.textContent = `Imported ${counts.assignments} assignments and ${counts.printed} print counts. Open the original sources to reattach photos.`;
        } else {
          try {
            const opened = await browser.openFiles(files, kind === "folder", progress);
            await reloadAlbums(opened.includes(album) ? album : opened[0]);
          } finally {
            status.textContent = "Files opened with this picker need to be selected again after refresh.";
          }
        }
      });
    });
  }
  byId("browser-backup").addEventListener("click", () => {
    savePrinted();
    if (saving || pending.length) return;
    perform(() => browser.backup());
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
  perform(() => restoreFolder(false));
}

if (window.location.protocol === "file:") {
  byId("loading").hidden = true;
  byId("local-file-help").hidden = false;
  byId("reload").disabled = true;
} else if (!browser) {
  perform(reloadAlbums);
}
