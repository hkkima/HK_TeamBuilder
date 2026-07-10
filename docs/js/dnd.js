/* Pointer Events 기반 드래그 컨트롤러 — 터치+마우스 동일 동작.
   .block[data-id] 를 [data-zone] 드롭존으로 이동. 이동/탭을 콜백으로 방출.
   HTML5 네이티브 DnD 대신 사용(모바일 지원 + 좌표 정확). */
(function (global) {
  "use strict";
  const THRESH = 6; // px, 클릭과 드래그 구분

  function attach(container, opts) {
    const onMove = opts.onMove || function () {};
    const onTap = opts.onTap || function () {};
    let startX = 0, startY = 0, id = null, srcEl = null, ghost = null, dragging = false, hovered = null, pointerId = null;

    function zoneUnder(x, y) {
      if (ghost) ghost.style.display = "none";
      const el = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = "";
      return el && el.closest ? el.closest("[data-zone]") : null;
    }
    function setHover(z) { if (hovered === z) return; if (hovered) hovered.classList.remove("drag-over"); hovered = z; if (z) z.classList.add("drag-over"); }
    function startDrag(x, y) {
      dragging = true;
      srcEl.classList.add("dragging");
      ghost = srcEl.cloneNode(true);
      ghost.classList.add("drag-ghost");
      const r = srcEl.getBoundingClientRect();
      ghost.style.width = r.width + "px";
      ghost._dx = x - r.left; ghost._dy = y - r.top;
      document.body.appendChild(ghost);
      moveGhost(x, y);
    }
    function moveGhost(x, y) { ghost.style.left = (x - ghost._dx) + "px"; ghost.style.top = (y - ghost._dy) + "px"; }
    function cleanup() {
      if (ghost) { ghost.remove(); ghost = null; }
      if (srcEl) srcEl.classList.remove("dragging");
      setHover(null);
      dragging = false; id = null; srcEl = null; pointerId = null;
    }

    container.addEventListener("pointerdown", (e) => {
      const blk = e.target.closest(".block");
      if (!blk || e.target.closest("button")) return; // 버튼(핀/리더)은 자체 처리
      if (e.button != null && e.button !== 0) return;
      id = blk.dataset.id; srcEl = blk; startX = e.clientX; startY = e.clientY; pointerId = e.pointerId; dragging = false;
    });
    container.addEventListener("pointermove", (e) => {
      if (id == null || e.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.abs(e.clientX - startX) < THRESH && Math.abs(e.clientY - startY) < THRESH) return;
        startDrag(e.clientX, e.clientY);
        try { container.setPointerCapture(pointerId); } catch (_) {}
      }
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
      setHover(zoneUnder(e.clientX, e.clientY));
    });
    function finish(e) {
      if (id == null) return;
      if (dragging) {
        const z = zoneUnder(e.clientX, e.clientY);
        const movedId = id;
        cleanup();
        if (z) onMove(movedId, z.dataset.zone);
      } else {
        const tappedId = id; const el = srcEl;
        cleanup();
        onTap(tappedId, el, e);
      }
    }
    container.addEventListener("pointerup", finish);
    container.addEventListener("pointercancel", cleanup);
  }

  global.DnD = { attach };
})(window);
