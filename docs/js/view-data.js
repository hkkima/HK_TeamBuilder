/* ① 데이터 탭 — 수강생 인라인 편집 그리드 + 관계/강제규칙 에디터 + CSV 임포트/익스포트.
   텍스트 필드는 change(블러)에서 커밋해 재렌더 포커스 손실을 피한다. */
(function (global) {
  "use strict";
  const TB = global.TeamBuilder;
  let root = null;
  const esc = (s) => global.UI.esc(s);

  const NUM = { leadership: [1, 3], management: [1, 3], planning: [1, 5], execution: [1, 5], communication: [1, 5], issue_level: [0, 3] };
  const COLS = [["leadership", "리더십"], ["management", "관리"], ["planning", "기획"], ["execution", "작업"], ["communication", "소통"]];
  // 서수 라벨 (value=숫자, 표시=라벨)
  const L3 = [["", "–"], ["3", "상"], ["2", "중"], ["1", "하"]];
  const L5 = [["", "–"], ["5", "매우 우수"], ["4", "우수"], ["3", "보통"], ["2", "미흡"], ["1", "매우 미흡"]];
  const ORD = { leadership: L3, management: L3, planning: L5, execution: L5, communication: L5 };
  // 플래그 열 순서(스키마): 멘탈, 매몰, 관리대상(=special)
  const FLAGS = [["mental", "멘탈"], ["sunk", "매몰"], ["special", "관리대상"]];

  function newId(students) { let i = students.length + 1; const used = new Set(students.map((s) => s.id)); while (used.has("S" + String(i).padStart(2, "0"))) i++; return "S" + String(i).padStart(2, "0"); }

  function render() {
    const p = Store.project();
    const g = Store.graph();
    root.innerHTML = `<div class="data-wrap">
      <div class="data-toolbar">
        <button class="primary" data-act="sample">샘플 불러오기</button>
        <button class="ghost" data-act="import">CSV 가져오기</button>
        <button class="ghost" data-act="add-student">＋ 학생</button>
        <span class="grow"></span>
        <button class="ghost sm" data-act="tmpl-s">학생 템플릿</button>
        <button class="ghost sm" data-act="tmpl-r">관계 템플릿</button>
        <button class="ghost sm" data-act="tmpl-g">교과 템플릿</button>
        <button class="ghost sm" data-act="exp-s">학생 CSV</button>
        <button class="ghost sm" data-act="exp-r">관계 CSV</button>
        <input type="file" id="dfile" accept=".csv" hidden />
      </div>
      <div class="data-status">수강생 <b>${p.students.length}</b> · 관계 <b>${p.relations.length}</b> (갈등 ${g.conflicts.size}·긍정 ${g.positives.size}) · 강제 결합 ${p.constraints.together.length}·분리 ${p.constraints.apart.length}</div>
      <div class="data-cols">
        <section class="roster">${rosterTable(p)}</section>
        <aside class="side">${relationsBox(p)}${constraintsBox(p)}</aside>
      </div>
      <div id="drop-hint" class="drop-hint">여기에 CSV 파일을 끌어놓으세요</div>
    </div>`;
  }

  function rosterTable(p) {
    if (!p.students.length) return `<div class="empty sm"><p class="muted">수강생이 없습니다. <b>샘플 불러오기</b> 또는 <b>CSV 가져오기</b>, <b>＋ 학생</b>으로 시작하세요.</p></div>`;
    const dsel = (id, col, val) => `<select data-id="${id}" data-col="${col}"><option value="">–</option>${TB.DISPOSITIONS.map((d) => `<option${d === val ? " selected" : ""}>${d}</option>`).join("")}</select>`;
    const osel = (id, col, val) => { const cur = val == null ? "" : String(val); return `<select class="cell ord" data-id="${id}" data-col="${col}">${ORD[col].map(([v, lb]) => `<option value="${v}"${v === cur ? " selected" : ""}>${lb}</option>`).join("")}</select>`; };
    const chk = (id, col, on, title) => `<td class="ctr"><input type="checkbox" data-id="${id}" data-col="${col}"${on ? " checked" : ""} title="${title}" /></td>`;
    const flagTitle = { mental: "멘탈 이슈(카테고리)", sunk: "매몰 성향(카테고리)", special: "관리 대상 — 한 팀 2명 금지(하드)" };
    const rows = p.students.map((s) => { const cv = TB.compValue(s); return `<tr>
      <td><input class="cell name" data-id="${s.id}" data-col="name" value="${esc(s.name)}" /></td>
      ${COLS.map(([c]) => `<td>${osel(s.id, c, s[c])}</td>`).join("")}
      <td class="ctr grade">${cv == null ? "–" : cv.toFixed(1)}</td>
      <td>${dsel(s.id, "primary_disp", s.primary_disp)}</td>
      <td>${dsel(s.id, "secondary_disp", s.secondary_disp)}</td>
      <td><input class="cell mbti" data-id="${s.id}" data-col="mbti" value="${esc(s.mbti)}" maxlength="4" /></td>
      <td><input class="cell num" type="number" min="0" max="3" data-id="${s.id}" data-col="issue_level" value="${s.issue_level || 0}" /></td>
      <td><input class="cell note" data-id="${s.id}" data-col="issue_note" value="${esc(s.issue_note)}" /></td>
      ${FLAGS.map(([c]) => chk(s.id, c, s[c], flagTitle[c])).join("")}
      <td><button class="mini del" data-delstu="${s.id}" title="삭제">✕</button></td></tr>`; }).join("");
    return `<div class="table-scroll"><table class="grid"><thead><tr>
      <th>이름</th><th>리더십</th><th>관리</th><th>기획</th><th>작업</th><th>소통</th><th title="교과 단원 평균(자동)">교과평균</th><th>주성향</th><th>부성향</th><th>MBTI</th><th>이슈</th><th>비고</th>
      <th>멘탈</th><th>매몰</th><th title="한 팀 2명 금지(하드)">관리대상</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function studentOpts(p, val) { return `<option value="">–</option>` + p.students.map((s) => `<option value="${s.id}"${s.id === val ? " selected" : ""}>${esc(s.name)}</option>`).join(""); }

  function relationsBox(p) {
    const rows = p.relations.map((r, i) => `<div class="rel-row">
      <select data-rel="${i}" data-rcol="src">${studentOpts(p, r.src)}</select>
      <select data-rel="${i}" data-rcol="type"><option value="POS"${r.positive ? " selected" : ""}>👍</option><option value="NEG"${!r.positive ? " selected" : ""}>👎</option></select>
      <select data-rel="${i}" data-rcol="dst">${studentOpts(p, r.dst)}</select>
      <input type="number" min="1" max="3" data-rel="${i}" data-rcol="weight" value="${r.weight || 1}" title="강도 W" />
      <input class="rel-note" data-rel="${i}" data-rcol="note" value="${esc(r.note)}" placeholder="메모" />
      <button class="mini del" data-delrel="${i}">✕</button></div>`).join("");
    return `<section class="relations"><h3>관계 <button class="mini" data-act="add-rel">＋</button></h3>
      <p class="muted sm">FROM 👍/👎 TO · 강도 W(1–3)</p>${rows || '<p class="placeholder small">관계 없음</p>'}</section>`;
  }

  function constraintsBox(p) {
    const pairRows = (arr, kind) => arr.map((pr, i) => `<div class="rel-row">
      <select data-con="${kind}" data-ci="${i}" data-cslot="0">${studentOpts(p, pr[0])}</select>
      <span class="con-op">${kind === "together" ? "＝" : "≠"}</span>
      <select data-con="${kind}" data-ci="${i}" data-cslot="1">${studentOpts(p, pr[1])}</select>
      <button class="mini del" data-delcon="${kind}:${i}">✕</button></div>`).join("");
    return `<section class="constraints"><h3>운영진 강제 규칙</h3>
      <div class="con-group"><label>강제 결합 <button class="mini" data-act="add-together">＋</button></label>${pairRows(p.constraints.together, "together") || '<p class="placeholder small">없음</p>'}</div>
      <div class="con-group"><label>강제 분리 <button class="mini" data-act="add-apart">＋</button></label>${pairRows(p.constraints.apart, "apart") || '<p class="placeholder small">없음</p>'}</div></section>`;
  }

  // ---- CSV ----
  const STUDENTS_TEMPLATE = "id,name,leadership,management,planning,execution,communication,primary_disp,secondary_disp,mbti,issue_level,issue_note,mental,sunk,special\nS01,김규장,1,2,4,4,2,작업자,연구원,INTP,1,불안형 / 에고가 강한 편,Y,,Y\nS02,김민성,2,3,2,4,3,매니저,연구원,ESTJ,,,,,\n";
  const GRADES_TEMPLATE = "INDEX,이름,평균,1단원,2단원,3단원,4단원\n1,김규장,76.3,75,77,75,78\n2,김민성,73.5,63,70,88,73\n";
  const RELATIONS_TEMPLATE = "DATE,FROM,TO,TYPE,W,NOTE\n2026-06-10,김규장,이제희,NEG,3,소통이 전혀 되지 않음\n2026-07-09,윤희성,박송호,POS,3,함께하고 싶은 팀원\n";

  function exportStudents(p) {
    const unitCols = Array.from(new Set(p.students.flatMap((s) => Object.keys(s.units || {}))));
    const boolCols = ["special", "mental", "sunk"];
    const head = ["id", "name", ...COLS.map((c) => c[0]), "primary_disp", "secondary_disp", "mbti", "issue_level", "issue_note", ...boolCols, ...unitCols];
    const lines = [head.join(",")].concat(p.students.map((s) => head.map((h) => {
      let v = boolCols.includes(h) ? (s[h] ? "Y" : "") : (h in (s.units || {}) ? s.units[h] : s[h]); v = v == null ? "" : v;
      const t = String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    }).join(",")));
    global.UI.download("students.csv", "﻿" + lines.join("\n"), "text/csv");
  }
  function exportRelations(p) {
    const byId = Store.byId();
    const lines = ["FROM,TO,TYPE,W,NOTE"].concat(p.relations.map((r) => {
      const nm = (id) => { const s = byId.get(id); return s ? s.name : id; };
      return [nm(r.src), nm(r.dst), r.positive ? "POS" : "NEG", r.weight || 1, r.note || ""].map((v) => { const t = String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(",");
    }));
    global.UI.download("relations.csv", "﻿" + lines.join("\n"), "text/csv");
  }
  function importText(text, kind) {
    const p = Store.project();
    try {
      if (kind === "relations") { const rels = TB.loadRelations(text, p.students); Store.setRelations(rels); global.UI.toast(`관계 ${rels.length}건 가져옴`); return; }
      if (kind === "grades") { if (!p.students.length) return global.UI.toast("먼저 수강생을 불러오세요", "bad"); const g = TB.parseGrades(text, p.students); Store.applyGrades(g); global.UI.toast(`교과 점수 ${g.length}명 반영`); return; }
      const students = TB.loadStudents(text);
      // 새 학생 집합에 여전히 유효한 기존 관계만 유지
      const ids = new Set(students.map((s) => s.id));
      const rels = p.relations.filter((r) => ids.has(r.src) && ids.has(r.dst));
      Store.loadData(students, rels);
      global.UI.toast(`수강생 ${students.length}명 가져옴`);
    } catch (err) { global.UI.toast("가져오기 실패: " + err.message, "bad"); }
  }
  function importFile(file) {
    const r = new FileReader();
    r.onload = () => {
      const text = r.result;
      const head = (text.split(/\r?\n/)[0] || "").toLowerCase();
      const isRel = /from/.test(head) && /to/.test(head) && /type/.test(head);
      const isGrade = (head.indexOf("단원") >= 0 || /unit|chapter/.test(head)) && !/leadership|주성향|primary_disp/.test(head);
      importText(text, isRel ? "relations" : (isGrade ? "grades" : "students"));
    };
    r.readAsText(file, "utf-8");
  }

  // ---- 이벤트 ----
  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    const p = Store.project();
    if (b.dataset.delstu) return Store.deleteStudent(b.dataset.delstu);
    if (b.dataset.delrel != null) return Store.deleteRelation(Number(b.dataset.delrel));
    if (b.dataset.delcon != null) { const [k, i] = b.dataset.delcon.split(":"); const arr = p.constraints[k].slice(); arr.splice(Number(i), 1); const c = Object.assign({}, p.constraints); c[k] = arr; return Store.setConstraints(c); }
    const act = b.dataset.act;
    if (act === "sample") { const students = TB.loadStudents(global.SAMPLE_STUDENTS); const rels = TB.loadRelations(global.SAMPLE_RELATIONS, students); if (global.SAMPLE_GRADES) TB.parseGrades(global.SAMPLE_GRADES, students).forEach((g) => { const st = students.find((x) => x.id === g.id); if (st) st.units = g.units; }); Store.loadData(students, rels); global.UI.toast("샘플 불러옴"); return; }
    if (act === "import") return root.querySelector("#dfile").click();
    if (act === "add-student") { const s = { id: newId(p.students), name: "새 수강생", leadership: null, management: null, planning: null, execution: null, communication: null, primary_disp: null, secondary_disp: null, mbti: "", issue_level: 0, issue_note: "", special: false, mental: false, sunk: false, units: {} }; return Store.addStudent(s); }
    if (act === "add-rel") { if (!p.students.length) return global.UI.toast("먼저 수강생을 추가하세요", "bad"); return Store.addRelation({ src: p.students[0].id, dst: p.students[Math.min(1, p.students.length - 1)].id, positive: false, weight: 1, note: "" }); }
    if (act === "add-together" || act === "add-apart") { const k = act === "add-together" ? "together" : "apart"; if (p.students.length < 2) return global.UI.toast("수강생 2명 이상 필요", "bad"); const c = Object.assign({}, p.constraints); c[k] = c[k].concat([[p.students[0].id, p.students[1].id]]); return Store.setConstraints(c); }
    if (act === "tmpl-s") return global.UI.download("students_template.csv", "﻿" + STUDENTS_TEMPLATE, "text/csv");
    if (act === "tmpl-r") return global.UI.download("relations_template.csv", "﻿" + RELATIONS_TEMPLATE, "text/csv");
    if (act === "tmpl-g") return global.UI.download("grades_template.csv", "﻿" + GRADES_TEMPLATE, "text/csv");
    if (act === "exp-s") return exportStudents(p);
    if (act === "exp-r") return exportRelations(p);
  }
  function onChange(e) {
    const t = e.target, p = Store.project();
    if (t.dataset.id && t.dataset.col) {
      let v = t.value;
      if (t.type === "checkbox") v = t.checked;
      else if (NUM[t.dataset.col]) v = (v === "" ? (t.dataset.col === "issue_level" ? 0 : null) : Number(v));
      const patch = {}; patch[t.dataset.col] = v; return Store.updateStudent(t.dataset.id, patch);
    }
    if (t.dataset.rel != null) {
      const i = Number(t.dataset.rel), col = t.dataset.rcol;
      if (col === "type") return Store.updateRelation(i, { positive: t.value === "POS" });
      if (col === "weight") return Store.updateRelation(i, { weight: Number(t.value) });
      const patch = {}; patch[col] = t.value; return Store.updateRelation(i, patch);
    }
    if (t.dataset.con) {
      const k = t.dataset.con, i = Number(t.dataset.ci), slot = Number(t.dataset.cslot);
      const c = Object.assign({}, p.constraints); c[k] = c[k].map((x) => x.slice()); c[k][i][slot] = t.value; return Store.setConstraints(c);
    }
    if (t.id === "dfile") { const f = t.files[0]; if (f) importFile(f); t.value = ""; }
  }

  function init(container) {
    root = container;
    container.addEventListener("click", onClick);
    container.addEventListener("change", onChange);
    // 드래그&드롭 CSV
    container.addEventListener("dragover", (e) => { e.preventDefault(); container.classList.add("drag-file"); });
    container.addEventListener("dragleave", (e) => { if (e.target === container) container.classList.remove("drag-file"); });
    container.addEventListener("drop", (e) => { e.preventDefault(); container.classList.remove("drag-file"); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
  }
  global.ViewData = { init, render };
})(window);
