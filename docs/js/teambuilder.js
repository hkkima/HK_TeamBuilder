/* 수강생 팀빌더 v2 — 클라이언트 알고리즘 (Python teambuilder 패키지의 JS 포팅).
   성향6 · 역량5 · 이슈강도 · 방향성 POS/NEG(W) 관계. 계산은 브라우저 내에서만. */
(function (global) {
  "use strict";

  const MBTI_AXES = [["E", "I"], ["N", "S"], ["T", "F"], ["J", "P"]];
  const DISPOSITIONS = ["작업자", "매니저", "분위기메이커", "책임자", "연구원", "서포터"];
  const LEADER_DISPS = ["책임자", "매니저"];
  const REQUIRED_DISPS = ["분위기메이커", "매니저", "책임자"];
  const DISP_SUPPORTER = "서포터";
  const FLAG_FIELDS = ["mental", "sunk"];
  const coversDisp = (m, r) => m.primary_disp === r || m.secondary_disp === r;
  const STRONG = 4, LEADERSHIP_TH = 2, HIGH_ISSUE = 2;
  const DISP_ALIASES = {
    "작업자": "작업자", "worker": "작업자", "실무자": "작업자",
    "매니저": "매니저", "manager": "매니저", "관리자": "매니저",
    "분위기메이커": "분위기메이커", "분위기": "분위기메이커", "mood": "분위기메이커", "moodmaker": "분위기메이커", "윤활유": "분위기메이커",
    "책임자": "책임자", "owner": "책임자", "리더": "책임자", "leader": "책임자",
    "연구원": "연구원", "연구자": "연구원", "researcher": "연구원", "분석가": "연구원",
    "서포터": "서포터", "supporter": "서포터", "조력자": "서포터",
  };
  function normalizeDisp(raw) {
    if (!raw) return null;
    const key = String(raw).trim().toLowerCase().replace(/\s+/g, "");
    return DISP_ALIASES[key] || String(raw).trim();
  }

  // ---- CSV 파싱 ----
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim());
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      if (rows[r].length === 1 && rows[r][0].trim() === "") continue;
      const obj = {};
      header.forEach((h, ci) => { obj[h] = (rows[r][ci] !== undefined ? rows[r][ci] : "").trim(); });
      out.push(obj);
    }
    return out;
  }
  const TRUTHY = new Set(["y", "yes", "1", "true", "t", "o", "특별", "특수", "√", "v", "x"]);
  const truthy = (v) => TRUTHY.has(String(v).trim().toLowerCase());
  const pick = (row, keys) => { for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== "") return String(row[k]).trim(); return ""; };
  const pickNum = (row, keys) => { const v = pick(row, keys); if (v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

  // ---- 학생 로딩 ----
  function loadStudents(text) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error("학생 데이터가 비어 있습니다.");
    const unitCols = Object.keys(rows[0]).filter((h) => h && (h.indexOf("단원") >= 0 || /^unit|^chapter/i.test(h)));
    const students = [], seen = new Set();
    rows.forEach((row) => {
      const name = pick(row, ["name", "이름"]);
      if (!name) return;
      const id = pick(row, ["id", "student_id"]) || name;
      if (seen.has(id)) throw new Error(`중복된 식별자 '${id}'`);
      seen.add(id);
      const units = {};
      unitCols.forEach((c) => { const v = pickNum(row, [c]); if (v != null) units[c] = v; });
      students.push({
        id, name,
        leadership: pickNum(row, ["leadership", "리더십"]),
        management: pickNum(row, ["management", "관리능력", "관리 능력", "관리"]),
        planning: pickNum(row, ["planning", "기획역량", "기획 역량", "기획"]),
        execution: pickNum(row, ["execution", "작업역량", "작업 역량", "작업"]),
        communication: pickNum(row, ["communication", "소통능력", "소통 능력", "소통"]),
        primary_disp: normalizeDisp(pick(row, ["primary_disp", "주성향", "주 성향", "성향"])),
        secondary_disp: normalizeDisp(pick(row, ["secondary_disp", "부성향", "부 성향"])),
        mbti: pick(row, ["mbti", "MBTI"]).toUpperCase(),
        issue_level: pickNum(row, ["issue_level", "이슈강도", "이슈 강도"]) || 0,
        issue_note: pick(row, ["issue_note", "이슈비고", "이슈 비고", "비고"]),
        special: truthy(pick(row, ["special", "관리대상", "관리 대상", "특수관리", "특수 관리", "특별관리", "특별", "tag"])),
        mental: truthy(pick(row, ["mental", "멘탈이슈", "멘탈 이슈", "멘탈"])),
        sunk: truthy(pick(row, ["sunk", "매몰성향", "매몰 성향", "매몰"])),
        units,
      });
    });
    if (!students.length) throw new Error("학생 데이터가 비어 있습니다.");
    return students;
  }

  function buildResolver(students) {
    const idSet = new Set(students.map((s) => s.id));
    const nameMap = new Map();
    students.forEach((s) => { if (!nameMap.has(s.name)) nameMap.set(s.name, []); nameMap.get(s.name).push(s.id); });
    return (token) => {
      token = String(token).trim();
      if (idSet.has(token)) return token;
      const ids = nameMap.get(token);
      if (!ids) throw new Error(`등록되지 않은 학생 '${token}'`);
      if (ids.length > 1) throw new Error(`이름 '${token}' 중복 — id로 구분 필요`);
      return ids[0];
    };
  }

  const POSSET = new Set(["pos", "positive", "긍정", "+", "p"]);
  const NEGSET = new Set(["neg", "negative", "부정", "-", "n"]);

  // 교과 점수 별도 CSV → [{id, units}] (이름/ id 로 매칭, '단원'/'unit' 컬럼)
  function parseGrades(text, students) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const unitCols = Object.keys(rows[0]).filter((h) => h && (h.indexOf("단원") >= 0 || /^unit|^chapter/i.test(h)));
    const resolve = buildResolver(students);
    const out = [];
    rows.forEach((row) => {
      const tok = pick(row, ["name", "이름", "id", "INDEX", "index"]);
      if (!tok) return;
      let id; try { id = resolve(tok); } catch (e) { return; }
      const units = {};
      unitCols.forEach((c) => { const v = pickNum(row, [c]); if (v != null) units[c] = v; });
      if (Object.keys(units).length) out.push({ id, units });
    });
    return out;
  }

  function loadRelations(text, students) {
    const resolve = buildResolver(students);
    const rows = parseCSV(text), rels = [];
    rows.forEach((row) => {
      const s = pick(row, ["from", "FROM", "src", "평가자"]);
      const d = pick(row, ["to", "TO", "dst", "대상"]);
      if (!s || !d) return;
      const t = pick(row, ["type", "TYPE", "유형"]).toLowerCase();
      let positive;
      if (POSSET.has(t)) positive = true; else if (NEGSET.has(t)) positive = false;
      else throw new Error(`알 수 없는 관계 유형 '${t}'`);
      const a = resolve(s), b = resolve(d);
      if (a === b) return;
      rels.push({ src: a, dst: b, positive, weight: pickNum(row, ["weight", "W", "가중치", "강도"]) || 1, note: pick(row, ["note", "NOTE", "비고", "메모"]) });
    });
    return rels;
  }

  // ---- 관계 그래프 ----
  const pairKey = (a, b) => (a <= b ? a + "|" + b : b + "|" + a);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  function buildGraph(students, relations, opt) {
    opt = opt || {};
    const maxW = opt.maxWeight != null ? opt.maxWeight : 3.0;
    const posW = new Map(), negW = new Map(), notes = new Map();
    (relations || []).forEach((r) => {
      const k = pairKey(r.src, r.dst);
      if (r.positive) posW.set(k, (posW.get(k) || 0) + r.weight);
      else negW.set(k, (negW.get(k) || 0) + r.weight);
      if (r.note) { if (!notes.has(k)) notes.set(k, []); notes.get(k).push(r.note); }
    });
    const conflicts = new Set(), positives = new Set(), severity = new Map(), strength = new Map(), net = new Map();
    const denom = Math.max(1e-9, 2 * maxW);
    const all = new Set([...posW.keys(), ...negW.keys()]);
    all.forEach((k) => {
      const p = posW.get(k) || 0, n = negW.get(k) || 0;
      net.set(k, p - n);
      if (n > 0 && p - n <= 0) { conflicts.add(k); severity.set(k, clamp01(n / denom)); }
      else if (p > 0 && n === 0) { positives.add(k); strength.set(k, clamp01(p / denom)); }
    });
    return { conflicts, positives, severity, strength, net, notes, nPairs: all.size };
  }

  // ---- 학생 헬퍼 ----
  const compValue = (m) => {
    const vs = Object.values(m.units || {}).filter((v) => v != null);
    return vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length : null;
  };
  const leaderCandidate = (m) =>
    (m.leadership != null && m.leadership >= LEADERSHIP_TH) ||
    LEADER_DISPS.includes(m.primary_disp) || LEADER_DISPS.includes(m.secondary_disp);
  const highIssue = (m) => (m.issue_level || 0) >= HIGH_ISSUE;

  // ---- 점수화 ----
  const DEFAULT_WEIGHTS = {
    conflict: 100, positive: 8, special_stack: 500, issue_stack: 40, issue_balance: 10,
    flag_same: 60, flag_cross: 4, role_required: 25, role_supporter: 5,
    disp_diversity: 10, leader: 14, mbti_balance: 8,
    competency_coverage: 8, competency_balance: 6,
    conflict_intensity: 1.0, positive_intensity: 0.5, competency_metric: "stdev",
    force_together: 1000, force_separate: 1000,
  };
  function pstdev(arr) { if (arr.length < 2) return 0; const m = arr.reduce((s, v) => s + v, 0) / arr.length; return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length); }

  function mbtiBalance(teams) {
    const scores = [];
    for (const t of teams) {
      const known = t.filter((m) => m.mbti && m.mbti.length >= 4);
      if (known.length < 2) continue;
      let acc = 0;
      MBTI_AXES.forEach((ax, ai) => { const cp = known.filter((m) => m.mbti[ai] === ax[0]).length; acc += 1 - Math.abs(cp - (known.length - cp)) / known.length; });
      scores.push(acc / MBTI_AXES.length);
    }
    return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  }
  function dispDiversity(teams) {
    const scores = [];
    for (const t of teams) {
      const s = new Set();
      t.forEach((m) => { [m.primary_disp, m.secondary_disp].forEach((d) => { if (DISPOSITIONS.includes(d)) s.add(d); }); });
      const cap = Math.min(DISPOSITIONS.length, t.length);
      if (cap) scores.push(Math.min(s.size, cap) / cap);
    }
    return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  }
  function leaderBalance(teams) { if (!teams.length) return 0; let h = 0; for (const t of teams) if (t.some(leaderCandidate)) h++; return h / teams.length; }
  function compCoverage(teams) {
    const scores = [];
    for (const t of teams) {
      if (!t.length) continue;
      let c = 0;
      ["planning", "execution", "communication"].forEach((a) => { if (t.some((m) => m[a] != null && m[a] >= STRONG)) c++; });
      scores.push(c / 3);
    }
    return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  }
  function compBalance(teams, metric) {
    const avgs = [];
    for (const t of teams) { const vs = t.map(compValue).filter((v) => v != null); if (vs.length) avgs.push(vs.reduce((s, x) => s + x, 0) / vs.length); }
    if (avgs.length < 2) return 0;
    return metric === "range" ? Math.max(...avgs) - Math.min(...avgs) : pstdev(avgs);
  }
  function issueBalance(teams) { const tot = teams.map((t) => t.reduce((s, m) => s + (m.issue_level || 0), 0)); return tot.length >= 2 ? pstdev(tot) : 0; }
  function issueStacks(teams) { let e = 0; for (const t of teams) { const hi = t.filter(highIssue).length; if (hi > 1) e += hi - 1; } return e; }
  function specialStacks(teams) { let e = 0; for (const t of teams) { const sp = t.filter((m) => m.special).length; if (sp > 1) e += sp - 1; } return e; }
  function flagSame(teams) { let e = 0; for (const t of teams) for (const f of FLAG_FIELDS) { const c = t.filter((m) => m[f]).length; if (c > 1) e += c - 1; } return e; }
  function flagCross(teams) {
    let e = 0;
    for (const t of teams) {
      const flagged = t.filter((m) => FLAG_FIELDS.some((f) => m[f])).length;
      let same = 0; FLAG_FIELDS.forEach((f) => { const c = t.filter((m) => m[f]).length; same += c * (c - 1) / 2; });
      e += Math.max(0, flagged * (flagged - 1) / 2 - same);
    }
    return e;
  }
  function roleMissing(teams) { let m = 0; for (const t of teams) { if (!t.length) continue; for (const r of REQUIRED_DISPS) if (!t.some((s) => coversDisp(s, r))) m++; } return m; }
  function roleSupporterFrac(teams) { const ne = teams.filter((t) => t.length); if (!ne.length) return 0; return ne.filter((t) => t.some((s) => coversDisp(s, DISP_SUPPORTER))).length / ne.length; }

  function scorePartition(teams, graph, w, forceTogether, forceSeparate) {
    forceTogether = forceTogether || new Set();
    forceSeparate = forceSeparate || new Set();
    const intra = [], kept = [], violatedSeparate = [];
    let conflictPenalty = 0, positiveBonus = 0;
    const sameTeam = new Set();
    for (const t of teams) {
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const k = pairKey(t[i].id, t[j].id); sameTeam.add(k);
        if (graph.conflicts.has(k)) { intra.push(k); conflictPenalty += w.conflict * (1 + w.conflict_intensity * (graph.severity.get(k) || 0)); }
        else if (graph.positives.has(k)) { kept.push(k); positiveBonus += w.positive * (1 + w.positive_intensity * (graph.strength.get(k) || 0)); }
        if (forceSeparate.has(k)) violatedSeparate.push(k);
      }
    }
    const brokenTogether = [];
    forceTogether.forEach((k) => { if (!sameTeam.has(k)) brokenTogether.push(k); });
    const stacks = issueStacks(teams);
    const spStacks = specialStacks(teams);
    const fSame = flagSame(teams);
    const roleMiss = roleMissing(teams);
    const parts = {
      conflict: -conflictPenalty, positive: +positiveBonus,
      special_stack: -w.special_stack * spStacks,
      flag_same: -w.flag_same * fSame,
      flag_cross: -w.flag_cross * flagCross(teams),
      role_required: -w.role_required * roleMiss,
      role_supporter: +w.role_supporter * roleSupporterFrac(teams),
      issue_stack: -w.issue_stack * stacks,
      issue_balance: -w.issue_balance * issueBalance(teams),
      disp_diversity: +w.disp_diversity * dispDiversity(teams),
      leader: +w.leader * leaderBalance(teams),
      mbti_balance: +w.mbti_balance * mbtiBalance(teams),
      competency_coverage: +w.competency_coverage * compCoverage(teams),
      competency_balance: -w.competency_balance * compBalance(teams, w.competency_metric),
      force_together: -w.force_together * brokenTogether.length,
      force_separate: -w.force_separate * violatedSeparate.length,
    };
    let total = 0; for (const k in parts) total += parts[k];
    return { total, parts, intra, kept, brokenTogether, violatedSeparate, issueStacks: stacks, specialStacks: spStacks, flagSameStacks: fSame, roleMissing: roleMiss };
  }

  // ---- 시드 RNG ----
  function makeRng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  function sizesFor(n, teams, sizes) {
    if (sizes && sizes.length) { const sum = sizes.reduce((s, v) => s + v, 0); if (sum !== n) throw new Error(`팀 크기 합(${sum})이 인원수(${n})와 다릅니다.`); return sizes.slice(); }
    if (!teams || teams < 1) throw new Error("팀 개수 또는 팀 크기를 지정하세요.");
    if (teams > n) throw new Error("팀 수가 인원수보다 많습니다.");
    const base = Math.floor(n / teams), rem = n % teams;
    return Array.from({ length: teams }, (_, i) => (i < rem ? base + 1 : base));
  }
  function partitionFrom(students, assign, nTeams) { const teams = Array.from({ length: nTeams }, () => []); students.forEach((s, i) => teams[assign[i]].push(s)); return teams; }
  function signature(teams) { return teams.map((t) => t.map((m) => m.id).sort().join(",")).sort().join("|"); }

  function pairsToSet(pairs) { const s = new Set(); (pairs || []).forEach(([a, b]) => { if (a && b && a !== b) s.add(pairKey(a, b)); }); return s; }
  function resolvePairs(pairs, students) { const r = buildResolver(students); return (pairs || []).map(([a, b]) => [r(a), r(b)]); }

  function buildGroups(ids, forceTogether) {
    const idx = new Map(ids.map((id, i) => [id, i])), parent = ids.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    forceTogether.forEach((k) => { const [a, b] = k.split("|"); const ra = find(idx.get(a)), rb = find(idx.get(b)); if (ra !== rb) parent[ra] = rb; });
    const g = new Map(); ids.forEach((_, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(i); });
    return Array.from(g.values());
  }
  function validateConstraints(students, sizes, forceTogether, forceSeparate, pins) {
    pins = pins || {};
    const ids = students.map((s) => s.id), idSet = new Set(ids);
    [forceTogether, forceSeparate].forEach((set) => set.forEach((k) => { const [a, b] = k.split("|"); if (!idSet.has(a) || !idSet.has(b)) throw new Error(`제약에 없는 학생 id: ${a}, ${b}`); }));
    const groups = buildGroups(ids, forceTogether), idx = new Map(ids.map((id, i) => [id, i])), mg = new Map();
    groups.forEach((g, gi) => g.forEach((i) => mg.set(i, gi)));
    const maxTeam = Math.max(...sizes);
    for (const g of groups) if (g.length > maxTeam) throw new Error(`강제 결합 그룹 크기(${g.length})가 최대 팀 크기(${maxTeam}) 초과: ` + g.map((i) => ids[i]).join(", "));
    forceSeparate.forEach((k) => { const [a, b] = k.split("|"); if (mg.get(idx.get(a)) === mg.get(idx.get(b))) throw new Error(`${a}, ${b}는 강제 결합으로 묶여 분리 불가(모순).`); });
    // 핀 검증
    const nTeams = sizes.length, perTeam = new Array(nTeams).fill(0), groupPin = new Map();
    Object.keys(pins).forEach((pid) => {
      const t = pins[pid];
      if (!idSet.has(pid)) throw new Error(`핀에 없는 학생 id: ${pid}`);
      if (!Number.isInteger(t) || t < 0 || t >= nTeams) throw new Error(`핀 팀 인덱스 범위 오류: ${pid}→${t}`);
      perTeam[t]++;
      const gi = mg.get(idx.get(pid));
      if (groupPin.has(gi) && groupPin.get(gi) !== t) throw new Error(`강제 결합 그룹이 서로 다른 팀에 핀됨(모순): ${pid}`);
      groupPin.set(gi, t);
    });
    for (let t = 0; t < nTeams; t++) if (perTeam[t] > sizes[t]) throw new Error(`팀 ${t + 1}에 핀 ${perTeam[t]}명 > 정원 ${sizes[t]}`);
    forceSeparate.forEach((k) => { const [a, b] = k.split("|"); if (pins[a] != null && pins[b] != null && pins[a] === pins[b]) throw new Error(`${a}, ${b}는 분리 대상인데 같은 팀에 핀됨(모순).`); });
    // 특수 관리 태그 검증
    const spIdx = students.map((s, i) => s.special ? i : -1).filter((i) => i >= 0);
    if (spIdx.length > nTeams) throw new Error(`특수 관리 태그 ${spIdx.length}명 > 팀 ${nTeams}개 — 팀 수를 늘리세요.`);
    const grpSp = new Map();
    spIdx.forEach((i) => { const gi = mg.get(i); if (grpSp.has(gi)) throw new Error(`특수 관리 태그 2명이 강제 결합으로 묶여 분리 불가(모순): ${ids[grpSp.get(gi)]}, ${ids[i]}`); grpSp.set(gi, i); });
    const pinSp = new Map();
    spIdx.forEach((i) => { const t = pins[ids[i]]; if (t != null) { if (pinSp.has(t)) throw new Error(`특수 관리 태그 2명이 같은 팀에 핀됨(모순): ${ids[pinSp.get(t)]}, ${ids[i]}`); pinSp.set(t, i); } });
    return groups;
  }
  function seedAssignment(students, sizes, groups, forceSeparate, rng, pins, specialIdx) {
    pins = pins || {}; specialIdx = specialIdx || new Set();
    const ids = students.map((s) => s.id), nTeams = sizes.length, remaining = sizes.slice();
    const assign = new Array(students.length).fill(-1), inTeam = Array.from({ length: nTeams }, () => new Set()), sep = new Map();
    const teamHasSp = new Array(nTeams).fill(false);
    forceSeparate.forEach((k) => { const [a, b] = k.split("|"); if (!sep.has(a)) sep.set(a, new Set()); if (!sep.has(b)) sep.set(b, new Set()); sep.get(a).add(b); sep.get(b).add(a); });
    const grpSp = groups.map((grp) => grp.some((i) => specialIdx.has(i)));
    const groupPin = new Map();
    groups.forEach((grp, gi) => { for (const i of grp) if (pins[ids[i]] != null) { groupPin.set(gi, pins[ids[i]]); break; } });
    const place = (gi, t) => { const grp = groups[gi]; if (remaining[t] < grp.length) return false; if (grpSp[gi] && teamHasSp[t]) return false; grp.forEach((i) => { assign[i] = t; inTeam[t].add(ids[i]); }); remaining[t] -= grp.length; if (grpSp[gi]) teamHasSp[t] = true; return true; };
    const cost = (gids, t) => { let c = 0; gids.forEach((g) => (sep.get(g) || new Set()).forEach((p) => { if (inTeam[t].has(p)) c++; })); return c; };
    const placeFree = (gi) => {
      const grp = groups[gi], gids = grp.map((i) => ids[i]);
      let cand = []; for (let t = 0; t < nTeams; t++) if (remaining[t] >= grp.length && !(grpSp[gi] && teamHasSp[t])) cand.push(t);
      if (!cand.length) return false;
      shuffle(cand, rng); cand.sort((a, b) => cost(gids, a) - cost(gids, b));
      return place(gi, cand[0]);
    };
    for (const [gi, t] of groupPin) if (!place(gi, t)) return null;
    const spOrder = groups.map((_, gi) => gi).filter((gi) => grpSp[gi] && !groupPin.has(gi)).sort((x, y) => (groups[y].length - groups[x].length) || (rng() - 0.5));
    for (const gi of spOrder) if (!placeFree(gi)) return null;
    const rest = groups.map((_, gi) => gi).filter((gi) => !grpSp[gi] && !groupPin.has(gi)).sort((x, y) => (groups[y].length - groups[x].length) || (rng() - 0.5));
    for (const gi of rest) if (!placeFree(gi)) return null;
    return assign;
  }
  function localSearch(students, assign, sizes, graph, w, rng, maxIter, fT, fS, pinned, specialIdx) {
    pinned = pinned || new Set(); specialIdx = specialIdx || new Set();
    const nTeams = sizes.length, n = students.length;
    const score = (a) => scorePartition(partitionFrom(students, a, nTeams), graph, w, fT, fS);
    const spViolation = (a) => { const cnt = new Array(nTeams).fill(0); for (const i of specialIdx) { if (++cnt[a[i]] > 1) return true; } return false; };
    let best = score(assign);
    for (let it = 0; it < maxIter; it++) {
      let improved = false; const order = shuffle(Array.from({ length: n }, (_, i) => i), rng);
      for (let ii = 0; ii < n && !improved; ii++) {
        const i = order[ii]; if (pinned.has(i)) continue;
        for (let jj = ii + 1; jj < n; jj++) {
          const j = order[jj]; if (pinned.has(j) || assign[i] === assign[j]) continue;
          [assign[i], assign[j]] = [assign[j], assign[i]];
          if (specialIdx.size && (specialIdx.has(i) || specialIdx.has(j)) && spViolation(assign)) { [assign[i], assign[j]] = [assign[j], assign[i]]; continue; }
          const cand = score(assign);
          if (cand.total > best.total + 1e-9) { best = cand; improved = true; break; }
          [assign[i], assign[j]] = [assign[j], assign[i]];
        }
      }
      if (!improved) break;
    }
    return best;
  }
  function buildRecommendations(students, graph, opt) {
    opt = opt || {};
    const w = Object.assign({}, DEFAULT_WEIGHTS, opt.weights || {});
    const sizes = sizesFor(students.length, opt.teams, opt.sizes), nTeams = sizes.length;
    const rng = makeRng(opt.seed != null ? opt.seed : 42);
    const restarts = opt.restarts != null ? opt.restarts : 60, maxIter = opt.maxIter != null ? opt.maxIter : 40, nOptions = opt.nOptions != null ? opt.nOptions : 3;
    const fT = opt.forceTogether instanceof Set ? opt.forceTogether : pairsToSet(opt.forceTogether);
    const fS = opt.forceSeparate instanceof Set ? opt.forceSeparate : pairsToSet(opt.forceSeparate);
    const pins = opt.pins || {};
    const groups = validateConstraints(students, sizes, fT, fS, pins);
    const idxMap = new Map(students.map((s, i) => [s.id, i]));
    const pinnedIdx = new Set(Object.keys(pins).map((pid) => idxMap.get(pid)));
    const specialIdx = new Set(students.map((s, i) => s.special ? i : -1).filter((i) => i >= 0));
    const found = new Map();
    for (let r = 0; r < restarts; r++) {
      const assign = seedAssignment(students, sizes, groups, fS, rng, pins, specialIdx);
      if (assign === null) throw new Error("강제 제약/핀/특수 태그를 만족하는 초기 배치를 찾지 못했습니다.");
      const sb = localSearch(students, assign, sizes, graph, w, rng, maxIter, fT, fS, pinnedIdx, specialIdx);
      const partition = partitionFrom(students, assign, nTeams), sig = signature(partition);
      if (!found.has(sig) || sb.total > found.get(sig).score.total) found.set(sig, { teams: partition, score: sb, signature: sig });
    }
    return Array.from(found.values()).sort((a, b) => b.score.total - a.score.total).slice(0, nOptions);
  }

  function parsePairLines(text) {
    const out = [];
    (text || "").split(/\r?\n/).forEach((line) => {
      const t = line.trim(); if (!t || t.startsWith("#")) return;
      const p = t.split(/[,\t]/).map((x) => x.trim()).filter(Boolean);
      if (p.length >= 2) out.push([p[0], p[1]]);
    });
    return out;
  }

  global.TeamBuilder = {
    parseCSV, loadStudents, loadRelations, parseGrades, buildGraph, scorePartition, buildRecommendations,
    sizesFor, pairKey, pairsToSet, resolvePairs, validateConstraints, parsePairLines,
    compValue, leaderCandidate, highIssue, coversDisp,
    MBTI_AXES, DISPOSITIONS, DEFAULT_WEIGHTS, REQUIRED_DISPS, FLAG_FIELDS, DISP_SUPPORTER,
  };
})(window);
