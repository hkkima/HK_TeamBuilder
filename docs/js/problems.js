/* 문제 진단 + 원클릭 자동 수정.
   라이브 보드를 scorePartition으로 평가해 갈등쌍/고이슈 겹침/리더 없는 팀/미배정 등을 목록화하고,
   핀 안 걸린 학생들 간 단일 스왑/이동으로 특정 문제를 해소하는 최선의 수를 탐색한다. */
(function (global) {
  "use strict";
  const TB = global.TeamBuilder;

  function studentsOf(ids, byId) { return ids.map((id) => byId.get(id)).filter(Boolean); }
  function teamsStudents(board, byId) { return board.teams.map((t) => studentsOf(t, byId)); }

  function compute(board, byId, graph, weights, pins) {
    const teams = teamsStudents(board, byId);
    const sb = TB.scorePartition(teams, graph, weights);
    const probs = [];
    // 미배정
    if (board.pool.length) probs.push({ type: "unassigned", teams: [], ids: board.pool.slice(),
      label: `미배정 ${board.pool.length}명`, sev: 3, fixable: false });
    // 특수 관리 태그 겹침 (최우선 — 하드 규칙)
    board.teams.forEach((t, ti) => {
      const sp = t.filter((id) => byId.get(id) && byId.get(id).special);
      if (sp.length > 1) probs.push({ type: "special", teams: [ti], ids: sp,
        label: `팀 ${ti + 1} 특수관리 ${sp.length}명 겹침(금지)`, sev: 4, fixable: true });
    });
    // 갈등쌍
    sb.intra.forEach((k) => {
      const [a, b] = k.split("|");
      const ti = board.teams.findIndex((t) => t.includes(a) && t.includes(b));
      probs.push({ type: "conflict", teams: [ti], ids: [a, b], key: k,
        label: `팀 ${ti + 1} 갈등쌍: ${nm(byId, a)}·${nm(byId, b)}`, sev: 3, fixable: true });
    });
    // 고이슈 겹침
    board.teams.forEach((t, ti) => {
      const hi = t.filter((id) => byId.get(id) && TB.highIssue(byId.get(id)));
      if (hi.length > 1) probs.push({ type: "stack", teams: [ti], ids: hi,
        label: `팀 ${ti + 1} 고이슈 ${hi.length}명 겹침`, sev: 2, fixable: true });
    });
    // 리더 없는 팀
    board.teams.forEach((t, ti) => {
      if (t.length && !t.some((id) => byId.get(id) && TB.leaderCandidate(byId.get(id))))
        probs.push({ type: "leader", teams: [ti], ids: [], label: `팀 ${ti + 1} 리더 후보 없음`, sev: 1, fixable: true });
    });
    probs.sort((a, b) => b.sev - a.sev);
    return { problems: probs, score: sb };
  }
  function nm(byId, id) { const s = byId.get(id); return s ? s.name : id; }

  // 특정 문제를 없애는 단일 스왑/이동을 탐색 → 새 teams(id 배열) 반환 또는 null
  function autoFix(problem, board, byId, graph, weights, pins) {
    const pinned = new Set(Object.keys(pins || {}));
    const base = board.teams.map((t) => t.slice());
    const score = (tt) => TB.scorePartition(tt.map((t) => studentsOf(t, byId)), graph, weights).total;
    const problemCount = (tt) => countProblem(problem.type, tt, byId, graph, weights);
    const target = board.teams[problem.teams[0]];
    if (!target) return null;
    const before = problemCount(base);
    let best = null, bestScore = -Infinity;

    // 후보: 문제 팀의 비핀 학생 a ↔ 다른 팀의 비핀 학생 b 스왑
    problem.teams.forEach((ti) => {
      base[ti].forEach((a) => {
        if (pinned.has(a)) return;
        for (let tj = 0; tj < base.length; tj++) {
          if (tj === ti) continue;
          // 이동(정원 여유 시)
          tryCand(swapOrMove(base, ti, a, tj, null));
          base[tj].forEach((b) => { if (!pinned.has(b)) tryCand(swapOrMove(base, ti, a, tj, b)); });
        }
      });
    });
    function tryCand(tt) {
      if (!tt) return;
      if (problemCount(tt) >= before) return; // 문제를 줄여야 함
      const s = score(tt);
      if (s > bestScore) { bestScore = s; best = tt; }
    }
    return best;
  }

  function swapOrMove(teams, ti, a, tj, b) {
    const tt = teams.map((t) => t.slice());
    const ia = tt[ti].indexOf(a); if (ia < 0) return null;
    tt[ti].splice(ia, 1);
    if (b != null) { const ib = tt[tj].indexOf(b); if (ib < 0) return null; tt[tj].splice(ib, 1); tt[ti].push(b); }
    tt[tj].push(a);
    return tt;
  }

  function countProblem(type, teams, byId, graph, weights) {
    const ts = teams.map((t) => t.map((id) => byId.get(id)).filter(Boolean));
    const sb = TB.scorePartition(ts, graph, weights);
    if (type === "conflict") return sb.intra.length;
    if (type === "special") return sb.specialStacks;
    if (type === "stack") return sb.issueStacks;
    if (type === "leader") return teams.filter((t) => t.length && !t.some((id) => byId.get(id) && TB.leaderCandidate(byId.get(id)))).length;
    return 0;
  }

  global.Problems = { compute, autoFix };
})(window);
