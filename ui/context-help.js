"use strict";

for (const group of document.querySelectorAll("[data-help]")) {
  const control = group.querySelector("button, input");
  const panel = group.querySelector(".help-panel");
  if (!panel.showPopover) continue;

  let showTimer;
  let hideTimer;
  let dismissing = false;
  const isOpen = () => panel.matches(":popover-open");

  function show() {
    clearTimeout(hideTimer);
    if (!isOpen() && control.getClientRects().length) panel.showPopover({source: control});
  }

  function dismiss() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (!isOpen()) return;
    dismissing = true;
    panel.hidePopover();
    dismissing = false;
  }

  function leave() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    // Leave time to cross the gap between the control and the guide link.
    hideTimer = setTimeout(() => {
      if (!group.matches(":hover, :focus-within") && !panel.matches(":hover")) dismiss();
    }, 250);
  }

  group.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (!isOpen()) showTimer = setTimeout(show, 400);
  });
  group.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") leave();
  });
  group.addEventListener("focusin", (event) => {
    clearTimeout(hideTimer);
    if (!dismissing && event.target === control && !panel.contains(event.relatedTarget) &&
        control.matches(":focus-visible")) show();
  });
  group.addEventListener("focusout", (event) => {
    if (!group.contains(event.relatedTarget)) leave();
  });
  group.addEventListener("click", (event) => {
    if (!panel.contains(event.target)) dismiss();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      dismiss();
    }
  }, true);
}
