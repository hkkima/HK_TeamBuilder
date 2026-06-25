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

    const conflicts = new Set(), positives = new Set();
    for (const [k, avg] of pairScore) {
      if (avg <= conflictT || minDirected.get(k) <= conflictT - 0.5) conflicts.add(k);
      else if (avg >= positiveT) positives.add(k);
    }
    return { pairScore, minDirected, conflicts, positives, nPairs: pairScore.size };
  }

  // ---- 점수화 ----------------------------------------------------------
  const DEFAULT_WEIGHTS = {
    conflict: 100, positive: 8, prev_mix: 6,
    mbti_balance: 16, role_coverage: 14, leader_balance: 12, competency_balance: 6,
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

  function competencyStd(teams) {
    const avgs = [];
    for (const team of teams) {
      const v = team.filter((m) => m.instructor_score != null).map((m) => m.instructor_score);
      if (v.length) avgs.push(v.reduce((s, x) => s + x, 0) / v.length);
    }
    return avgs.length < 2 ? 0 : pstdev(avgs);
  }

  function scorePartition(teams, graph, w) {
    const intra = [], kept = [];
    let prevMix = 0;
    for (const team of teams) {
      for (let i = 0; i < team.length; i++)
        for (let j = i + 1; j < team.length; j++) {
          const a = team[i], b = team[j], k = pairKey(a.id, b.id);
          if (graph.conflicts.has(k)) intra.push(k);
          else if (graph.positives.has(k)) kept.push(k);
          if (a.prev_team && b.prev_team && a.prev_team === b.prev_team) prevMix++;
        }
    }
    const parts = {
      conflict: -w.conflict * intra.length,
      positive: +w.positive * kept.length,
      prev_mix: -w.prev_mix * prevMix,
      mbti_balance: +w.mbti_balance * mbtiBalance(teams),
      role_coverage: +w.role_coverage * roleCoverage(teams),
      leader_balance: +w.leader_balance * leaderBalance(teams),
      competency_balance: -w.competency_balance * competencyStd(teams),
    };
    let total = 0; for (const k in parts) total += parts[k];
    return { total, parts, intra, kept };
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

  function localSearch(students, assign, sizes, graph, w, rng, maxIter) {
    const nTeams = sizes.length, n = students.length;
    let best = scorePartition(partitionFrom(students, assign, nTeams), graph, w);
    for (let it = 0; it < maxIter; it++) {
      let improved = false;
      const order = shuffle(Array.from({ length: n }, (_, i) => i), rng);
      for (let ii = 0; ii < n && !improved; ii++) {
        const i = order[ii];
        for (let jj = ii + 1; jj < n; jj++) {
          const j = order[jj];
          if (assign[i] === assign[j]) continue;
          [assign[i], assign[j]] = [assign[j], assign[i]];
          const cand = scorePartition(partitionFrom(students, assign, nTeams), graph, w);
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

    const found = new Map();
    for (let r = 0; r < restarts; r++) {
      const slots = [];
      sizes.forEach((sz, ti) => { for (let k = 0; k < sz; k++) slots.push(ti); });
      shuffle(slots, rng);
      const assign = slots.slice();
      const sb = localSearch(students, assign, sizes, graph, w, rng, maxIter);
      const partition = partitionFrom(students, assign, nTeams);
      const sig = signature(partition);
      if (!found.has(sig) || sb.total > found.get(sig).score.total)
        found.set(sig, { teams: partition, score: sb, signature: sig });
    }
    return Array.from(found.values()).sort((a, b) => b.score.total - a.score.total).slice(0, nOptions);
  }

  global.TeamBuilder = {
    parseCSV, loadStudents, loadEvals, buildGraph, scorePartition,
    buildRecommendations, sizesFor, pairKey,
    MBTI_AXES, STANDARD_ROLES, ROLE, DEFAULT_WEIGHTS,
  };
})(window);
