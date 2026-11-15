"use strict";

function bindPreviewSwipe(preview, navigate) {
  let start;
  preview.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    start = event.isPrimary ? {id: event.pointerId, x: event.clientX, y: event.clientY} : null;
  });
  preview.addEventListener("pointercancel", (event) => {
    if (event.pointerId === start?.id) start = null;
  });
  preview.addEventListener("pointerup", (event) => {
    if (event.pointerId !== start?.id) return;
    const horizontal = event.clientX - start.x;
    const vertical = event.clientY - start.y;
    start = null;
    if (Math.abs(horizontal) >= 45 && Math.abs(horizontal) > 1.5 * Math.abs(vertical)) {
      navigate(horizontal < 0 ? 1 : -1);
    }
  });
}
