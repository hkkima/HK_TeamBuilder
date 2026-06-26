/* 수강생 팀빌더 - 클라이언트 알고리즘 (Python teambuilder 패키지의 JS 포팅).
   관계도(갈등 분리)+성향 우선, 역량 보조. 모든 계산은 브라우저 내에서만 수행됨. */
(function (global) {
  "use strict";

  // ---- MBTI / 역할 상수 ------------------------------------------------
  const MBTI_AXES = [["E", "I"], ["N", "S"], ["T", "F"], ["J", "P"]];
  const ROLE = { LEADER: "리더", SUPPORTER: "서포터", MOOD: "분위기메이커", RESEARCHER: "연구자" };
  const STANDARD_ROLES = [ROLE.LEADER, ROLE.SUPPORTER, ROLE.MOOD, ROLE.RESEARCHER];
  const ROLE_ALIASES = {
    "리더": ROLE.LEADER, "leader": ROLE.LEADER, "lead": ROLE.LEADER, "팀장": ROLE.LEADER,
    "서포터": ROLE.SUPPORTER, "supporter": ROLE.SUPPORTER, "support": ROLE.SUPPORTER, "조력자": ROLE.SUPPORTER,
    "분위기메이커": ROLE.MOOD, "분위기": ROLE.MOOD, "moodmaker": ROLE.MOOD, "mood": ROLE.MOOD, "윤활유": ROLE.MOOD,
    "연구자": ROLE.RESEARCHER, "researcher": ROLE.RESEARCHER, "research": ROLE.RESEARCHER,
    "분석가": ROLE.RESEARCHER, "탐구자": ROLE.RESEARCHER,
  };
  function normalizeRole(raw) {
    if (!raw) return null;
    const key = String(raw).trim().toLowerCase().replace(/\s+/g, "");
    return ROLE_ALIASES[key] || String(raw).trim();
  }

  // ---- CSV 파싱 (따옴표 지원) ------------------------------------------
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM 제거
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
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

  const pick = (row, keys) => {
    for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== "") return String(row[k]).trim();
    return "";
  };
  const pickNum = (row, keys) => {
    const v = pick(row, keys);
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // ---- 로딩 ------------------------------------------------------------
  function loadStudents(text) {
    const rows = parseCSV(text);
    const students = [], seen = new Set();
    rows.forEach((row, idx) => {
      const id = pick(row, ["id", "학번", "student_id"]);
      if (!id) return;
      if (seen.has(id)) throw new Error(`중복된 학생 id '${id}' (행 ${idx + 2})`);
      seen.add(id);
      students.push({
        id,
        name: pick(row, ["name", "이름"]) || id,
        mbti: pick(row, ["mbti", "MBTI"]).toUpperCase(),
        personality: pick(row, ["personality_summary", "personality", "성향요약", "성향"]),
        instructor_score: pickNum(row, ["instructor_score", "강사평가", "competency"]),
        primary_role: normalizeRole(pick(row, ["primary_role", "주역할", "role"])),
        secondary_role: normalizeRole(pick(row, ["secondary_role", "부역할"])),
        prev_team: pick(row, ["prev_team", "이전팀", "previous_team"]) || null,
      });
    });
    if (!students.length) throw new Error("학생 데이터가 비어 있습니다.");
    return students;
  }

  function loadEvals(text, validIds) {
    const rows = parseCSV(text);
    const evals = [];
    rows.forEach((row, idx) => {
      const rater = pick(row, ["rater_id", "평가자", "from"]);
      const ratee = pick(row, ["ratee_id", "피평가자", "to"]);
      if (!rater || !ratee || rater === ratee) return;
      if (!validIds.has(rater) || !validIds.has(ratee))
        throw new Error(`평가에 등록되지 않은 id (rater=${rater}, ratee=${ratee}, 행 ${idx + 2})`);
      evals.push({
        rater_id: rater, ratee_id: ratee,
        collaboration: pickNum(row, ["collaboration", "협업"]),
        contribution: pickNum(row, ["contribution", "기여도"]),
        communication: pickNum(row, ["communication", "소통"]),
        again: pickNum(row, ["again", "다시같이", "want_again"]),
      });
    });
    return evals;
  }

  // ---- 관계 그래프 -----------------------------------------------------
  const pairKey = (a, b) => (a <= b ? a + "|" + b : b + "|" + a);

  function buildGraph(students, evals, opt) {
    opt = opt || {};
    const conflictT = opt.conflictThreshold != null ? opt.conflictThreshold : 2.0;
    const positiveT = opt.positiveThreshold != null ? opt.positiveThreshold : 4.0;
    const againW = opt.againWeight != null ? opt.againWeight : 2.0;

    const directed = new Map();
    for (const ev of evals) {
      const parts = [];
      [ev.collaboration, ev.contribution, ev.communication].forEach((v) => { if (v != null) parts.push([v, 1]); });
      if (ev.again != null) parts.push([ev.again, againW]);
      if (!parts.length) continue;
      let num = 0, den = 0;
      parts.forEach(([v, w]) => { num += v * w; den += w; });
      directed.set(ev.rater_id + ">" + ev.ratee_id, num / den);
    }

    const pairScore = new Map(), minDirected = new Map(), seen = new Set();
    for (const ev of evals) {
      const a = ev.rater_id, b = ev.ratee_id, k = pairKey(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      const ab = directed.get(a + ">" + b), ba = directed.get(b + ">" + a);
      const vals = [ab, ba].filter((v) => v != null);
      if (!vals.length) continue;
      pairScore.set(k, vals.reduce((s, v) => s + v, 0) / vals.length);
      minDirected.set(k, Math.min.apply(null, vals));
    }

    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const conflicts = new Set(), positives = new Set();
    const severity = new Map(), strength = new Map();
    for (const [k, avg] of pairScore) {
      if (avg <= conflictT || minDirected.get(k) <= conflictT - 0.5) {
        conflicts.add(k);
        const worst = Math.min(avg, minDirected.get(k));
        severity.set(k, clamp01((conflictT - worst) / conflictT));
      } else if (avg >= positiveT) {
        positives.add(k);
        const denom = Math.max(1e-9, 5.0 - positiveT);
        strength.set(k, clamp01((avg - positiveT) / denom));
      }
    }
    return { pairScore, minDirected, conflicts, positives, severity, strength, nPairs: pairScore.size };
  }

  // ---- 점수화 ----------------------------------------------------------
  const DEFAULT_WEIGHTS = {
    conflict: 100, positive: 8, prev_mix: 6,
    mbti_balance: 16, role_coverage: 14, leader_balance: 12, competency_balance: 6,
    // 강도/형태
    conflict_intensity: 1.0, positive_intensity: 0.5, competency_metric: "stdev",
    // 운영진 강제 제약(하드)
    force_together: 1000, force_separate: 1000,
  };

  function pstdev(arr) {
    if (arr.length < 2) return 0;
    const m = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length);
  }

  function mbtiBalance(teams) {
    const scores = [];
    for (const team of teams) {
      const known = team.filter((m) => m.mbti && m.mbti.length >= 4);
      if (known.length < 2) continue;
      let acc = 0;
      MBTI_AXES.forEach((ax, ai) => {
        const cp = known.filter((m) => m.mbti[ai] === ax[0]).length;
        const cq = known.length - cp;
        acc += 1 - Math.abs(cp - cq) / known.length;
      });
      scores.push(acc / MBTI_AXES.length);
    }
    return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  }

  function roleCoverage(teams) {
    const scores = [], target = STANDARD_ROLES.length;
    for (const team of teams) {
      const roles = new Set();
      for (const m of team)
        [m.primary_role, m.secondary_role].forEach((r) => { if (STANDARD_ROLES.includes(r)) roles.add(r); });
      const cap = Math.min(target, team.length);
      if (cap === 0) continue;
      scores.push(Math.min(roles.size, cap) / cap);
    }
    return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  }

  function leaderBalance(teams) {
    if (!teams.length) return 0;
    let have = 0;
    for (const team of teams)
      if (team.some((m) => m.primary_role === ROLE.LEADER || m.secondary_role === ROLE.LEADER)) have++;
    return have / teams.length;
  }

  function competencyMetric(teams, metric) {
    const avgs = [];
    for (const team of teams) {
      const v = team.filter((m) => m.instructor_score != null).map((m) => m.instructor_score);
      if (v.length) avgs.push(v.reduce((s, x) => s + x, 0) / v.length);
    }
    if (avgs.length < 2) return 0;
    if (metric === "range") return Math.max(...avgs) - Math.min(...avgs);
    return pstdev(avgs);
  }

  function scorePartition(teams, graph, w, forceTogether, forceSeparate) {
    forceTogether = forceTogether || new Set();
    forceSeparate = forceSeparate || new Set();
    const intra = [], kept = [], violatedSeparate = [];
    let conflictPenalty = 0, positiveBonus = 0, prevMix = 0;
    const sameTeam = new Set();
    for (const team of teams) {
      for (let i = 0; i < team.length; i++)
        for (let j = i + 1; j < team.length; j++) {
          const a = team[i], b = team[j], k = pairKey(a.id, b.id);
          sameTeam.add(k);
          if (graph.conflicts.has(k)) {
            intra.push(k);
            conflictPenalty += w.conflict * (1 + w.conflict_intensity * (graph.severity.get(k) || 0));
          } else if (graph.positives.has(k)) {
            kept.push(k);
            positiveBonus += w.positive * (1 + w.positive_intensity * (graph.strength.get(k) || 0));
          }
          if (forceSeparate.has(k)) violatedSeparate.push(k);
          if (a.prev_team && b.prev_team && a.prev_team === b.prev_team) prevMix++;
        }
    }
    const brokenTogether = [];
    forceTogether.forEach((k) => { if (!sameTeam.has(k)) brokenTogether.push(k); });

    const parts = {
      conflict: -conflictPenalty,
      positive: +positiveBonus,
      prev_mix: -w.prev_mix * prevMix,
      mbti_balance: +w.mbti_balance * mbtiBalance(teams),
      role_coverage: +w.role_coverage * roleCoverage(teams),
      leader_balance: +w.leader_balance * leaderBalance(teams),
      competency_balance: -w.competency_balance * competencyMetric(teams, w.competency_metric),
      force_together: -w.force_together * brokenTogether.length,
      force_separate: -w.force_separate * violatedSeparate.length,
    };
    let total = 0; for (const k in parts) total += parts[k];
    return { total, parts, intra, kept, brokenTogether, violatedSeparate };
  }

  // ---- 시드 RNG (Mulberry32) ------------------------------------------
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---- 팀 크기 결정 ----------------------------------------------------
  function sizesFor(n, teams, sizes) {
    if (sizes && sizes.length) {
      const sum = sizes.reduce((s, v) => s + v, 0);
      if (sum !== n) throw new Error(`팀 크기 합(${sum})이 인원수(${n})와 다릅니다.`);
      return sizes.slice();
    }
    if (!teams || teams < 1) throw new Error("팀 개수 또는 팀 크기를 지정하세요.");
    if (teams > n) throw new Error("팀 수가 인원수보다 많습니다.");
    const base = Math.floor(n / teams), rem = n % teams;
    return Array.from({ length: teams }, (_, i) => (i < rem ? base + 1 : base));
  }

  function partitionFrom(students, assign, nTeams) {
    const teams = Array.from({ length: nTeams }, () => []);
    students.forEach((s, i) => teams[assign[i]].push(s));
    return teams;
  }
  function signature(teams) {
    return teams.map((t) => t.map((m) => m.id).sort().join(",")).sort().join("|");
  }

  // ---- 강제 제약: union-find 그룹화 / 검증 / 초기 배치 ----------------
  function pairsToSet(pairs) {
    // pairs: [[idA, idB], ...] → Set(pairKey)
    const s = new Set();
    (pairs || []).forEach(([a, b]) => { if (a && b && a !== b) s.add(pairKey(a, b)); });
    return s;
  }

  function buildGroups(ids, forceTogether) {
    const idx = new Map(ids.map((id, i) => [id, i]));
    const parent = ids.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    forceTogether.forEach((k) => {
      const [a, b] = k.split("|");
      const ra = find(idx.get(a)), rb = find(idx.get(b));
      if (ra !== rb) parent[ra] = rb;
    });
    const groups = new Map();
    ids.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    return Array.from(groups.values());
  }

  function validateConstraints(students, sizes, forceTogether, forceSeparate) {
    const ids = students.map((s) => s.id);
    const idSet = new Set(ids);
    [forceTogether, forceSeparate].forEach((set) => set.forEach((k) => {
      const [a, b] = k.split("|");
      if (!idSet.has(a) || !idSet.has(b)) throw new Error(`제약에 없는 학생 id: ${a}, ${b}`);
    }));
    const groups = buildGroups(ids, forceTogether);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const memberGroup = new Map();
    groups.forEach((g, gi) => g.forEach((i) => memberGroup.set(i, gi)));
    const maxTeam = Math.max(...sizes);
    for (const g of groups)
      if (g.length > maxTeam)
        throw new Error(`강제 결합 그룹 크기(${g.length})가 최대 팀 크기(${maxTeam})를 초과: ` + g.map((i) => ids[i]).join(", "));
    forceSeparate.forEach((k) => {
      const [a, b] = k.split("|");
      if (memberGroup.get(idx.get(a)) === memberGroup.get(idx.get(b)))
        throw new Error(`${a}, ${b}는 강제 결합으로 묶여 있어 분리할 수 없습니다(모순).`);
    });
    return groups;
  }

  function seedAssignment(students, sizes, groups, forceSeparate, rng) {
    const ids = students.map((s) => s.id);
    const nTeams = sizes.length;
    const remaining = sizes.slice();
    const assign = new Array(students.length).fill(-1);
    const inTeam = Array.from({ length: nTeams }, () => new Set());
    const sepPartners = new Map();
    forceSeparate.forEach((k) => {
      const [a, b] = k.split("|");
      if (!sepPartners.has(a)) sepPartners.set(a, new Set());
      if (!sepPartners.has(b)) sepPartners.set(b, new Set());
      sepPartners.get(a).add(b); sepPartners.get(b).add(a);
    });
    const order = groups.map((_, gi) => gi)
      .sort((x, y) => (groups[y].length - groups[x].length) || (rng() - 0.5));
    for (const gi of order) {
      const grp = groups[gi], size = grp.length, gids = grp.map((i) => ids[i]);
      let cand = [];
      for (let t = 0; t < nTeams; t++) if (remaining[t] >= size) cand.push(t);
      if (!cand.length) return null;
      const sepCost = (t) => {
        let c = 0;
        gids.forEach((gid) => (sepPartners.get(gid) || new Set()).forEach((p) => { if (inTeam[t].has(p)) c++; }));
        return c;
      };
      shuffle(cand, rng);
      cand.sort((a, b) => sepCost(a) - sepCost(b));
      const t = cand[0];
      grp.forEach((i) => { assign[i] = t; inTeam[t].add(ids[i]); });
      remaining[t] -= size;
    }
    return assign;
  }

  function localSearch(students, assign, sizes, graph, w, rng, maxIter, fT, fS) {
    const nTeams = sizes.length, n = students.length;
    const score = (a) => scorePartition(partitionFrom(students, a, nTeams), graph, w, fT, fS);
    let best = score(assign);
    for (let it = 0; it < maxIter; it++) {
      let improved = false;
      const order = shuffle(Array.from({ length: n }, (_, i) => i), rng);
      for (let ii = 0; ii < n && !improved; ii++) {
        const i = order[ii];
        for (let jj = ii + 1; jj < n; jj++) {
          const j = order[jj];
          if (assign[i] === assign[j]) continue;
          [assign[i], assign[j]] = [assign[j], assign[i]];
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
    const sizes = sizesFor(students.length, opt.teams, opt.sizes);
    const nTeams = sizes.length;
    const rng = makeRng(opt.seed != null ? opt.seed : 42);
    const restarts = opt.restarts != null ? opt.restarts : 60;
    const maxIter = opt.maxIter != null ? opt.maxIter : 40;
    const nOptions = opt.nOptions != null ? opt.nOptions : 3;
    const fT = opt.forceTogether instanceof Set ? opt.forceTogether : pairsToSet(opt.forceTogether);
    const fS = opt.forceSeparate instanceof Set ? opt.forceSeparate : pairsToSet(opt.forceSeparate);

    const groups = validateConstraints(students, sizes, fT, fS);

    const found = new Map();
    for (let r = 0; r < restarts; r++) {
      const assign = seedAssignment(students, sizes, groups, fS, rng);
      if (assign === null) throw new Error("강제 제약을 만족하는 초기 배치를 찾지 못했습니다. 팀 크기나 제약을 조정하세요.");
      const sb = localSearch(students, assign, sizes, graph, w, rng, maxIter, fT, fS);
      const partition = partitionFrom(students, assign, nTeams);
      const sig = signature(partition);
      if (!found.has(sig) || sb.total > found.get(sig).score.total)
        found.set(sig, { teams: partition, score: sb, signature: sig });
    }
    return Array.from(found.values()).sort((a, b) => b.score.total - a.score.total).slice(0, nOptions);
  }

  // 텍스트(줄당 "S01,S02") → [[a,b], ...]
  function parsePairLines(text) {
    const out = [];
    (text || "").split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return;
      const parts = t.split(/[,\t]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 2) out.push([parts[0], parts[1]]);
    });
    return out;
  }

  global.TeamBuilder = {
    parseCSV, loadStudents, loadEvals, buildGraph, scorePartition,
    buildRecommendations, sizesFor, pairKey, pairsToSet, validateConstraints,
    parsePairLines,
    MBTI_AXES, STANDARD_ROLES, ROLE, DEFAULT_WEIGHTS,
  };
})(window);
