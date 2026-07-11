/* ② 편성 탭 — 드래그 보드 + 핀/락 + 문제 패널 + 자동 편성. */
(function (global) {
  "use strict";
  const TB = global.TeamBuilder;
  let root = null, selectedId = null;

  const esc = (s) => global.UI.esc(s);
  const PART_LABELS = { force_together: "강제결합", force_separate: "강제분리", special_stack: "특수격리", conflict: "갈등분리", positive: "긍정유지",
    flag_same: "동일태그격리", flag_cross: "교차태그", role_required: "필수역할", role_supporter: "서포터",
    issue_stack: "고이슈격리", issue_balance: "이슈분산", disp_diversity: "성향다양성", leader: "리더확보",
    mbti_balance: "MBTI", competency_coverage: "역량커버", competency_balance: "역량평준(보조)" };
  const CAT_BADGE = { mental: ["멘", "#db2777"], sunk: ["매", "#65a30d"] };

  function studentsOf(ids) { const m = Store.byId(); return ids.map((id) => m.get(id)).filter(Boolean); }
  function dispIn(ms) { const c = {}; TB.DISPOSITIONS.forEach((d) => (c[d] = 0)); ms.forEach((m) => { if (c[m.primary_disp] != null) c[m.primary_disp]++; }); const p = TB.DISPOSITIONS.filter((d) => c[d]).map((d) => `${d}${c[d]}`); return p.length ? p.join(" ") : "성향–"; }
  function avgComp(ms) { const v = ms.map(TB.compValue).filter((x) => x != null); return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : "–"; }
  function leadersIn(ms) { const l = ms.filter(TB.leaderCandidate).map((m) => m.name); return l.length ? l.join(", ") : "없음"; }
  function issueSum(ms) { return ms.reduce((s, m) => s + (m.issue_level || 0), 0); }

  function blockHtml(m, marker, isLeader, inPool, pinned) {
    const cls = "block" + (marker ? " " + marker : "") + (isLeader ? " leader" : "") + (pinned ? " pinned" : "") + (selectedId === m.id ? " selected" : "");
    const cand = TB.leaderCandidate(m) ? '<span class="cand" title="리더 후보">★</span>' : "";
    const cv = TB.compValue(m); const comp = cv != null ? `<span class="comp-val">역량 ${cv.toFixed ? cv.toFixed(1) : cv}</span>` : "";
    const iss = (m.issue_level || 0) > 0 ? `<span class="issue-badge lv${m.issue_level}" title="이슈 ${m.issue_level}${m.issue_note ? " · " + esc(m.issue_note) : ""}">⚠${m.issue_level}</span>` : "";
    const sp = m.special ? '<span class="sp-badge" title="특수 관리 — 한 팀 2명 금지">특</span>' : "";
    const cats = TB.FLAG_FIELDS.filter((f) => m[f]).map((f) => `<span class="cat-badge" style="background:${CAT_BADGE[f][1]}" title="${f}">${CAT_BADGE[f][0]}</span>`).join("");
    const pin = inPool ? "" : `<button class="btn-pin${pinned ? " on" : ""}" data-pin="${esc(m.id)}" title="이 팀에 고정(핀)">📌</button>`;
    const crown = inPool ? "" : `<button class="btn-leader${isLeader ? " on" : ""}" data-leader="${esc(m.id)}" title="팀장 지정/해제">👑</button>`;
    return `<div class="${cls}" data-id="${esc(m.id)}" title="${esc(m.issue_note || "")}">
      <div class="b-top"><span class="mbti">${esc(m.mbti || "–")}</span><span class="b-name">${esc(m.name)}</span>${cand}${sp}${cats}${iss}${pin}${crown}</div>
      <div class="b-sub">${m.primary_disp ? `<span class="role-tag">${esc(m.primary_disp)}</span>` : ""}${comp}</div></div>`;
  }

  function liveScore() { const p = Store.project(); return TB.scorePartition(p.board.teams.map(studentsOf), Store.graph(), Store.weights()); }

  function render() {
    const p = Store.project();
    root.innerHTML = template(p);
    // 팀 메모 textarea 값/포커스 보존은 재렌더 최소화로 대체(입력 시 setTeamNote는 debounce 없이 저장; blur 시 재렌더)
  }

  function template(p) {
    const hasData = p.students.length > 0;
    if (!hasData) return `<div class="empty">
      <h2>편성할 데이터가 없습니다</h2>
      <p class="muted">① 데이터 탭에서 수강생을 입력하거나 <b>샘플</b>을 불러오세요.</p>
      <button class="primary" data-act="go-data">데이터 탭으로</button></div>`;

    const sb = liveScore();
    const controls = controlsHtml(p);
    const comps = compListHtml(p);
    const metrics = metricsHtml(p, sb);
    const problems = problemsHtml(p);
    const board = boardHtml(p, sb);
    return `<div class="board-controls">${controls}${comps}${metrics}</div>
      <div class="board-main">${problems}${board}</div>`;
  }

  function controlsHtml(p) {
    const s = p.settings;
    return `<div class="build-row">
      <label class="inl">방식<select data-field="mode">
        <option value="teams"${s.mode === "teams" ? " selected" : ""}>팀 개수</option>
        <option value="sizes"${s.mode === "sizes" ? " selected" : ""}>팀 크기</option></select></label>
      ${s.mode === "teams" ? `<label class="inl">팀수<input type="number" min="1" data-field="teams" value="${s.teams}" /></label>`
        : `<label class="inl">크기<input type="text" data-field="sizes" value="${esc(s.sizes)}" /></label>`}
      <label class="inl">추천안<input type="number" min="1" max="10" data-field="options" value="${s.options}" /></label>
      <label class="inl">시드<input type="number" data-field="seed" value="${s.seed}" /></label>
      <button class="primary" data-act="build">⚙ 자동 편성</button>
      <button class="ghost" data-act="blank">빈 편성 시작</button>
      <button class="ghost" data-act="save">현재 조합 저장</button>
      <button class="ghost" data-act="export">CSV 내보내기</button>
      ${Object.keys(p.pins).length ? `<span class="pin-note">📌 ${Object.keys(p.pins).length}명 고정 — 자동 편성 시 유지</span>` : ""}
      <details class="adv"><summary>고급 가중치</summary><div class="grid2">${weightInputs(p)}</div></details>
    </div>`;
  }
  function weightInputs(p) {
    const w = p.settings.weights;
    const keys = [["conflict", "갈등"], ["positive", "긍정"], ["issue_stack", "고이슈격리"], ["issue_balance", "이슈분산"],
      ["disp_diversity", "성향"], ["leader", "리더"], ["mbti_balance", "MBTI"], ["competency_coverage", "역량커버"],
      ["competency_balance", "역량평준"], ["conflict_intensity", "갈등강도"], ["positive_intensity", "긍정강도"]];
    return keys.map(([k, lb]) => `<label>${lb}<input type="number" step="1" data-weight="${k}" value="${w[k]}" /></label>`).join("")
      + `<label>역량방식<select data-weight="competency_metric"><option value="stdev"${w.competency_metric === "stdev" ? " selected" : ""}>표준편차</option><option value="range"${w.competency_metric === "range" ? " selected" : ""}>최대격차</option></select></label>`;
  }

  function compListHtml(p) {
    if (!p.compositions.length) return `<div class="comp-bar"><span class="comp-bar-label">조합 목록</span><span class="placeholder small">자동 편성하거나 조합을 저장하세요</span></div>`;
    const chips = p.compositions.map((c, i) => {
      const sb = TB.scorePartition(c.teams.map(studentsOf), Store.graph(), Store.weights());
      const active = i === p.activeIndex ? " active" : "";
      return `<span class="comp-chip${active}" data-comp="${i}"><span class="badge-src">${c.src}</span>${esc(c.name)}<span class="cscore">${sb.total.toFixed(0)}</span><button class="cdel" data-delcomp="${i}" title="삭제">✕</button></span>`;
    }).join("");
    return `<div class="comp-bar"><span class="comp-bar-label">조합 목록</span><div class="comp-list">${chips}</div></div>`;
  }

  function metricsHtml(p, sb) {
    const g = Store.graph();
    const pool = p.board.pool.length;
    const name = p.activeIndex >= 0 && p.compositions[p.activeIndex] ? p.compositions[p.activeIndex].name : "새 편성";
    let parts = `<span class="part total">종합 ${sb.total.toFixed(1)}</span>` + Object.keys(PART_LABELS).filter((k) => k in sb.parts).map((k) => {
      const v = sb.parts[k]; const cls = v > 0.05 ? "pos" : v < -0.05 ? "neg" : "";
      return `<span class="part ${cls}">${PART_LABELS[k]} ${v >= 0 ? "+" : ""}${v.toFixed(1)}</span>`; }).join("");
    let flags = sb.intra.length === 0 ? `<span class="flag ok">✅ 갈등쌍 0 · 긍정 ${sb.kept.length} · 고이슈겹침 ${sb.issueStacks}</span>`
      : `<span class="flag">⚠️ 갈등쌍 ${sb.intra.length}</span>`;
    return `<div class="summary">관계쌍 ${g.nPairs} (갈등 ${g.conflicts.size}·긍정 ${g.positives.size}) · 표시: <b>${esc(name)}</b>${pool ? ` · <b style="color:var(--bad)">미배정 ${pool}</b>` : ""}</div>
      <div class="parts">${parts}</div><div class="flags-inline">${flags}</div>`;
  }

  function problemsHtml(p) {
    const r = global.Problems.compute(p.board, Store.byId(), Store.graph(), Store.weights(), p.pins);
    if (!r.problems.length) return `<aside class="problems"><h3>진단</h3><p class="ok-msg">✅ 문제 없음</p></aside>`;
    const items = r.problems.map((pr, i) => {
      const fix = pr.fixable ? `<button class="mini fix" data-fix="${i}">자동 해결</button>` : "";
      const jump = pr.teams.length ? `<button class="mini" data-jump="${pr.teams[0]}">이동</button>` : "";
      return `<li class="prob sev${pr.sev}"><span>${esc(pr.label)}</span><span class="prob-actions">${jump}${fix}</span></li>`;
    }).join("");
    return `<aside class="problems"><h3>진단 <span class="cnt">${r.problems.length}</span></h3><ul>${items}</ul></aside>`;
  }

  function boardHtml(p, sb) {
    const byId = Store.byId();
    const conflictIds = new Set(), sepIds = new Set();
    sb.intra.forEach((k) => k.split("|").forEach((id) => conflictIds.add(id)));
    (sb.violatedSeparate || []).forEach((k) => k.split("|").forEach((id) => sepIds.add(id)));
    const marker = (id) => conflictIds.has(id) ? "conflict" : (sepIds.has(id) ? "forcedbreak" : "");

    const pool = studentsOf(p.board.pool);
    let html = `<div class="board" id="board"><div class="team-col pool" data-zone="pool">
      <div class="team-head"><div class="team-title">미배정 <span class="tcount">${pool.length}</span></div></div>
      <div class="dropzone">${pool.map((m) => blockHtml(m, marker(m.id), false, true, false)).join("")}</div></div>`;
    html += '<div class="teams-grid">';
    html += p.board.teams.map((ids, ti) => {
      const ms = studentsOf(ids);
      const teamConf = sb.intra.filter((k) => { const [a, b] = k.split("|"); return ids.includes(a) && ids.includes(b); }).length;
      const spCount = ms.filter((m) => m.special).length;
      const missRoles = TB.REQUIRED_DISPS.filter((r) => !ms.some((m) => TB.coversDisp(m, r)));
      const catStack = TB.FLAG_FIELDS.filter((f) => ms.filter((m) => m[f]).length > 1).map((f) => CAT_BADGE[f][0]);
      const warn = (teamConf ? `<div class="team-warn">⚠️ 갈등 ${teamConf}</div>` : "")
        + (spCount > 1 ? `<div class="team-warn">🚫 특수관리 ${spCount}명(금지)</div>` : "")
        + (catStack.length ? `<div class="team-warn">⚠️ 태그겹침 ${catStack.join("·")}</div>` : "")
        + (missRoles.length && ms.length ? `<div class="team-warn role-miss">필수역할 부족: ${missRoles.join("·")}</div>` : "");
      const lid = p.board.leaderByTeam[ti]; const lname = lid && byId.get(lid) ? esc(byId.get(lid).name) : "미지정";
      const allPinned = ids.length && ids.every((id) => p.pins[id] != null);
      return `<div class="team-col${allPinned ? " team-locked" : ""}" data-zone="team-${ti}">
        <div class="team-head">
          <div class="team-title"><input class="team-name" data-teamname="${ti}" value="${esc(p.board.teamNames[ti] || ("팀 " + (ti + 1)))}" /> <span class="tcount">${ms.length}</span>
            <button class="btn-lockteam${allPinned ? " on" : ""}" data-lockteam="${ti}" title="팀 전원 고정/해제">🔒</button></div>
          <div class="team-meta">${dispIn(ms)} · 역량 ${avgComp(ms)} · 이슈 ${issueSum(ms)}<br>리더후보: ${esc(leadersIn(ms))} · 팀장: 👑${lname}</div>${warn}
          <textarea class="team-note" data-note="${ti}" rows="1" placeholder="운영자 메모…">${esc(p.board.notes[ti] || "")}</textarea>
        </div>
        <div class="dropzone">${ms.map((m) => blockHtml(m, marker(m.id), lid === m.id, false, p.pins[m.id] != null)).join("")}</div></div>`;
    }).join("");
    html += "</div></div>";
    return html;
  }

  // ---- 자동 편성 ----
  function build() {
    const p = Store.project();
    global.UI.overlay(true);
    setTimeout(() => {
      try {
        const fs = Store.forceSets();
        const s = p.settings;
        const recs = TB.buildRecommendations(p.students, Store.graph(), {
          teams: s.mode === "teams" ? Number(s.teams) : null,
          sizes: s.mode === "sizes" ? String(s.sizes).split(",").map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)) : null,
          weights: Store.weights(), forceTogether: fs.together, forceSeparate: fs.separate,
          pins: p.pins, nOptions: Number(s.options), restarts: Number(s.restarts) || 80, seed: Number(s.seed),
        });
        Store.setRecommendations(recs);
        global.UI.toast(`추천안 ${recs.length}개 생성`);
      } catch (err) { global.UI.toast("오류: " + err.message, "bad"); }
      finally { global.UI.overlay(false); }
    }, 30);
  }

  function exportCsv() {
    const p = Store.project(); if (!p.compositions.length) { global.UI.toast("저장/생성된 조합이 없습니다", "bad"); return; }
    const byId = Store.byId();
    let csv = "﻿composition,team,team_name,team_leader,team_note,id,name,mbti,primary_disp,secondary_disp,comp_avg,leadership,issue_level,issue_note,special,mental,sunk,leader_candidate,pinned\n";
    p.compositions.forEach((c) => {
      const leaders = c.leaderByTeam || [], notes = c.notes || [], names = c.teamNames || [], pins = c.pins || {};
      c.teams.forEach((ids, ti) => ids.forEach((id) => {
        const m = byId.get(id); if (!m) return; const cv = TB.compValue(m);
        const cells = [c.name, ti + 1, names[ti] || ("팀 " + (ti + 1)), leaders[ti] === id ? "Y" : "", notes[ti] || "",
          m.id, m.name, m.mbti, m.primary_disp || "", m.secondary_disp || "", cv == null ? "" : cv.toFixed(2),
          m.leadership == null ? "" : m.leadership, m.issue_level || 0, m.issue_note || "", m.special ? "Y" : "",
          m.mental ? "Y" : "", m.sunk ? "Y" : "", TB.leaderCandidate(m) ? "Y" : "", pins[id] != null ? "Y" : ""];
        csv += cells.map((v) => { const t = String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(",") + "\n";
      }));
    });
    global.UI.download("compositions.csv", csv, "text/csv");
  }

  // ---- 이벤트 ----
  function moveSel(id, zone) { selectedId = null; Store.moveStudent(id, zone); }

  function onClick(e) {
    const t = e.target;
    const btn = t.closest("button");
    if (btn) {
      if (btn.dataset.pin != null) { Store.togglePin(btn.dataset.pin); return; }
      if (btn.dataset.leader != null) { Store.toggleLeader(btn.dataset.leader); return; }
      if (btn.dataset.lockteam != null) { Store.toggleTeamLock(Number(btn.dataset.lockteam)); return; }
      if (btn.dataset.delcomp != null) { Store.deleteComposition(Number(btn.dataset.delcomp)); return; }
      if (btn.dataset.jump != null) { const el = root.querySelector(`[data-zone="team-${btn.dataset.jump}"]`); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
      if (btn.dataset.fix != null) { doFix(Number(btn.dataset.fix)); return; }
      const act = btn.dataset.act;
      if (act === "build") return build();
      if (act === "blank") return Store.startBlank();
      if (act === "save") { const p = Store.project(); if (p.board.pool.length) return global.UI.toast("미배정 인원이 있어 저장 불가", "bad"); Store.saveComposition(); global.UI.toast("조합 저장됨"); return; }
      if (act === "export") return exportCsv();
      if (act === "go-data") return Store.setTab("data");
      return;
    }
    const chip = t.closest(".comp-chip"); if (chip) { Store.loadComposition(Number(chip.dataset.comp)); return; }
    if (t.closest(".team-note") || t.closest(".team-name")) return;
    if (t.closest(".block")) return; // 블럭 탭은 DnD onTap이 처리
    const col = t.closest(".team-col"); if (col && selectedId) { moveSel(selectedId, col.dataset.zone); }
  }
  function doFix(i) {
    const p = Store.project();
    const probs = global.Problems.compute(p.board, Store.byId(), Store.graph(), Store.weights(), p.pins).problems;
    const pr = probs[i]; if (!pr) return;
    const fixed = global.Problems.autoFix(pr, p.board, Store.byId(), Store.graph(), Store.weights(), p.pins);
    if (!fixed) { global.UI.toast("자동 해결 수를 찾지 못했습니다", "bad"); return; }
    Store.setBoardTeams(fixed); global.UI.toast("자동 해결 적용");
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.field) { const v = /^(teams|options|seed|restarts)$/.test(t.dataset.field) ? Number(t.value) : t.value; const patch = {}; patch[t.dataset.field] = v; Store.setSettings(patch); return; }
    if (t.dataset.weight) { const w = {}; w[t.dataset.weight] = t.dataset.weight === "competency_metric" ? t.value : Number(t.value); Store.setWeights(w); return; }
    if (t.dataset.teamname != null) { Store.renameTeam(Number(t.dataset.teamname), t.value); return; }
    if (t.dataset.note != null) { Store.setTeamNote(Number(t.dataset.note), t.value); return; }
  }
  function onInput(e) { // 메모/이름은 입력 중 저장(재렌더 없이) → store.setTeamNote는 notify 유발하므로 note는 change에서만
    if (e.target.dataset.note != null) { const p = Store.project(); p.board.notes[Number(e.target.dataset.note)] = e.target.value; }
  }

  function init(container) {
    root = container;
    container.addEventListener("click", onClick);
    container.addEventListener("change", onChange);
    container.addEventListener("input", onInput);
    global.DnD.attach(container, {
      onMove: (id, zone) => { if (zone) moveSel(id, zone); },
      onTap: (id) => { if (selectedId && selectedId !== id) { const ti = Store.teamOf(id); moveSel(selectedId, ti >= 0 ? "team-" + ti : "pool"); } else { selectedId = selectedId === id ? null : id; render(); } },
    });
  }

  global.ViewBoard = { init, render };
})(window);
