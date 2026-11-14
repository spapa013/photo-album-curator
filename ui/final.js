"use strict";

const byId = (id) => document.getElementById(id);
const guestSelect = byId("final-guest");
const list = byId("final-list");
const filter = byId("final-filter");
const search = byId("final-search");
const image = byId("final-image");
const feedback = byId("final-feedback");
const errorBox = byId("final-error");
const browser = window.browserCurator;
let plan = null;
let selected = null;
let busy = false;

async function request(path, data) {
  if (browser) return browser.request("/api/final/" + path, data);
  const response = await fetch("/api/final/" + path, data === undefined ? {} : {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function key(photo) {
  return JSON.stringify([photo.album, photo.path]);
}

function currentPhoto() {
  return plan?.photos.find((photo) => key(photo) === selected);
}

function updateControls() {
  const hasGuests = guestSelect.options.length > 0;
  guestSelect.disabled = busy || !hasGuests;
  byId("final-reload").disabled = busy || !hasGuests;
  byId("final-render").disabled = busy || !plan?.photos.some((photo) => photo.included);
  for (const checkbox of list.querySelectorAll("input")) checkbox.disabled = busy;
  for (const id of ["final-rank", "final-set-rank", "final-clear-rank"]) byId(id).disabled = busy;
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
  const origin = photo.assigned && photo.shared ? "Assigned and shared"
    : photo.assigned ? "Assigned to this guest" : "Shared";
  return `${photo.album || "Loose photos"} · ${origin}`;
}

function renderDetail() {
  const photo = currentPhoto();
  byId("final-detail").hidden = !photo;
  if (!photo) {
    image.removeAttribute("src");
    if (browser) browser.preview(image, byId("final-preview-error"), null, null);
    return;
  }
  byId("final-filename").textContent = photo.path;
  byId("final-source").textContent = sourceLabel(photo);
  const src = "/photo?" + new URLSearchParams({album: photo.album, path: photo.path});
  if (browser) {
    browser.preview(image, byId("final-preview-error"), photo.album, photo.path);
  } else if (photo.available && image.getAttribute("src") !== src) {
    image.hidden = false;
    byId("final-preview-error").hidden = true;
    image.src = src;
  } else if (!photo.available) {
    image.removeAttribute("src");
    image.hidden = true;
    byId("final-preview-error").hidden = false;
  }
  byId("final-order").hidden = !photo.included;
  const maxRank = plan.photos.filter(({rank}) => rank !== null).length + (photo.rank === null ? 1 : 0);
  byId("final-rank").max = maxRank;
  byId("final-rank").value = photo.rank ?? maxRank;
  byId("final-clear-rank").hidden = photo.rank === null;
}

function choose(photo) {
  selected = key(photo);
  for (const row of list.children) row.classList.toggle("current", row.dataset.key === selected);
  renderDetail();
}

function edit(photo, action, values = {}) {
  perform(async () => {
    plan = await request("edit", {
      guest: plan.guest, token: plan.token, album: photo.album, photo: photo.path, action, ...values,
    });
    render();
    feedback.textContent = "Album choices saved.";
  }, "Saving…");
}

function render() {
  byId("final-workspace").hidden = !plan;
  if (!plan) return;
  const included = plan.photos.filter((photo) => photo.included).length;
  byId("final-count").textContent = `${included} of ${plan.photos.length} included`;
  const term = search.value.trim().toLowerCase();
  const visible = plan.photos.filter((photo) => {
    const matchesFilter = filter.value === "all" ||
      (filter.value === "included" && photo.included) ||
      (filter.value === "ordered" && photo.rank !== null) ||
      (filter.value === "excluded" && !photo.included);
    return matchesFilter && `${photo.album} ${photo.path}`.toLowerCase().includes(term);
  });
  if (!visible.some((photo) => key(photo) === selected)) selected = visible.length ? key(visible[0]) : null;
  byId("final-empty").hidden = visible.length > 0;
  byId("final-empty").textContent = plan.photos.length
    ? "No photos match this filter." : "Photos assigned to this guest or Shared will appear here.";
  list.replaceChildren(...visible.map((photo) => {
    const row = document.createElement("li");
    row.dataset.key = key(photo);
    row.classList.toggle("current", row.dataset.key === selected);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = photo.included;
    checkbox.setAttribute("aria-label", `Include ${photo.path} from ${photo.album || "Loose photos"}`);
    checkbox.addEventListener("change", () => edit(photo, "include", {included: checkbox.checked}));
    const title = document.createElement("button");
    title.type = "button";
    title.className = "photo-link final-photo-link";
    title.textContent = photo.path;
    title.addEventListener("click", () => choose(photo));
    const source = document.createElement("small");
    source.textContent = sourceLabel(photo);
    title.append(source);
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = photo.rank !== null ? `#${photo.rank}`
      : !photo.included ? "Available" : "Capture order";
    if (!photo.available) status.textContent += " · Source missing";
    row.append(checkbox, title, status);
    return row;
  }));
  renderDetail();
  updateControls();
}

async function openGuest(guest) {
  plan = await request("open", {guest});
  guestSelect.value = guest;
  if (browser) await browser.preference("wedding-sorter-final-guest", guest);
  else localStorage.setItem("wedding-sorter-final-guest", guest);
  feedback.textContent = "";
  render();
}

guestSelect.addEventListener("change", () => {
  const guest = Number(guestSelect.value);
  if (plan) guestSelect.value = plan.guest;
  perform(() => openGuest(guest), "Loading album…");
});
byId("final-reload").addEventListener("click", () => {
  perform(() => openGuest(Number(guestSelect.value)), "Loading album…");
});
filter.addEventListener("change", render);
search.addEventListener("input", render);
byId("final-rank-form").addEventListener("submit", (event) => {
  event.preventDefault();
  edit(currentPhoto(), "rank", {position: byId("final-rank").valueAsNumber});
});
byId("final-clear-rank").addEventListener("click", () => edit(currentPhoto(), "unrank"));
byId("final-render").addEventListener("click", () => {
  perform(async () => {
    if (browser) {
      const result = await browser.render(plan.guest, plan.token, plan.name, (message) => {
        feedback.textContent = message;
      });
      feedback.textContent = result ? `Exported ${result.count} photos to ${result.name}` : "";
      return;
    }
    const result = await request("render", {guest: plan.guest, token: plan.token});
    feedback.textContent = `Rendered ${result.count} photos to ${result.path}`;
  }, "Rendering album…");
});
image.addEventListener("error", () => {
  image.hidden = true;
  byId("final-preview-error").hidden = false;
});

if (browser) {
  byId("final-render").textContent = "Download ZIP";
  document.querySelector("header a").addEventListener("click", (event) => {
    event.preventDefault();
    browser.closeFinal();
  });
}

perform(async () => {
  const guests = await request("guests");
  byId("no-guests").hidden = guests.length > 0;
  guestSelect.replaceChildren(...guests.map(({id, name}) => new Option(name, id)));
  const preferred = Number(browser ? browser.preference("wedding-sorter-final-guest")
    : localStorage.getItem("wedding-sorter-final-guest"));
  const guest = guests.find(({id}) => id === preferred) ?? guests[0];
  if (guest) await openGuest(guest.id);
  else feedback.textContent = "";
}, "Loading guests…");
