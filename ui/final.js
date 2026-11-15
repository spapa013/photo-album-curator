"use strict";

const byId = (id) => document.getElementById(id);
const destinationSelect = byId("final-destination");
const list = byId("final-list");
const filter = byId("final-filter");
const search = byId("final-search");
const overwriteRenders = byId("final-overwrite");
const image = byId("final-image");
const previousButton = byId("final-previous");
const nextButton = byId("final-next");
const includeCheckbox = byId("final-include");
const positionCheckbox = byId("final-position");
const rankForm = byId("final-rank-form");
const feedback = byId("final-feedback");
const errorBox = byId("final-error");
const browser = window.browserCurator;
let plan = null;
let selected = null;
let busy = false;
let draggedRow = null;
let targetRow = null;

const request = (path, data) => browser.request("/api/final/" + path, data);

function key(photo) {
  return JSON.stringify([photo.album, photo.path]);
}

function currentPhoto() {
  return plan?.photos.find((photo) => key(photo) === selected);
}

function updatePhotoControls(photo) {
  const current = list.querySelector(".current");
  previousButton.disabled = busy || !current?.previousElementSibling;
  nextButton.disabled = busy || !current?.nextElementSibling;
  includeCheckbox.disabled = busy || !photo;
  positionCheckbox.disabled = busy || !photo?.included;
  for (const control of rankForm.elements) control.disabled = busy || photo?.rank == null;
}

function updateControls() {
  const hasDestinations = destinationSelect.options.length > 0;
  destinationSelect.disabled = busy || !hasDestinations;
  byId("final-reload").disabled = busy || !hasDestinations;
  byId("final-render-all").disabled = busy || !hasDestinations;
  overwriteRenders.disabled = busy || !hasDestinations;
  byId("final-render").disabled = busy || !plan?.photos.some((photo) => photo.included);
  for (const row of list.children) {
    const grip = row.querySelector(".final-grip");
    row.draggable = !busy && Boolean(grip);
    if (grip) grip.draggable = row.draggable;
  }
  updatePhotoControls(currentPhoto());
}

async function perform(action, message) {
  if (busy) return;
  busy = true;
  errorBox.hidden = true;
  feedback.textContent = message;
  updateControls();
  try {
    await action();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    feedback.textContent = "";
    render();
  } finally {
    busy = false;
    updateControls();
  }
}

function sourceLabel(photo) {
  const origin = photo.assigned && photo.shared ? "Assigned to this destination and available to all"
    : photo.assigned ? "Assigned to this destination" : "Available to all";
  return `${photo.album || "Loose photos"} · ${origin}`;
}

function renderDetail() {
  const photo = currentPhoto();
  byId("final-detail").hidden = !photo;
  if (!photo) {
    image.removeAttribute("src");
    browser.preview(image, byId("final-preview-error"), null, null);
    return;
  }
  byId("final-filename").textContent = photo.path;
  byId("final-source").textContent = sourceLabel(photo);
  browser.preview(image, byId("final-preview-error"), photo.album, photo.path);
  const positioned = photo.rank !== null;
  includeCheckbox.checked = photo.included;
  positionCheckbox.checked = positioned;
  rankForm.hidden = !positioned;
  byId("final-rank").max = plan.photos.filter(({rank}) => rank !== null).length;
  byId("final-rank").value = photo.rank ?? "";
  updatePhotoControls(photo);
}

function choose(photo) {
  selected = key(photo);
  for (const row of list.children) row.classList.toggle("current", row.dataset.key === selected);
  renderDetail();
}

function browsePhotos(direction) {
  if (busy || draggedRow) return;
  const current = list.querySelector(".current");
  const row = direction < 0 ? current?.previousElementSibling : current?.nextElementSibling;
  if (!row) return;
  choose(plan.photos.find((photo) => key(photo) === row.dataset.key));
  return row;
}

function browseFromPreview(direction) {
  const row = browsePhotos(direction);
  if (!row) return;
  // Scroll only the list so the preview and navigation stay on screen.
  const listBounds = list.getBoundingClientRect();
  const rowBounds = row.getBoundingClientRect();
  if (rowBounds.top < listBounds.top) list.scrollTop += rowBounds.top - listBounds.top;
  else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
}

function edit(photo, action, values = {}) {
  perform(async () => {
    plan = await request("edit", {
      destinationId: plan.destinationId, token: plan.token, album: photo.album, photo: photo.path, action, ...values,
    });
    render();
    feedback.textContent = "Album choices saved.";
  }, "Saving…");
}

function render() {
  clearDrag();
  byId("final-workspace").hidden = !plan;
  if (!plan) return;
  const included = plan.photos.filter((photo) => photo.included).length;
  byId("final-count").textContent = `${included} of ${plan.photos.length} included`;
  const term = search.value.trim().toLowerCase();
  const visible = plan.photos.filter((photo) => {
    const matchesFilter = filter.value === "all" ||
      (filter.value === "included" && photo.included) ||
      (filter.value === "positioned" && photo.rank !== null) ||
      (filter.value === "excluded" && !photo.included);
    return matchesFilter && `${photo.album} ${photo.path}`.toLowerCase().includes(term);
  });
  if (!visible.some((photo) => key(photo) === selected)) selected = visible.length ? key(visible[0]) : null;
  byId("final-empty").hidden = visible.length > 0;
  byId("final-empty").textContent = plan.photos.length
    ? "No photos match this filter." : "Photos assigned to this destination or made available to all will appear here.";
  list.replaceChildren(...visible.map((photo) => {
    const row = document.createElement("li");
    row.dataset.key = key(photo);
    row.classList.toggle("current", row.dataset.key === selected);
    const title = document.createElement("button");
    title.type = "button";
    title.className = "photo-link final-photo-link";
    title.textContent = photo.path;
    title.addEventListener("click", () => choose(photo));
    const source = document.createElement("small");
    source.textContent = sourceLabel(photo);
    title.append(source);
    row.append(title);
    if (photo.rank !== null) {
      const grip = document.createElement("span");
      grip.className = "final-grip";
      grip.textContent = "⠿";
      grip.title = "Drag to reorder";
      grip.setAttribute("aria-hidden", "true");
      row.append(grip);
    }
    const labels = [];
    if (!photo.available) labels.push("Source missing");
    if (photo.rank !== null) labels.push(`#${photo.rank}`);
    if (photo.included) labels.push("Included");
    for (const label of labels) {
      const badge = document.createElement("span");
      badge.className = "status";
      badge.textContent = label;
      row.append(badge);
    }
    return row;
  }));
  renderDetail();
  updateControls();
}

function setDropTarget(row, after = false) {
  targetRow?.classList.remove("drop-before", "drop-after");
  targetRow = row;
  targetRow?.classList.add(after ? "drop-after" : "drop-before");
}

function clearDrag() {
  draggedRow?.classList.remove("dragging");
  draggedRow = null;
  setDropTarget(null);
}

function dropTarget(event) {
  const row = event.target.closest("li");
  return draggedRow && row?.draggable && row !== draggedRow ? row : null;
}

function dropAfter(event, row) {
  const bounds = row.getBoundingClientRect();
  return event.clientY >= bounds.top + bounds.height / 2;
}

list.addEventListener("dragstart", (event) => {
  const row = event.target.closest("li");
  if (!row?.draggable || (event.target !== row && !event.target.matches(".final-grip"))) return;
  draggedRow = row;
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", "Reorder photo");
});
list.addEventListener("dragover", (event) => {
  const row = dropTarget(event);
  if (!row) {
    setDropTarget(null);
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setDropTarget(row, dropAfter(event, row));
});
list.addEventListener("dragleave", (event) => {
  if (!list.contains(event.relatedTarget)) setDropTarget(null);
});
list.addEventListener("dragend", clearDrag);
list.addEventListener("drop", (event) => {
  const row = dropTarget(event);
  if (!row) return;
  event.preventDefault();
  const photo = plan.photos.find((item) => key(item) === draggedRow.dataset.key);
  const target = plan.photos.find((item) => key(item) === row.dataset.key);
  const position = target.rank - Number(photo.rank < target.rank) + Number(dropAfter(event, row));
  clearDrag();
  if (position !== photo.rank) edit(photo, "rank", {position});
});

async function openDestination(destinationId) {
  plan = await request("open", {destinationId});
  destinationSelect.value = destinationId;
  destinationSelect.selectedOptions[0].textContent = plan.name;
  await browser.preference("selectedDestinationId", destinationId);
  feedback.textContent = "";
  render();
}

destinationSelect.addEventListener("change", () => {
  const destinationId = Number(destinationSelect.value);
  if (plan) destinationSelect.value = plan.destinationId;
  perform(() => openDestination(destinationId), "Loading album…");
});
byId("final-reload").addEventListener("click", () => {
  perform(() => openDestination(Number(destinationSelect.value)), "Loading album…");
});
filter.addEventListener("change", render);
search.addEventListener("input", render);
previousButton.addEventListener("click", () => browseFromPreview(-1));
nextButton.addEventListener("click", () => browseFromPreview(1));
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || draggedRow) return;
  if (openContextHelp()) return;
  if (event.key === "Escape") {
    event.preventDefault();
    browser.closeFinal();
    return;
  }

  const pressed = event.key.toLowerCase();
  const toggle = pressed === "i" ? includeCheckbox : pressed === "p" ? positionCheckbox : null;
  if (!toggle && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (busy) return;
  const focused = event.target;
  if (focused instanceof HTMLElement &&
      (focused.isContentEditable || focused.matches('input:not([type="checkbox"]), select, textarea'))) return;

  if (toggle) {
    if (toggle.disabled || event.repeat) return;
    event.preventDefault();
    toggle.click();
    return;
  }

  if (!list.querySelector(".current")) return;
  event.preventDefault();
  const row = browsePhotos(event.key === "ArrowLeft" ? -1 : 1);
  if (!row) return;
  if (list.contains(focused)) row.querySelector(".final-photo-link").focus({preventScroll: true});
  row.scrollIntoView({block: "nearest", inline: "nearest"});
});
includeCheckbox.addEventListener("change", () => {
  edit(currentPhoto(), "include", {included: includeCheckbox.checked});
});
positionCheckbox.addEventListener("change", () => {
  if (!positionCheckbox.checked) {
    edit(currentPhoto(), "unrank");
    return;
  }
  const position = plan.photos.filter(({rank}) => rank !== null).length + 1;
  edit(currentPhoto(), "rank", {position});
});
rankForm.addEventListener("submit", (event) => {
  event.preventDefault();
  edit(currentPhoto(), "rank", {position: byId("final-rank").valueAsNumber});
});
function confirmRender(destination) {
  const overwrite = overwriteRenders.checked;
  const question = destination
    ? `Render the destination album “${destination.name}”?`
    : "Render all destination albums? Destinations with no included photos will be skipped.";
  const behavior = overwrite
    ? "Each ZIP will use its usual filename in destinations/. Any previous ZIP at that path will be replaced."
    : "Each ZIP will use a timestamped filename in destinations/. Existing ZIPs will be kept.";
  if (!window.confirm(`${question}\n\n${behavior}`)) return;

  perform(async () => {
    const failures = await browser.renderAlbums(destination, overwrite, (message) => {
      feedback.textContent = message;
    });
    feedback.textContent = "";
    if (failures.length) {
      errorBox.textContent = failures.join("\n");
      errorBox.hidden = false;
    }
  }, "Preparing to render…");
}

byId("final-render").addEventListener("click", () => confirmRender(plan));
byId("final-render-all").addEventListener("click", () => confirmRender(null));
image.addEventListener("error", () => {
  image.hidden = true;
  byId("final-preview-error").hidden = false;
});

document.querySelector("header a").addEventListener("click", (event) => {
  event.preventDefault();
  browser.closeFinal();
});

perform(async () => {
  const destinations = await request("destinations");
  byId("no-destinations").hidden = destinations.length > 0;
  destinationSelect.replaceChildren(...destinations.map(({id, name}) => new Option(name, id)));
  const preferred = Number(browser.preference("selectedDestinationId"));
  const destination = destinations.find(({id}) => id === preferred) ?? destinations[0];
  if (destination) await openDestination(destination.id);
  else feedback.textContent = "";
}, "Loading destinations…");
