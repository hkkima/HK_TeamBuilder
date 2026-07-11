/* 상태 스토어 — 프로젝트 모델, 뮤테이션, undo/redo, localStorage 자동저장, .json 임포트/익스포트.
   뷰는 Store를 구독(subscribe)해 렌더링하고, 액션으로만 상태를 바꾼다. 순수 데이터/영속 계층. */
(function (global) {
  "use strict";
  const TB = global.TeamBuilder;
  const LS_KEY = "hk_tb_v3";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uid = () => "p" + Math.abs((Date.now() ^ (Math.floor(performance.now() * 1000))) | 0).toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  function defaultSettings() {
    return { mode: "teams", teams: 4, sizes: "6,6,6,5", options: 3, restarts: 80, seed: 42,
      weightsVersion: 2, weights: Object.assign({}, TB.DEFAULT_WEIGHTS) };
  }
  function emptyProject(name) {
    return { id: uid(), name: name || "새 프로젝트", updatedAt: Date.now(),
      students: [], relations: [], constraints: { together: [], apart: [] }, pins: {},
      settings: defaultSettings(),
      compositions: [], activeIndex: -1,
      board: { teams: [], pool: [], notes: [], leaderByTeam: [], deputyByTeam: [], teamNames: [] } };
  }

  const state = { projects: {}, currentId: null };
  let ui = { tab: "data", undo: [], redo: [] };
  const listeners = new Set();
  let graphCache = null, graphDirty = true, saveTimer = null;

  function notify() { listeners.forEach((fn) => fn()); }
  function cur() { return state.projects[state.currentId]; }

  // ---- 영속 ----
  function writeNow() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ projects: state.projects, currentId: state.currentId })); }
    catch (e) { /* 용량 초과 등 무시 */ }
  }
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(writeNow, 350); }
  function flush() { clearTimeout(saveTimer); writeNow(); }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.projects || !Object.keys(data.projects).length) return false;
      state.projects = data.projects;
      state.currentId = data.currentId && data.projects[data.currentId] ? data.currentId : Object.keys(data.projects)[0];
      Object.values(state.projects).forEach(migrateProject);
      return true;
    } catch (e) { return false; }
  }
  function migrateProject(p) {
    p.constraints = p.constraints || { together: [], apart: [] };
    p.pins = p.pins || {};
    p.settings = Object.assign(defaultSettings(), p.settings || {});
    p.settings.weights = Object.assign({}, TB.DEFAULT_WEIGHTS, p.settings.weights || {});
    // 가중치 모델 v2: 성향 분포 강화 + 카테고리 태그(flag_*) 자동 반영 제거.
    // 알고리즘 기본 키를 새 기본값으로 1회 초기화(성향 분포 metric 의미가 바뀜).
    if (p.settings.weightsVersion !== 2) {
      ["flag_same", "flag_cross", "disp_diversity", "positive", "issue_balance",
        "mbti_balance", "competency_coverage", "competency_balance"].forEach((k) => {
        p.settings.weights[k] = TB.DEFAULT_WEIGHTS[k];
      });
      p.settings.weightsVersion = 2;
    }
    p.board = p.board || { teams: [], pool: [], notes: [], leaderByTeam: [], deputyByTeam: [], teamNames: [] };
    p.board.teamNames = p.board.teamNames || p.board.teams.map((_, i) => "팀 " + (i + 1));
    p.board.deputyByTeam = p.board.deputyByTeam || p.board.teams.map(() => null);
  }

  // ---- undo/redo ----
  function snapshotFields(p) {
    return clone({ students: p.students, relations: p.relations, constraints: p.constraints,
      pins: p.pins, settings: p.settings, compositions: p.compositions, activeIndex: p.activeIndex, board: p.board });
  }
  function pushUndo() {
    const p = cur(); if (!p) return;
    ui.undo.push(snapshotFields(p));
    if (ui.undo.length > 60) ui.undo.shift();
    ui.redo.length = 0;
  }
  function restore(snap) { Object.assign(cur(), clone(snap)); graphDirty = true; }
  function undo() { if (!ui.undo.length) return; ui.redo.push(snapshotFields(cur())); restore(ui.undo.pop()); touch(false); }
  function redo() { if (!ui.redo.length) return; ui.undo.push(snapshotFields(cur())); restore(ui.redo.pop()); touch(false); }

  // 변경 후 공통 처리
  function touch(record) {
    const p = cur(); if (!p) return;
    p.updatedAt = Date.now();
    graphDirty = true;
    persist(); notify();
  }
  // 뮤테이션 래퍼: undo 기록 후 fn 실행
  function mut(fn) { return function () { pushUndo(); fn.apply(null, arguments); touch(true); }; }

  // ---- 파생값 ----
  function byId() { const m = new Map(); (cur().students || []).forEach((s) => m.set(s.id, s)); return m; }
  function graph() {
    if (graphDirty || !graphCache) { graphCache = TB.buildGraph(cur().students, cur().relations); graphDirty = false; }
    return graphCache;
  }
  function weights() { return cur().settings.weights; }
  function forceSets() {
    const c = cur().constraints;
    return { together: TB.pairsToSet(c.together), separate: TB.pairsToSet(c.apart) };
  }

  // ---- 보드 유틸 ----
  function reconcileBoard() {
    const p = cur(), valid = new Set(p.students.map((s) => s.id));
    const seen = new Set();
    p.board.teams = p.board.teams.map((t) => t.filter((id) => valid.has(id) && !seen.has(id) && seen.add(id)));
    p.board.pool = (p.board.pool || []).filter((id) => valid.has(id) && !seen.has(id) && seen.add(id));
    p.students.forEach((s) => { if (!seen.has(s.id)) p.board.pool.push(s.id); });
    // 삭제된 학생의 핀/리더 정리
    Object.keys(p.pins).forEach((id) => { if (!valid.has(id)) delete p.pins[id]; });
    p.board.leaderByTeam = p.board.teams.map((_, ti) => {
      const l = p.board.leaderByTeam[ti];
      return (l && p.board.teams[ti].includes(l)) ? l : null;
    });
    p.board.deputyByTeam = p.board.teams.map((_, ti) => {
      const d = (p.board.deputyByTeam || [])[ti];
      return (d && p.board.teams[ti].includes(d) && d !== p.board.leaderByTeam[ti]) ? d : null;
    });
    p.board.notes = p.board.teams.map((_, ti) => p.board.notes[ti] || "");
    p.board.teamNames = p.board.teams.map((_, ti) => p.board.teamNames[ti] || ("팀 " + (ti + 1)));
  }
  function teamOf(id) { const t = cur().board.teams; for (let i = 0; i < t.length; i++) if (t[i].includes(id)) return i; return -1; }
  function makeTeams(n) {
    const p = cur();
    p.board.teams = Array.from({ length: n }, () => []);
    p.board.notes = Array.from({ length: n }, () => "");
    p.board.leaderByTeam = Array.from({ length: n }, () => null);
    p.board.deputyByTeam = Array.from({ length: n }, () => null);
    p.board.teamNames = Array.from({ length: n }, (_, i) => "팀 " + (i + 1));
  }

  // ---- 액션 (외부 API) ----
  const Store = {
    init() {
      if (!load()) {
        const p = emptyProject("기본 프로젝트");
        state.projects[p.id] = p; state.currentId = p.id;
      }
      global.addEventListener("beforeunload", flush);
      global.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
      return Store;
    },
    flush,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // 접근자
    project: cur,
    ui: () => ui,
    byId, graph, weights, forceSets, teamOf,
    listProjects: () => Object.values(state.projects).sort((a, b) => b.updatedAt - a.updatedAt),
    canUndo: () => ui.undo.length > 0,
    canRedo: () => ui.redo.length > 0,
    setTab: (t) => { ui.tab = t; notify(); },

    undo, redo,

    // 프로젝트 관리
    newProject: (name) => { const p = emptyProject(name); state.projects[p.id] = p; state.currentId = p.id; ui = { tab: "data", undo: [], redo: [] }; graphDirty = true; persist(); notify(); },
    switchProject: (id) => { if (state.projects[id]) { state.currentId = id; ui = { tab: ui.tab, undo: [], redo: [] }; graphDirty = true; notify(); } },
    renameProject: mut((name) => { cur().name = name; }),
    deleteProject: (id) => {
      delete state.projects[id];
      if (state.currentId === id) {
        const ids = Object.keys(state.projects);
        if (!ids.length) { const p = emptyProject("기본 프로젝트"); state.projects[p.id] = p; state.currentId = p.id; }
        else state.currentId = ids[0];
      }
      graphDirty = true; ui = { tab: ui.tab, undo: [], redo: [] }; persist(); notify();
    },

    // 데이터 뮤테이션
    setStudents: mut((list) => { cur().students = list; reconcileBoard(); }),
    setRelations: mut((list) => { cur().relations = list; }),
    applyGrades: mut((list) => { const m = byId(); list.forEach((g) => { const s = m.get(g.id); if (s) s.units = g.units; }); }),
    addStudent: mut((s) => { cur().students.push(s); cur().board.pool.push(s.id); }),
    updateStudent: mut((id, patch) => { const s = cur().students.find((x) => x.id === id); if (s) Object.assign(s, patch); }),
    deleteStudent: mut((id) => { cur().students = cur().students.filter((s) => s.id !== id); reconcileBoard(); }),
    addRelation: mut((r) => { cur().relations.push(r); }),
    updateRelation: mut((i, patch) => { if (cur().relations[i]) Object.assign(cur().relations[i], patch); }),
    deleteRelation: mut((i) => { cur().relations.splice(i, 1); }),
    setConstraints: mut((c) => { cur().constraints = c; }),
    setSettings: mut((patch) => { Object.assign(cur().settings, patch); }),
    setWeights: mut((w) => { Object.assign(cur().settings.weights, w); }),

    // 보드 뮤테이션
    moveStudent: mut((id, zone) => {
      const b = cur().board;
      b.teams.forEach((t) => { const k = t.indexOf(id); if (k >= 0) t.splice(k, 1); });
      const pk = b.pool.indexOf(id); if (pk >= 0) b.pool.splice(pk, 1);
      b.leaderByTeam = b.leaderByTeam.map((l) => (l === id ? null : l));
      b.deputyByTeam = (b.deputyByTeam || []).map((d) => (d === id ? null : d));
      if (cur().pins[id] != null) delete cur().pins[id]; // 옮기면 핀 해제
      if (zone === "pool") b.pool.push(id); else b.teams[Number(zone.split("-")[1])].push(id);
    }),
    setBoardTeams: mut((idTeams) => { const b = cur().board; b.teams = idTeams.map((t) => t.slice()); b.pool = []; reconcileBoard(); }),
    toggleLeader: mut((id) => { const ti = teamOf(id); if (ti < 0) return; const b = cur().board; const set = b.leaderByTeam[ti] === id ? null : id; b.leaderByTeam[ti] = set; if (set != null && b.deputyByTeam[ti] === id) b.deputyByTeam[ti] = null; }),
    toggleDeputy: mut((id) => { const ti = teamOf(id); if (ti < 0) return; const b = cur().board; const set = b.deputyByTeam[ti] === id ? null : id; b.deputyByTeam[ti] = set; if (set != null && b.leaderByTeam[ti] === id) b.leaderByTeam[ti] = null; }),
    setTeamNote: mut((ti, text) => { cur().board.notes[ti] = text; }),
    renameTeam: mut((ti, name) => { cur().board.teamNames[ti] = name; }),
    togglePin: mut((id) => { const p = cur(); const ti = teamOf(id); if (ti < 0) { delete p.pins[id]; return; } if (p.pins[id] != null) delete p.pins[id]; else p.pins[id] = ti; }),
    toggleTeamLock: mut((ti) => { const p = cur(); const ids = p.board.teams[ti] || []; const allP = ids.length && ids.every((id) => p.pins[id] != null); if (allP) ids.forEach((id) => delete p.pins[id]); else ids.forEach((id) => { p.pins[id] = ti; }); }),
    clearPins: mut(() => { cur().pins = {}; }),

    // 편성 시작/조합
    startBlank: mut(() => { const p = cur(); const n = settingTeamCount(); makeTeams(n); p.board.pool = p.students.map((s) => s.id); p.activeIndex = -1; p.pins = {}; }),
    setRecommendations: mut((recs) => {
      const p = cur();
      p.compositions = recs.map((rec, i) => ({ name: "추천안 " + (i + 1), src: "추천",
        teams: rec.teams.map((t) => t.map((m) => m.id)),
        notes: rec.teams.map(() => ""),
        leaderByTeam: (rec.leaderByTeam || rec.teams.map(() => null)).slice(),
        deputyByTeam: (rec.deputyByTeam || rec.teams.map(() => null)).slice(),
        teamNames: rec.teams.map((_, ti) => "팀 " + (ti + 1)), pins: clone(p.pins) }));
      loadCompInternal(0);
    }),
    loadComposition: mut((i) => loadCompInternal(i)),
    saveComposition: mut((name) => {
      const p = cur();
      p.compositions.push({ name: name || ("저장 " + (p.compositions.length + 1)), src: "저장",
        teams: p.board.teams.map((t) => t.slice()), notes: p.board.notes.slice(),
        leaderByTeam: p.board.leaderByTeam.slice(), deputyByTeam: (p.board.deputyByTeam || []).slice(),
        teamNames: p.board.teamNames.slice(), pins: clone(p.pins) });
      p.activeIndex = p.compositions.length - 1;
    }),
    deleteComposition: mut((i) => { const p = cur(); p.compositions.splice(i, 1); if (p.activeIndex === i) p.activeIndex = -1; else if (p.activeIndex > i) p.activeIndex -= 1; }),

    // 임포트/익스포트
    exportProject: (id) => JSON.stringify(state.projects[id || state.currentId], null, 2),
    importProject: (json) => {
      const p = JSON.parse(json); p.id = uid(); if (!p.name) p.name = "가져온 프로젝트"; migrateProject(p);
      state.projects[p.id] = p; state.currentId = p.id; ui = { tab: "data", undo: [], redo: [] }; graphDirty = true; persist(); notify();
    },
    // 뷰가 직접 데이터 로딩 후 커밋할 때
    loadData: mut((students, relations) => { const p = cur(); p.students = students; p.relations = relations; reconcileBoard(); }),
  };

  function settingTeamCount() {
    const s = cur().settings;
    if (s.mode === "sizes") { const arr = String(s.sizes).split(",").map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)); return arr.length || 1; }
    return Math.max(1, Number(s.teams) || 1);
  }
  function loadCompInternal(i) {
    const p = cur(), c = p.compositions[i]; if (!c) return;
    p.board = { teams: c.teams.map((t) => t.slice()), pool: [],
      notes: (c.notes || c.teams.map(() => "")).slice(),
      leaderByTeam: (c.leaderByTeam || c.teams.map(() => null)).slice(),
      deputyByTeam: (c.deputyByTeam || c.teams.map(() => null)).slice(),
      teamNames: (c.teamNames || c.teams.map((_, ti) => "팀 " + (ti + 1))).slice() };
    p.pins = clone(c.pins || {});
    p.activeIndex = i;
    reconcileBoard();
  }

  Store.settingTeamCount = settingTeamCount;
  global.Store = Store;
})(window);
