/* ③ 비교 탭 — 조합들을 나란히 놓고 점수 항목 델타로 비교. */
(function (global) {
  "use strict";
  const TB = global.TeamBuilder;
  let root = null;
  const esc = (s) => global.UI.esc(s);
  const LABELS = { total: "종합", conflict: "갈등분리", positive: "긍정유지", special_stack: "특수격리",
    flag_same: "동일태그격리", flag_cross: "교차태그", role_required: "필수역할", role_supporter: "서포터",
    issue_stack: "고이슈격리", issue_balance: "이슈분산", disp_diversity: "성향다양성", leader: "리더확보",
    mbti_balance: "MBTI", competency_coverage: "역량커버", competency_balance: "역량평준(보조)" };

  function studentsOf(ids) { const m = Store.byId(); return ids.map((id) => m.get(id)).filter(Boolean); }

  function render() {
    const p = Store.project();
    if (p.compositions.length < 1) { root.innerHTML = `<div class="empty"><h2>비교할 조합이 없습니다</h2><p class="muted">② 편성 탭에서 자동 편성하거나 조합을 저장하세요.</p></div>`; return; }
    const comps = p.compositions.slice(0, 4);
    const scored = comps.map((c) => ({ c, sb: TB.scorePartition(c.teams.map(studentsOf), Store.graph(), Store.weights()) }));
    const keys = ["total", "conflict", "positive", "special_stack", "flag_same", "flag_cross", "role_required", "role_supporter", "issue_stack", "issue_balance", "disp_diversity", "leader", "mbti_balance", "competency_coverage", "competency_balance"];
    const best = {}; keys.forEach((k) => { best[k] = Math.max.apply(null, scored.map((s) => k === "total" ? s.sb.total : s.sb.parts[k])); });

    const header = `<tr><th>항목</th>${scored.map((s) => `<th>${esc(s.c.name)}<div class="src2">${s.c.src}</div></th>`).join("")}</tr>`;
    const rows = keys.map((k) => `<tr><td class="rk">${LABELS[k]}</td>${scored.map((s) => {
      const v = k === "total" ? s.sb.total : (s.sb.parts[k] || 0);
      const isBest = Math.abs(v - best[k]) < 1e-6 && scored.length > 1;
      return `<td class="${isBest ? "best" : ""}">${v.toFixed(1)}</td>`;
    }).join("")}</tr>`).join("");

    const rosters = scored.map((s) => `<div class="cmp-roster"><h4>${esc(s.c.name)}</h4>${s.c.teams.map((ids, ti) => {
      const names = studentsOf(ids).map((m) => esc(m.name) + (TB.leaderCandidate(m) ? "★" : "") + ((m.issue_level || 0) >= 2 ? "⚠" : "")).join(", ");
      return `<div class="cmp-team"><b>${esc((s.c.teamNames && s.c.teamNames[ti]) || ("팀 " + (ti + 1)))}</b> <span class="muted">(${ids.length})</span><br><span class="cmp-names">${names}</span></div>`;
    }).join("")}</div>`).join("");

    root.innerHTML = `<div class="compare-wrap">
      <h2>조합 비교 <span class="muted">(상위 ${scored.length}개)</span></h2>
      <div class="table-scroll"><table class="cmp-table"><thead>${header}</thead><tbody>${rows}</tbody></table></div>
      <p class="muted sm">각 항목에서 가장 높은 값은 <span class="best-chip">강조</span>됩니다. 종합점수가 높을수록 목표 균형이 좋은 편성입니다.</p>
      <div class="cmp-rosters">${rosters}</div></div>`;
  }

  function init(container) { root = container; }
  global.ViewCompare = { init, render };
})(window);
