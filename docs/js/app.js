/* UI 연결: 입력 로딩, 실행, 결과 렌더링, CSV 내보내기. */
(function () {
  "use strict";
  const TB = window.TeamBuilder;
  let lastRecs = null;

  const $ = (id) => document.getElementById(id);
  const PART_LABELS = {
    conflict: "갈등 분리", positive: "긍정 유지", prev_mix: "이전 팀 섞기",
    mbti_balance: "성향(MBTI)", role_coverage: "역할 배분",
    leader_balance: "리더 분포", competency_balance: "역량(보조)",
  };

  const STUDENTS_TEMPLATE =
    "id,name,mbti,personality_summary,instructor_score,primary_role,secondary_role,prev_team\n" +
    "S01,홍길동,ENFP,주도적이고 아이디어가 많음.,4.2,리더,분위기메이커,A\n" +
    "S02,김영희,ISTJ,꼼꼼하고 책임감 강함.,3.8,서포터,연구자,A\n";
  const EVALS_TEMPLATE =
    "rater_id,ratee_id,collaboration,contribution,communication,again,comment\n" +
    "S01,S02,5,4,5,5,믿고 맡길 수 있었음\n" +
    "S02,S01,3,4,2,2,소통이 어려웠음\n";

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

  // ---- 입력 동기화 ----
  function bindFile(fileId, taId) {
    $(fileId).addEventListener("change", function (e) {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { $(taId).value = reader.result; updateDataStatus(); };
      reader.readAsText(f, "utf-8");
    });
    $(taId).addEventListener("input", updateDataStatus);
  }

  function updateDataStatus() {
    const sText = $("ta-students").value.trim();
    if (!sText) { setStatus("학생 데이터를 입력하세요.", ""); return; }
    try {
      const students = TB.loadStudents(sText);
      let msg = `학생 ${students.length}명 인식`;
      const eText = $("ta-evals").value.trim();
      if (eText) {
        const evals = TB.loadEvals(eText, new Set(students.map((s) => s.id)));
        const g = TB.buildGraph(students, evals, readThresholds());
        msg += ` · 평가쌍 ${g.nPairs} (갈등 ${g.conflicts.size}·긍정 ${g.positives.size})`;
      }
      setStatus(msg, "ok");
    } catch (err) { setStatus("오류: " + err.message, "bad"); }
  }

  function readThresholds() {
    return {
      conflictThreshold: Number($("conflict-th").value),
      positiveThreshold: Number($("positive-th").value),
    };
  }
  function readWeights() {
    const w = {};
    Object.keys(TB.DEFAULT_WEIGHTS).forEach((k) => {
      const el = $("w-" + k);
      if (el) w[k] = Number(el.value);
    });
    return w;
  }

  // ---- 실행 ----
  function run() {
    let students, evals = [];
    try {
      students = TB.loadStudents($("ta-students").value.trim());
      const eText = $("ta-evals").value.trim();
      if (eText) evals = TB.loadEvals(eText, new Set(students.map((s) => s.id)));
    } catch (err) { setStatus("입력 오류: " + err.message, "bad"); return; }

    const mode = $("mode").value;
    const opt = {
      teams: mode === "teams" ? Number($("teams").value) : null,
      sizes: mode === "sizes"
        ? $("sizes").value.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n))
        : null,
      nOptions: Number($("options").value),
      restarts: Number($("restarts").value),
      seed: Number($("seed").value),
      weights: readWeights(),
    };

    $("overlay").style.display = "grid";
    setTimeout(function () {
      try {
        const graph = TB.buildGraph(students, evals, readThresholds());
        const recs = TB.buildRecommendations(students, graph, opt);
        lastRecs = recs;
        render(recs, graph, students.length);
        $("btn-export").disabled = recs.length === 0;
      } catch (err) {
        $("output").innerHTML = '<p class="flag">오류: ' + escapeHtml(err.message) + "</p>";
        setStatus("오류: " + err.message, "bad");
      } finally {
        $("overlay").style.display = "none";
      }
    }, 40);
  }

  // ---- 렌더링 ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function mbtiDist(team) {
    const known = team.filter((m) => m.mbti && m.mbti.length >= 4);
    if (!known.length) return "MBTI 없음";
    return TB.MBTI_AXES.map((ax, ai) => {
      const cp = known.filter((m) => m.mbti[ai] === ax[0]).length;
      return `${ax[0]}${cp}/${ax[1]}${known.length - cp}`;
    }).join(" · ");
  }

  function rolesIn(team) {
    const map = {};
    TB.STANDARD_ROLES.forEach((r) => (map[r] = []));
    team.forEach((m) => {
      if (map[m.primary_role]) map[m.primary_role].push(m.name);
      else if (map[m.secondary_role]) map[m.secondary_role].push(m.name + "(부)");
    });
    const parts = TB.STANDARD_ROLES.filter((r) => map[r].length).map((r) => `${r}: ${map[r].join(", ")}`);
    return parts.length ? parts.join(" · ") : "역할 데이터 없음";
  }

  function avgComp(team) {
    const v = team.filter((m) => m.instructor_score != null).map((m) => m.instructor_score);
    return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : "N/A";
  }

  function render(recs, graph, nStudents) {
    $("summary").innerHTML =
      `대상 <b>${nStudents}명</b> · 평가쌍 ${graph.nPairs} ` +
      `(갈등 ${graph.conflicts.size} · 긍정 ${graph.positives.size}) · 추천안 ${recs.length}개<br>` +
      `우선순위: ①갈등 분리 ②긍정 일부 유지 ③성향 균형/이전 팀 섞기 ④역할 배분 ⑤역량(보조)`;

    if (!recs.length) { $("output").innerHTML = '<p class="placeholder">추천안을 만들 수 없습니다.</p>'; return; }

    const html = recs.map((rec, i) => {
      const partChips = Object.keys(PART_LABELS).filter((k) => k in rec.score.parts).map((k) => {
        const v = rec.score.parts[k];
        const cls = v > 0.05 ? "pos" : v < -0.05 ? "neg" : "";
        return `<span class="part ${cls}">${PART_LABELS[k]} ${v >= 0 ? "+" : ""}${v.toFixed(1)}</span>`;
      }).join("");

      const nConf = rec.score.intra.length;
      const flag = nConf === 0
        ? '<div class="flag ok">✅ 같은 팀 내 갈등쌍 0개 · 유지된 긍정쌍 ' + rec.score.kept.length + "개</div>"
        : '<div class="flag">⚠️ 분리 못한 갈등쌍 ' + nConf + "개: " +
          rec.score.intra.map((k) => k.replace("|", "-")).join(", ") + "</div>";

      const teamsHtml = rec.teams.map((team, ti) => {
        const members = team.map((m) => {
          const role = m.primary_role ? `<span class="role">${escapeHtml(m.primary_role)}</span>` : "";
          return `<div class="member"><span class="mbti">${escapeHtml(m.mbti || "–")}</span>${escapeHtml(m.name)} ${role}</div>`;
        }).join("");
        return `<div class="team"><h4>팀 ${ti + 1} <span class="muted">(${team.length}명)</span></h4>${members}
          <div class="meta">성향: ${mbtiDist(team)}<br>역할: ${rolesIn(team)}<br>평균 역량(보조): ${avgComp(team)}</div></div>`;
      }).join("");

      return `<div class="rec">
        <div class="rec-head"><h3>추천안 ${i + 1}</h3><span class="score-pill">종합 ${rec.score.total.toFixed(1)}</span></div>
        <div class="parts">${partChips}</div>${flag}
        <div class="teams">${teamsHtml}</div></div>`;
    }).join("");
    $("output").innerHTML = html;
  }

  function exportCsv() {
    if (!lastRecs) return;
    let csv = "﻿option,team,id,name,mbti,primary_role,secondary_role,instructor_score,prev_team\n";
    lastRecs.forEach((rec, oi) => {
      rec.teams.forEach((team, ti) => {
        team.forEach((m) => {
          const cells = [oi + 1, ti + 1, m.id, m.name, m.mbti, m.primary_role || "",
            m.secondary_role || "", m.instructor_score == null ? "" : m.instructor_score, m.prev_team || ""];
          csv += cells.map((c) => {
            const s = String(c);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          }).join(",") + "\n";
        });
      });
    });
    download("recommendations.csv", csv);
  }

  // ---- 초기화 (로그인 성공 후 호출됨) ----
  window.AppInit = function () {
    bindFile("file-students", "ta-students");
    bindFile("file-evals", "ta-evals");

    $("mode").addEventListener("change", function () {
      const t = this.value === "teams";
      $("wrap-teams").style.display = t ? "" : "none";
      $("wrap-sizes").style.display = t ? "none" : "";
    });

    $("btn-sample").addEventListener("click", function () {
      $("ta-students").value = window.SAMPLE_STUDENTS.trim() + "\n";
      $("ta-evals").value = window.SAMPLE_EVALS.trim() + "\n";
      updateDataStatus();
    });
    $("btn-tmpl-students").addEventListener("click", () => download("students_template.csv", "﻿" + STUDENTS_TEMPLATE));
    $("btn-tmpl-evals").addEventListener("click", () => download("peer_evaluations_template.csv", "﻿" + EVALS_TEMPLATE));
    $("btn-run").addEventListener("click", run);
    $("btn-export").addEventListener("click", exportCsv);
  };
})();
