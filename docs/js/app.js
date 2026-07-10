/* UI 연결: 데이터 로딩 → 추천 생성 → 단일 편성 보드(드래그&드롭) + 조합 목록.
 * 로직은 초안을 만들고, 최종 조정은 운영진이 블럭을 옮겨 수행한다. */
(function () {
  "use strict";
  const TB = window.TeamBuilder;
  const $ = (id) => document.getElementById(id);

  const PART_LABELS = {
    force_together: "강제 결합", force_separate: "강제 분리",
    conflict: "갈등 분리", positive: "긍정 유지",
    issue_stack: "고이슈 격리", issue_balance: "이슈 분산",
    disp_diversity: "성향 다양성", leader: "리더 확보", mbti_balance: "MBTI 균형",
    competency_coverage: "역량 커버리지", competency_balance: "역량(보조)",
  };

  const STUDENTS_TEMPLATE =
    "id,name,overall,leadership,management,planning,execution,communication," +
    "primary_disp,secondary_disp,mbti,issue_level,issue_note\n" +
    "S01,김규장,7.3,1,2,4,4,2,작업자,연구자,INTP,1,타인 비교가 잦음 / 불안형\n" +
    "S02,김민성,8.3,2,3,2,4,3,매니저,연구자,ESTJ,,\n";
  const RELATIONS_TEMPLATE =
    "DATE,FROM,TO,TYPE,W,NOTE\n" +
    "2026-06-10,김규장,이제희,NEG,3,소통이 전혀 되지 않음\n" +
    "2026-07-09,윤희성,박송호,POS,3,함께하고 싶은 팀원 (추진력)\n";

  // ---- 상태 ----
  const state = {
    students: null, byId: null, graph: null, weights: null,
    forceTogether: new Set(), forceSeparate: new Set(),
    compositions: [],   // [{name, teams:[[id..]..], src:'추천'|'저장'}]
    activeIndex: -1,
    board: { teams: [], pool: [] }, // 현재 편성(수정 대상)
    dirty: false,
    selectedId: null,
    saveCounter: 0,
  };

  // ---- 공통 유틸 ----
  function download(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  function setStatus(msg, cls) {
    const el = $("data-status");
    el.textContent = msg; el.className = "status" + (cls ? " " + cls : "");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  const studentsOf = (ids) => ids.map((id) => state.byId.get(id)).filter(Boolean);

  // 이전 팀 → 색상(일관된 hue)
  function prevColor(pt) {
    if (!pt) return "transparent";
    let h = 0; for (let i = 0; i < pt.length; i++) h = (h * 31 + pt.charCodeAt(i)) % 360;
    return `hsl(${h} 70% 55%)`;
  }

  // ---- 입력 로딩 ----
  function readWeights() {
    const w = {};
    Object.keys(TB.DEFAULT_WEIGHTS).forEach((k) => {
      const el = $("w-" + k);
      if (!el) return;
      w[k] = (k === "competency_metric") ? el.value : Number(el.value);
    });
    return w;
  }
  function readConstraints() {
    return {
      forceTogether: TB.parsePairLines($("ta-together") ? $("ta-together").value : ""),
      forceSeparate: TB.parsePairLines($("ta-apart") ? $("ta-apart").value : ""),
    };
  }
  // 입력 CSV를 로딩해 state에 반영. 실패 시 예외.
  function loadInputs() {
    const students = TB.loadStudents($("ta-students").value.trim());
    let relations = [];
    const rText = $("ta-relations").value.trim();
    if (rText) relations = TB.loadRelations(rText, students);
    const graph = TB.buildGraph(students, relations);
    const cons = readConstraints();
    state.students = students;
    state.byId = new Map(students.map((s) => [s.id, s]));
    state.graph = graph;
    state.weights = readWeights();
    // 강제 규칙 토큰(이름/ id)을 id 쌍으로 해석
    state.forceTogether = TB.pairsToSet(TB.resolvePairs(cons.forceTogether, students));
    state.forceSeparate = TB.pairsToSet(TB.resolvePairs(cons.forceSeparate, students));
    return students;
  }

  function updateDataStatus() {
    const sText = $("ta-students").value.trim();
    if (!sText) { setStatus("학생 데이터를 입력하세요.", ""); return; }
    try {
      const students = TB.loadStudents(sText);
      let msg = `학생 ${students.length}명 인식`;
      const rText = $("ta-relations").value.trim();
      if (rText) {
        const relations = TB.loadRelations(rText, students);
        const g = TB.buildGraph(students, relations);
        msg += ` · 관계쌍 ${g.nPairs} (갈등 ${g.conflicts.size}·긍정 ${g.positives.size})`;
      }
      setStatus(msg, "ok");
      $("btn-blank").disabled = false;
    } catch (err) { setStatus("오류: " + err.message, "bad"); }
  }

  function teamCountFromSettings() {
    if ($("mode").value === "sizes") {
      const arr = $("sizes").value.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
      return arr.length || 1;
    }
    return Math.max(1, Number($("teams").value) || 1);
  }

  // ---- 추천 생성 ----
  function run() {
    let students;
    try { students = loadInputs(); }
    catch (err) { setStatus("입력 오류: " + err.message, "bad"); showBoardError(err.message); return; }

    const mode = $("mode").value;
    const opt = {
      teams: mode === "teams" ? Number($("teams").value) : null,
      sizes: mode === "sizes"
        ? $("sizes").value.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) : null,
      nOptions: Number($("options").value),
      restarts: Number($("restarts").value),
      seed: Number($("seed").value),
      weights: state.weights,
      forceTogether: state.forceTogether,
      forceSeparate: state.forceSeparate,
    };

    $("overlay").style.display = "grid";
    setTimeout(function () {
      try {
        const recs = TB.buildRecommendations(students, state.graph, opt);
        state.compositions = recs.map((rec, i) => ({
          name: "추천안 " + (i + 1), src: "추천",
          teams: rec.teams.map((t) => t.map((m) => m.id)),
          notes: rec.teams.map(() => ""),
          leaderByTeam: rec.teams.map(() => null),
        }));
        state.saveCounter = 0;
        loadComposition(0);
        enableActions(true);
      } catch (err) {
        showBoardError(err.message);
        setStatus("오류: " + err.message, "bad");
      } finally {
        $("overlay").style.display = "none";
      }
    }, 40);
  }

  function enableActions(on) {
    $("btn-export").disabled = !on;
    $("btn-save-comp").disabled = !on;
    $("board-hint").style.display = on ? "" : "none";
  }

  // ---- 빈 편성 시작 (전원 미배정에서 조립) ----
  function startBlank() {
    try { loadInputs(); }
    catch (err) { setStatus("입력 오류: " + err.message, "bad"); return; }
    const n = teamCountFromSettings();
    state.board = {
      teams: Array.from({ length: n }, () => []), pool: state.students.map((s) => s.id),
      notes: Array.from({ length: n }, () => ""), leaderByTeam: Array.from({ length: n }, () => null),
    };
    state.activeIndex = -1;
    state.dirty = true;
    state.selectedId = null;
    enableActions(true);
    renderAll();
  }

  // ---- 조합 로드/저장/삭제 ----
  function loadComposition(i) {
    const c = state.compositions[i];
    if (!c) return;
    state.board = {
      teams: c.teams.map((t) => t.slice()),
      pool: [],
      notes: (c.notes || c.teams.map(() => "")).slice(),
      leaderByTeam: (c.leaderByTeam || c.teams.map(() => null)).slice(),
    };
    state.activeIndex = i;
    state.dirty = false;
    state.selectedId = null;
    renderAll();
  }
  function saveComposition() {
    if (state.board.pool.length) {
      setStatus("미배정 인원이 있어 저장할 수 없습니다. 모두 팀에 배치하세요.", "bad");
      return;
    }
    state.saveCounter += 1;
    state.compositions.push({
      name: "저장 " + state.saveCounter, src: "저장",
      teams: state.board.teams.map((t) => t.slice()),
      notes: state.board.notes.slice(),
      leaderByTeam: state.board.leaderByTeam.slice(),
    });
    state.activeIndex = state.compositions.length - 1;
    state.dirty = false;
    setStatus("현재 조합을 목록에 저장했습니다.", "ok");
    renderAll();
  }
  function deleteComposition(i) {
    state.compositions.splice(i, 1);
    if (state.activeIndex === i) { state.activeIndex = -1; state.dirty = true; }
    else if (state.activeIndex > i) state.activeIndex -= 1;
    renderAll();
  }

  // ---- 블럭 이동 ----
  function moveStudent(id, targetZone) {
    // 모든 구역에서 제거
    let removed = false;
    state.board.teams.forEach((t) => {
      const idx = t.indexOf(id);
      if (idx >= 0) { t.splice(idx, 1); removed = true; }
    });
    const pidx = state.board.pool.indexOf(id);
    if (pidx >= 0) { state.board.pool.splice(pidx, 1); removed = true; }
    if (!removed) return;
    // 팀을 떠나면 팀장 역할도 해제 (팀장은 팀에 귀속)
    state.board.leaderByTeam.forEach((lid, ti) => { if (lid === id) state.board.leaderByTeam[ti] = null; });
    if (targetZone === "pool") state.board.pool.push(id);
    else state.board.teams[Number(targetZone.split("-")[1])].push(id);
    state.dirty = true;
    renderAll();
  }

  function teamOf(id) {
    for (let ti = 0; ti < state.board.teams.length; ti++)
      if (state.board.teams[ti].indexOf(id) >= 0) return ti;
    return -1;
  }
  function toggleLeader(id) {
    const ti = teamOf(id);
    if (ti < 0) return; // 미배정은 팀장 불가
    state.board.leaderByTeam[ti] = state.board.leaderByTeam[ti] === id ? null : id;
    state.dirty = true;
    renderAll();
  }
  // 보드 재렌더 없이 메타(메모)만 반영해 입력 포커스 유지
  function markDirtyMeta() {
    state.dirty = true;
    renderCompList();
    renderMetrics();
  }

  // ---- 점수 계산 ----
  function computeScore() {
    const teams = state.board.teams.map((t) => studentsOf(t));
    return TB.scorePartition(teams, state.graph, state.weights, state.forceTogether, state.forceSeparate);
  }

  // ---- 렌더링 ----
  function mbtiDist(members) {
    const known = members.filter((m) => m.mbti && m.mbti.length >= 4);
    if (!known.length) return "MBTI –";
    return TB.MBTI_AXES.map((ax, ai) => {
      const cp = known.filter((m) => m.mbti[ai] === ax[0]).length;
      return `${ax[0]}${cp}/${ax[1]}${known.length - cp}`;
    }).join(" ");
  }
  function dispIn(members) {
    const map = {}; TB.DISPOSITIONS.forEach((r) => (map[r] = 0));
    members.forEach((m) => { if (map[m.primary_disp] != null) map[m.primary_disp]++; });
    const parts = TB.DISPOSITIONS.filter((r) => map[r]).map((r) => `${r}${map[r]}`);
    return parts.length ? parts.join(" ") : "성향 –";
  }
  function avgComp(members) {
    const v = members.map(TB.compValue).filter((x) => x != null);
    return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : "–";
  }
  function leadersIn(members) {
    const ls = members.filter(TB.leaderCandidate).map((m) => m.name);
    return ls.length ? ls.join(", ") : "없음";
  }
  function issueSum(members) { return members.reduce((s, m) => s + (m.issue_level || 0), 0); }

  function renderCompList() {
    const el = $("comp-list");
    if (!state.compositions.length) {
      el.innerHTML = '<span class="placeholder small">아직 없음 — 추천을 생성하거나 조합을 저장하세요</span>';
      return;
    }
    el.innerHTML = state.compositions.map((c, i) => {
      const teams = c.teams.map((t) => studentsOf(t));
      const sb = TB.scorePartition(teams, state.graph, state.weights, state.forceTogether, state.forceSeparate);
      const active = i === state.activeIndex && !state.dirty ? " active" : "";
      return `<span class="comp-chip${active}" data-idx="${i}">
        <span class="badge-src">${c.src}</span>${escapeHtml(c.name)}
        <span class="cscore">${sb.total.toFixed(0)}</span>
        <button class="cdel" data-del="${i}" title="삭제">✕</button></span>`;
    }).join("");
  }

  function renderMetrics() {
    const nStu = state.students ? state.students.length : 0;
    const g = state.graph;
    const assigned = state.board.teams.reduce((s, t) => s + t.length, 0);
    const poolN = state.board.pool.length;
    const activeName = state.activeIndex >= 0 && state.compositions[state.activeIndex]
      ? state.compositions[state.activeIndex].name : "새 편성";
    const dirtyTag = state.dirty ? ' <b style="color:var(--warn)">· 미저장 변경</b>' : "";
    $("summary").innerHTML =
      `대상 <b>${nStu}명</b> · 관계쌍 ${g.nPairs} (갈등 ${g.conflicts.size} · 긍정 ${g.positives.size})` +
      ` · 표시 중: <b>${escapeHtml(activeName)}</b>${dirtyTag}` +
      (poolN ? ` · <b style="color:var(--bad)">미배정 ${poolN}명</b>` : "");

    const sb = computeScore();
    $("score-parts").innerHTML =
      `<span class="part" style="font-weight:700;background:var(--chip);color:var(--brand-d)">종합 ${sb.total.toFixed(1)}</span>` +
      Object.keys(PART_LABELS).filter((k) => k in sb.parts).map((k) => {
        const v = sb.parts[k];
        const cls = v > 0.05 ? "pos" : v < -0.05 ? "neg" : "";
        return `<span class="part ${cls}">${PART_LABELS[k]} ${v >= 0 ? "+" : ""}${v.toFixed(1)}</span>`;
      }).join("");

    const nConf = sb.intra.length;
    let flags = nConf === 0
      ? '<div class="flag ok">✅ 같은 팀 내 갈등쌍 0개 · 유지된 긍정쌍 ' + sb.kept.length + "개</div>"
      : '<div class="flag">⚠️ 같은 팀 갈등쌍 ' + nConf + "개: " + sb.intra.map((k) => k.replace("|", "-")).join(", ") + "</div>";
    const hasForced = state.forceTogether.size || state.forceSeparate.size;
    if (hasForced) {
      const bt = (sb.brokenTogether || []).length, vs = (sb.violatedSeparate || []).length;
      flags += (bt + vs === 0)
        ? '<div class="flag ok">✅ 운영진 강제 규칙 모두 충족</div>'
        : '<div class="flag">⚠️ 강제 규칙 위반: 결합 ' + bt + "쌍 · 분리 " + vs + "쌍</div>";
    }
    $("flags").innerHTML = flags;
    return sb;
  }

  function blockHtml(m, marker, isLeader, inPool) {
    const cls = "block" + (marker ? " " + marker : "") + (isLeader ? " leader" : "") +
      (state.selectedId === m.id ? " selected" : "");
    const disp = m.primary_disp ? `<span class="role-tag">${escapeHtml(m.primary_disp)}</span>` : "";
    const cand = TB.leaderCandidate(m) ? '<span class="cand" title="리더 후보">★</span>' : "";
    const cv = TB.compValue(m);
    const comp = cv != null ? `<span class="comp-val">역량 ${cv}</span>` : "";
    const iss = (m.issue_level || 0) > 0
      ? `<span class="issue-badge lv${m.issue_level}" title="이슈 강도 ${m.issue_level}${m.issue_note ? " · " + escapeHtml(m.issue_note) : ""}">⚠${m.issue_level}</span>` : "";
    const crown = inPool ? "" :
      `<button class="btn-leader${isLeader ? " on" : ""}" data-id="${escapeHtml(m.id)}" title="팀장 지정/해제">👑</button>`;
    return `<div class="${cls}" draggable="true" data-id="${escapeHtml(m.id)}" title="${escapeHtml(m.issue_note || "")}">
      <div class="b-top"><span class="mbti">${escapeHtml(m.mbti || "–")}</span><span class="b-name">${escapeHtml(m.name)}</span>${cand}${iss}${crown}</div>
      <div class="b-sub">${disp}${comp}</div></div>`;
  }

  function renderBoard(sb) {
    if (!state.students) return;
    // 갈등/강제 위반에 연루된 id 집합
    const conflictIds = new Set(), breakIds = new Set();
    sb.intra.forEach((k) => k.split("|").forEach((id) => conflictIds.add(id)));
    (sb.violatedSeparate || []).forEach((k) => k.split("|").forEach((id) => conflictIds.add(id)));
    (sb.brokenTogether || []).forEach((k) => k.split("|").forEach((id) => breakIds.add(id)));
    const markerOf = (id) => conflictIds.has(id) ? "conflict" : (breakIds.has(id) ? "forcedbreak" : "");

    let html = "";
    // 미배정 풀 (항상 표시: 임시 보관/조립용)
    const pool = studentsOf(state.board.pool);
    html += `<div class="team-col pool" data-zone="pool">
      <div class="team-head"><div class="team-title">미배정 <span class="tcount">${pool.length}명</span></div></div>
      <div class="dropzone">${pool.map((m) => blockHtml(m, markerOf(m.id), false, true)).join("")}</div></div>`;

    // 팀들
    html += '<div class="teams-grid">';
    html += state.board.teams.map((ids, ti) => {
      const members = studentsOf(ids);
      const teamConf = sb.intra.filter((k) => {
        const [a, b] = k.split("|"); return ids.includes(a) && ids.includes(b);
      }).length;
      const warn = teamConf ? `<div class="team-warn">⚠️ 갈등쌍 ${teamConf}</div>` : "";
      const leadId = state.board.leaderByTeam[ti];
      const leadName = leadId && state.byId.get(leadId) ? escapeHtml(state.byId.get(leadId).name) : "미지정";
      const note = state.board.notes[ti] || "";
      return `<div class="team-col" data-zone="team-${ti}">
        <div class="team-head">
          <div class="team-title">팀 ${ti + 1} <span class="tcount">${members.length}명</span></div>
          <div class="team-meta">${dispIn(members)} · 역량 ${avgComp(members)} · 이슈 ${issueSum(members)}<br>리더후보: ${escapeHtml(leadersIn(members))}</div>
          <div class="team-leader">👑 팀장: ${leadName}</div>${warn}
          <textarea class="team-note" data-team="${ti}" rows="1" placeholder="운영자 메모…">${escapeHtml(note)}</textarea>
        </div>
        <div class="dropzone">${members.map((m) => blockHtml(m, markerOf(m.id), leadId === m.id, false)).join("")}</div></div>`;
    }).join("");
    html += "</div>";
    // 풀을 팀 위가 아니라 아래로 두고 싶으면 순서 조정 가능. 여기선 상단 유지.
    $("board").innerHTML = html;
  }

  function renderAll() {
    renderCompList();
    const sb = renderMetrics();
    renderBoard(sb);
  }

  function showBoardError(msg) {
    $("board").innerHTML = '<p class="flag">오류: ' + escapeHtml(msg) + "</p>";
  }

  // ---- CSV 내보내기 (목록의 모든 조합) ----
  function exportCsv() {
    if (!state.compositions.length) { setStatus("내보낼 조합이 없습니다. 먼저 저장하세요.", "bad"); return; }
    let csv = "﻿composition,team,team_leader,team_note,id,name,mbti,primary_disp,secondary_disp," +
      "overall,leadership,issue_level,issue_note,leader_candidate\n";
    state.compositions.forEach((c) => {
      const notes = c.notes || c.teams.map(() => "");
      const leaders = c.leaderByTeam || c.teams.map(() => null);
      c.teams.forEach((ids, ti) => {
        studentsOf(ids).forEach((m) => {
          const cells = [c.name, ti + 1, leaders[ti] === m.id ? "Y" : "", notes[ti] || "",
            m.id, m.name, m.mbti, m.primary_disp || "", m.secondary_disp || "",
            m.overall == null ? "" : m.overall, m.leadership == null ? "" : m.leadership,
            m.issue_level || 0, m.issue_note || "", TB.leaderCandidate(m) ? "Y" : ""];
          csv += cells.map((v) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",") + "\n";
        });
      });
    });
    download("compositions.csv", csv);
  }

  // ---- 드래그&드롭 / 클릭 이동 (이벤트 위임) ----
  function bindBoardEvents() {
    const board = $("board");
    let hovered = null;
    board.addEventListener("dragstart", (e) => {
      const blk = e.target.closest(".block");
      if (!blk) return;
      state.dragId = blk.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", blk.dataset.id);
      blk.classList.add("dragging");
    });
    board.addEventListener("dragend", (e) => {
      const blk = e.target.closest(".block"); if (blk) blk.classList.remove("dragging");
      if (hovered) { hovered.classList.remove("drag-over"); hovered = null; }
    });
    board.addEventListener("dragover", (e) => {
      const col = e.target.closest(".team-col"); if (!col) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (hovered !== col) { if (hovered) hovered.classList.remove("drag-over"); hovered = col; col.classList.add("drag-over"); }
    });
    board.addEventListener("drop", (e) => {
      const col = e.target.closest(".team-col"); if (!col) return;
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || state.dragId;
      if (hovered) { hovered.classList.remove("drag-over"); hovered = null; }
      if (id) moveStudent(id, col.dataset.zone);
    });
    // 클릭: 팀장 토글 / 메모는 무시 / 블럭 선택 / 선택 후 팀 클릭 이동
    board.addEventListener("click", (e) => {
      const crown = e.target.closest(".btn-leader");
      if (crown) { e.stopPropagation(); toggleLeader(crown.dataset.id); return; }
      if (e.target.closest(".team-note")) return; // 메모 입력은 이동 트리거 안 함
      const blk = e.target.closest(".block");
      if (blk) {
        // 이미 다른 블럭을 고른 상태면, 클릭한 블럭이 속한 팀으로 이동(가득 찬 팀에도 배치 가능)
        if (state.selectedId && state.selectedId !== blk.dataset.id) {
          const id = state.selectedId; state.selectedId = null;
          const ti = teamOf(blk.dataset.id);
          moveStudent(id, ti >= 0 ? "team-" + ti : "pool");
          return;
        }
        state.selectedId = state.selectedId === blk.dataset.id ? null : blk.dataset.id;
        renderAll(); return;
      }
      const col = e.target.closest(".team-col");
      if (col && state.selectedId) { const id = state.selectedId; state.selectedId = null; moveStudent(id, col.dataset.zone); }
    });
    // 팀 메모 입력 (보드 재렌더 없이 상태만 갱신 → 포커스 유지)
    board.addEventListener("input", (e) => {
      const ta = e.target.closest(".team-note");
      if (!ta) return;
      state.board.notes[Number(ta.dataset.team)] = ta.value;
      markDirtyMeta();
    });
  }

  function bindCompListEvents() {
    $("comp-list").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) { e.stopPropagation(); deleteComposition(Number(del.dataset.del)); return; }
      const chip = e.target.closest(".comp-chip");
      if (chip) loadComposition(Number(chip.dataset.idx));
    });
  }

  function bindFile(fileId, taId) {
    $(fileId).addEventListener("change", function (e) {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { $(taId).value = reader.result; updateDataStatus(); };
      reader.readAsText(f, "utf-8");
    });
    $(taId).addEventListener("input", updateDataStatus);
  }

  // ---- 초기화 (로그인 성공 후 호출됨) ----
  window.AppInit = function () {
    bindFile("file-students", "ta-students");
    bindFile("file-relations", "ta-relations");
    bindBoardEvents();
    bindCompListEvents();

    $("mode").addEventListener("change", function () {
      const t = this.value === "teams";
      $("wrap-teams").style.display = t ? "" : "none";
      $("wrap-sizes").style.display = t ? "none" : "";
    });
    $("btn-sample").addEventListener("click", function () {
      $("ta-students").value = window.SAMPLE_STUDENTS.trim() + "\n";
      $("ta-relations").value = window.SAMPLE_RELATIONS.trim() + "\n";
      updateDataStatus();
    });
    $("btn-tmpl-students").addEventListener("click", () => download("students_template.csv", "﻿" + STUDENTS_TEMPLATE));
    $("btn-tmpl-relations").addEventListener("click", () => download("relations_template.csv", "﻿" + RELATIONS_TEMPLATE));
    $("btn-run").addEventListener("click", run);
    $("btn-blank").addEventListener("click", startBlank);
    $("btn-save-comp").addEventListener("click", saveComposition);
    $("btn-export").addEventListener("click", exportCsv);
  };
})();
