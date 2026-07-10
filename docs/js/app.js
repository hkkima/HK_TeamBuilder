/* 셸 컨트롤러 — 부트스트랩, 탭 전환, 프로젝트 스위처, undo/redo, 단축키, 토스트, 프로젝트 임포트/익스포트.
   렌더링은 뷰 모듈(ViewData/ViewBoard/ViewCompare)에 위임. */
(function (global) {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // 공통 UI 유틸 (뷰에서 사용)
  const UI = {
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    download(filename, text, mime) {
      const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    },
    toast(msg, kind) {
      const el = $("toast"); el.textContent = msg; el.className = "toast show" + (kind ? " " + kind : "");
      clearTimeout(el._t); el._t = setTimeout(() => { el.className = "toast"; }, 2200);
    },
    overlay(on) { $("overlay").style.display = on ? "grid" : "none"; },
  };
  global.UI = UI;

  let views = null, inited = false;

  function renderTopbar() {
    const projs = Store.listProjects(), p = Store.project();
    const sel = $("project-select");
    sel.innerHTML = projs.map((x) => `<option value="${x.id}"${x.id === p.id ? " selected" : ""}>${UI.esc(x.name)}</option>`).join("");
    $("btn-undo").disabled = !Store.canUndo();
    $("btn-redo").disabled = !Store.canRedo();
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === Store.ui().tab));
  }

  function showTab(tab) {
    ["data", "board", "compare"].forEach((t) => { $("tab-" + t).style.display = t === tab ? "" : "none"; });
  }

  let saveFlash = null;
  function render() {
    if (!inited) return;
    renderTopbar();
    const tab = Store.ui().tab;
    showTab(tab);
    views[tab].render();
    // 저장 표시
    const ind = $("save-ind"); ind.textContent = "저장 중…"; ind.classList.add("saving");
    clearTimeout(saveFlash); saveFlash = setTimeout(() => { ind.textContent = "저장됨"; ind.classList.remove("saving"); }, 500);
  }

  function bind() {
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => Store.setTab(t.dataset.tab)));
    $("btn-undo").addEventListener("click", Store.undo);
    $("btn-redo").addEventListener("click", Store.redo);
    $("btn-logout").addEventListener("click", () => { if (global.HKLogout) global.HKLogout(); });
    $("project-select").addEventListener("change", (e) => Store.switchProject(e.target.value));
    $("btn-new-proj").addEventListener("click", () => { const n = prompt("새 프로젝트 이름", "기수 " + (Store.listProjects().length + 1)); if (n) { Store.newProject(n); UI.toast("새 프로젝트 생성"); } });
    $("btn-rename-proj").addEventListener("click", () => { const n = prompt("프로젝트 이름", Store.project().name); if (n) Store.renameProject(n); });
    $("btn-del-proj").addEventListener("click", () => { if (confirm(`'${Store.project().name}' 프로젝트를 삭제할까요?`)) { Store.deleteProject(Store.project().id); UI.toast("삭제됨"); } });
    $("btn-export-proj").addEventListener("click", () => { UI.download((Store.project().name || "project") + ".json", Store.exportProject(), "application/json"); UI.toast("프로젝트 내보냄"); });
    $("btn-import-proj").addEventListener("click", () => $("file-proj").click());
    $("file-proj").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return; const r = new FileReader();
      r.onload = () => { try { Store.importProject(r.result); UI.toast("프로젝트 가져옴"); } catch (err) { UI.toast("가져오기 실패: " + err.message, "bad"); } };
      r.readAsText(f, "utf-8"); e.target.value = "";
    });
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || "")) || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault(); if (e.shiftKey) Store.redo(); else Store.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { if (typing) return; e.preventDefault(); Store.redo(); }
    });
  }

  // auth.js가 로그인 성공(또는 게이트 비활성) 시 호출
  global.AppInit = function () {
    if (inited) return; inited = true;
    Store.init();
    views = { data: global.ViewData, board: global.ViewBoard, compare: global.ViewCompare };
    views.data.init($("tab-data"));
    views.board.init($("tab-board"));
    views.compare.init($("tab-compare"));
    bind();
    Store.subscribe(render);
    render();
  };
})(window);
