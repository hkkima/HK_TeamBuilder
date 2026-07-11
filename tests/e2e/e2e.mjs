/* 팀빌딩 스튜디오 브라우저 E2E (Playwright + 실제 Chromium).
 *
 * 커버: 로그인 게이트 · 데이터 인라인 편집 · 자동 편성 · 조합 목록 선택 ·
 *       포인터 드래그 이동 · 핀 잠금 후 부분 재편성 · 문제 자동 해결 ·
 *       팀장/메모/저장·재로드 유지 · undo/redo · 영속성(새로고침) ·
 *       프로젝트 내보내기/가져오기 · CSV 내보내기 · 비교 탭.
 * (규모 10·25·60 검증은 Python CLI E2E(run_cli.py)가 담당)
 * 실행: node tests/e2e/e2e.mjs
 */
import pkg from "playwright-core"; const { chromium } = pkg;
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(__dirname, "..", "..", "docs");
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CRED = { id: "hkadmin", pw: "teambuilder2026" };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const fp = path.join(DOCS, path.normalize(p));
    if (!fp.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
    try { res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" }); res.end(readFileSync(fp)); }
    catch { res.writeHead(404); res.end("nf"); }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}

let passed = 0, failed = 0; const fails = [];
function check(c, l) { if (c) { passed++; console.log("  ✅ " + l); } else { failed++; fails.push(l); console.log("  ❌ " + l); } }

async function login(pg, base) {
  await pg.goto(base + "/index.html");
  if (await pg.isVisible("#login-screen")) {
    await pg.fill("#login-id", CRED.id); await pg.fill("#login-pw", CRED.pw);
    await pg.click("#login-form button[type=submit]");
  }
  await pg.waitForSelector("#app", { state: "visible", timeout: 5000 });
}
const buildWait = (pg) => pg.waitForFunction(() => window.Store && Store.project().compositions.length > 0 && Store.project().board.teams.length > 0, { timeout: 60000 });
async function goBuild(pg) { await pg.click('.tab[data-tab="board"]'); await pg.click('[data-act="build"]'); await buildWait(pg); await pg.waitForTimeout(120); }

// 포인터 기반 드래그 (dnd.js는 pointer 이벤트 사용)
async function drag(pg, id, zoneSel) {
  const src = pg.locator(`#board .block[data-id="${id}"]`); const box = await src.boundingBox();
  const tgt = pg.locator(zoneSel); const tb = await tgt.boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pg.mouse.down();
  await pg.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12);
  await pg.mouse.move(tb.x + tb.width / 2, tb.y + 24);
  await pg.mouse.move(tb.x + tb.width / 2, tb.y + 26);
  await pg.mouse.up(); await pg.waitForTimeout(80);
}

async function run() {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 950 } });
  const pg = await ctx.newPage();
  const perr = []; pg.on("pageerror", (e) => perr.push(e.message));

  try {
    // 1) 로그인 게이트
    console.log("\n[로그인 게이트]");
    await pg.goto(base + "/index.html");
    await pg.fill("#login-id", "hkadmin"); await pg.fill("#login-pw", "wrong"); await pg.click("#login-form button[type=submit]");
    await pg.waitForTimeout(250);
    check(await pg.isHidden("#app"), "잘못된 PW → 앱 차단");
    await login(pg, base);
    check(await pg.isVisible("#app"), "올바른 자격증명 → 진입");

    // 2) 데이터 탭 — 샘플 + 인라인 편집
    console.log("\n[데이터]");
    await pg.click('[data-act="sample"]');
    await pg.waitForFunction(() => /수강생 23/.test(document.querySelector(".data-status")?.textContent || ""), { timeout: 5000 });
    check(true, "샘플 23명 로딩");
    const firstId = await pg.evaluate(() => Store.project().students[0].id);
    await pg.fill(`.cell[data-id="${firstId}"][data-col="name"]`, "테스트수강생");
    await pg.locator(`.cell[data-id="${firstId}"][data-col="name"]`).blur();
    check(await pg.evaluate((id) => Store.project().students.find((s) => s.id === id).name === "테스트수강생", firstId), "인라인 이름 편집 반영");
    check(await pg.evaluate(() => { const s = Store.project().students.find((x) => Object.keys(x.units || {}).length); return !!s && Object.values(s.units).some((v) => v >= 60); }), "샘플 교과 점수(단원) 반영");
    const beforeN = await pg.evaluate(() => Store.project().students.length);
    await pg.click('[data-act="add-student"]');
    check(await pg.evaluate((n) => Store.project().students.length === n + 1, beforeN), "＋학생 추가");
    await pg.locator("[data-delstu]").last().click(); // 방금 추가한 학생 삭제(샘플 보존)
    check(await pg.evaluate((n) => Store.project().students.length === n, beforeN), "학생 삭제");
    check(await pg.evaluate(() => { const s = document.querySelector(".cell.ord"); return s && s.tagName === "SELECT" && [...s.options].some((o) => o.text === "상" || o.text === "매우 우수"); }), "역량 서수 드롭다운(상/중/하·매우우수~)");

    // 3) 자동 편성
    console.log("\n[자동 편성]");
    await goBuild(pg);
    const snap = () => pg.evaluate(() => {
      const p = Store.project();
      return { comps: p.compositions.length, teams: p.board.teams.map((t) => t.slice()), pool: p.board.pool.length,
        active: p.activeIndex, total: document.querySelector(".part.total")?.textContent,
        okFlag: !!document.querySelector(".flags-inline .flag.ok"), problems: [...document.querySelectorAll(".prob")].map((x) => x.textContent) };
    });
    let s = await snap();
    const N = await pg.evaluate(() => Store.project().students.length);
    check(s.comps >= 1 && s.comps <= 3, `조합 ${s.comps}개`);
    const members = s.teams.flat();
    check(members.length === N && new Set(members).size === N, `단일 조합 표시: 전원 ${N}명 1회`);
    check(s.pool === 0, "미배정 0");
    check(s.okFlag, "갈등쌍 0 플래그");
    // 고이슈 격리
    const hiStack = await pg.evaluate(() => { const p = Store.project(), b = Store.byId(); return p.board.teams.filter((t) => t.filter((id) => TeamBuilder.highIssue(b.get(id))).length > 1).length; });
    check(hiStack === 0, "고이슈 팀당 최대 1명");
    // 특수 관리 태그: 자동 편성 시 절대 2명 이상 같은 팀 금지
    const spInfo = await pg.evaluate(() => { const p = Store.project(), b = Store.byId(); const tagged = p.students.filter((s) => s.special).length; const stack = p.board.teams.filter((t) => t.filter((id) => b.get(id).special).length > 1).length; return { tagged, stack }; });
    check(spInfo.tagged >= 2 && spInfo.stack === 0, `특수관리 태그 ${spInfo.tagged}명 → 팀당 최대 1명(하드)`);
    // 필수 역할 커버 + 성향 분포(핵심) + 카테고리 태그 미반영(가중치 0)
    const catRole = await pg.evaluate(() => { const p = Store.project(), b = Store.byId();
      const roleMiss = p.board.teams.filter((t) => t.length).reduce((a, t) => a + TeamBuilder.REQUIRED_DISPS.filter((r) => !t.some((id) => TeamBuilder.coversDisp(b.get(id), r))).length, 0);
      const w = Store.weights();
      const dispPart = TeamBuilder.scorePartition(p.board.teams.map((t) => t.map((id) => b.get(id))), Store.graph(), w).parts.disp_diversity;
      return { roleMiss, flagOff: w.flag_same === 0 && w.flag_cross === 0, dispPart }; });
    check(catRole.roleMiss === 0, "팀마다 분위기메이커·매니저·책임자 각 1명");
    check(catRole.flagOff, "카테고리 태그(멘탈/매몰) 자동 반영 안 함(가중치 0)");
    check(catRole.dispPart > 0, "성향 분포(혼합도) 점수 반영");
    // 팀장/부팀장 지정 + 분위기메이커 확보
    const lead = await pg.evaluate(() => {
      const p = Store.project(), b = Store.byId();
      let ok = true, moodOk = true, distinct = true;
      p.board.teams.forEach((t, ti) => {
        if (!t.length) return;
        const L = p.board.leaderByTeam[ti], D = p.board.deputyByTeam[ti];
        if (!L || !t.includes(L)) ok = false;
        if (t.length >= 2 && (!D || !t.includes(D) || D === L)) distinct = false;
        const mood = t.reduce((s, id) => s + TeamBuilder.dispScore(b.get(id), TeamBuilder.DISP_MOOD), 0);
        if (mood < 1) moodOk = false;
      });
      return { ok, moodOk, distinct };
    });
    check(lead.ok, "모든 팀 팀장 지정");
    check(lead.distinct, "모든 팀 부팀장 지정(팀장과 상이)");
    check(lead.moodOk, "모든 팀 분위기메이커 점수 ≥ 1");
    // 렌더 순서: 팀장 최상단, 부팀장 그 아래
    const order = await pg.evaluate(() => {
      const p = Store.project();
      const col = document.querySelector('#board .team-col[data-zone="team-0"]');
      const blocks = [...col.querySelectorAll(".dropzone .block")].map((b) => b.dataset.id);
      return { first: blocks[0], second: blocks[1], L: p.board.leaderByTeam[0], D: p.board.deputyByTeam[0] };
    });
    check(order.first === order.L, "팀장이 리스트 최상단");
    check(order.second === order.D, "부팀장이 팀장 바로 아래");

    // 4) 조합 목록 선택
    if (s.comps >= 2) {
      const sig = (t) => t.map((x) => x.slice().sort().join(",")).sort().join("|");
      const before = sig(s.teams);
      await pg.click('.comp-chip[data-comp="1"]'); await pg.waitForTimeout(80);
      const s2 = await snap();
      check(s2.active === 1 && sig(s2.teams) !== before, "목록에서 2번 조합 선택 → 다른 구성");
      await pg.click('.comp-chip[data-comp="0"]'); await pg.waitForTimeout(80);
    }

    // 5) 포인터 드래그 이동
    console.log("\n[드래그/핀/문제]");
    const t0 = (await snap()).teams;
    const moveId = t0[0][0];
    await drag(pg, moveId, '#board .team-col[data-zone="team-1"] .dropzone');
    const moved = await pg.evaluate((id) => { const t = Store.project().board.teams; return { in0: t[0].includes(id), in1: t[1].includes(id) }; }, moveId);
    check(!moved.in0 && moved.in1, `드래그: ${moveId} 팀1→팀2`);
    await pg.click("#btn-undo"); await pg.waitForTimeout(80);
    check(await pg.evaluate((id) => Store.project().board.teams[0].includes(id), moveId), "undo로 드래그 되돌림");

    // 6) 핀 잠금 + 부분 재편성
    const lockedIds = await pg.evaluate(() => Store.project().board.teams[0].slice());
    await pg.click('[data-lockteam="0"]');
    check(await pg.evaluate((ids) => ids.every((id) => Store.project().pins[id] != null), lockedIds), "팀 잠금 → 전원 핀");
    await pg.evaluate(() => Store.setSettings({ seed: 777 }));
    await pg.click('[data-act="build"]'); await buildWait(pg); await pg.waitForTimeout(120);
    const kept = await pg.evaluate((ids) => Store.project().board.teams.some((t) => t.length === ids.length && ids.every((id) => t.includes(id))), lockedIds);
    check(kept, "핀 유지 재편성: 잠근 팀 그대로");

    // 7) 문제 자동 해결 (고이슈 겹침 생성 → fix)
    await pg.evaluate(() => { const p = Store.project(); const hi = p.students.filter((x) => x.issue_level >= 2).map((x) => x.id); Store.moveStudent(hi[0], "team-" + Store.teamOf(hi[1])); });
    await pg.waitForFunction(() => [...document.querySelectorAll(".prob")].some((x) => /고이슈/.test(x.textContent)), { timeout: 5000 });
    check(true, "수동 이동으로 고이슈 겹침 문제 표시");
    await pg.click(".prob button[data-fix]"); await pg.waitForTimeout(150);
    check(await pg.evaluate(() => { const p = Store.project(), b = Store.byId(); return p.board.teams.filter((t) => t.filter((id) => TeamBuilder.highIssue(b.get(id))).length > 1).length === 0; }), "자동 해결 후 고이슈 겹침 0");
    // 특수관리 태그를 수동으로 겹치게 → 최우선 문제 + 자동 해결
    await pg.evaluate(() => { const p = Store.project(), b = Store.byId(); const sp = p.students.filter((x) => x.special).map((x) => x.id); Store.moveStudent(sp[0], "team-" + Store.teamOf(sp[1])); });
    await pg.waitForFunction(() => [...document.querySelectorAll(".prob")].some((x) => /특수관리/.test(x.textContent)), { timeout: 5000 });
    check(true, "특수관리 수동 겹침 → 문제 표시");
    await pg.click(".prob button[data-fix]"); await pg.waitForTimeout(150);
    check(await pg.evaluate(() => { const p = Store.project(), b = Store.byId(); return p.board.teams.filter((t) => t.filter((id) => b.get(id).special).length > 1).length === 0; }), "자동 해결 후 특수관리 겹침 0");
    // 멘탈 카테고리 수동 겹침 → 문제 → 자동 해결
    await pg.evaluate(() => { const p = Store.project(); const men = p.students.filter((x) => x.mental).map((x) => x.id); Store.moveStudent(men[0], "team-" + Store.teamOf(men[1])); });
    await pg.waitForFunction(() => [...document.querySelectorAll(".prob")].some((x) => /멘탈/.test(x.textContent)), { timeout: 5000 });
    check(true, "멘탈 카테고리 수동 겹침 → 문제 표시");
    await pg.locator('.prob:has-text("멘탈") button[data-fix]').first().click(); await pg.waitForTimeout(150);
    check(await pg.evaluate(() => { const p = Store.project(), b = Store.byId(); return p.board.teams.filter((t) => t.filter((id) => b.get(id).mental).length > 1).length === 0; }), "자동 해결 후 멘탈 겹침 0");

    // 8) 팀장/메모 + 저장·재로드 유지
    console.log("\n[팀장/메모/저장]");
    // 핀 해제 후 저장(미배정 없음 상태)
    const leadId = await pg.evaluate(() => Store.project().board.teams[0][0]);
    await pg.click(`.block[data-id="${leadId}"] .btn-leader`); await pg.waitForTimeout(60);
    check(await pg.evaluate((id) => Store.project().board.leaderByTeam[0] === id, leadId), "팀장 지정");
    await pg.fill('.team-note[data-note="0"]', "발표 강한 팀");
    await pg.locator('.team-note[data-note="0"]').blur(); await pg.waitForTimeout(60);
    await pg.click('[data-act="save"]'); await pg.waitForTimeout(80);
    const savedIdx = await pg.evaluate(() => Store.project().compositions.length - 1);
    await pg.click('.comp-chip[data-comp="0"]'); await pg.waitForTimeout(60);
    await pg.click(`.comp-chip[data-comp="${savedIdx}"]`); await pg.waitForTimeout(80);
    check(await pg.evaluate((id) => Store.project().board.leaderByTeam[0] === id, leadId), "저장·재로드 후 팀장 유지");
    check(await pg.evaluate(() => Store.project().board.notes[0] === "발표 강한 팀"), "저장·재로드 후 메모 유지");

    // 9) CSV 내보내기
    const [dl] = await Promise.all([pg.waitForEvent("download", { timeout: 10000 }), pg.click('[data-act="export"]')]);
    const csv = readFileSync(await dl.path(), "utf-8").replace(/^﻿/, "");
    check(csv.split("\n")[0].startsWith("composition,team,team_name,team_role,team_note,id,name"), "CSV 헤더 정상");
    check(csv.includes(",팀장,") && (/,Y,/.test(csv) || csv.includes(",Y\n") || csv.includes("Y,")), "CSV에 팀장/부팀장/핀 표기 존재");

    // 10) 영속성 (새로고침)
    console.log("\n[영속성/프로젝트/비교]");
    const beforeReload = await pg.evaluate(() => ({ c: Store.project().compositions.length, n: Store.project().name }));
    await pg.evaluate(() => Store.flush()); await pg.reload(); await login(pg, base);
    const afterReload = await pg.evaluate(() => ({ c: Store.project().compositions.length, n: Store.project().name }));
    check(afterReload.c === beforeReload.c && afterReload.n === beforeReload.n, `새로고침 후 복원 (조합 ${afterReload.c})`);

    // 11) 프로젝트 내보내기 → 가져오기
    const exp = await pg.evaluate(() => Store.exportProject());
    await pg.evaluate((j) => Store.importProject(j), exp);
    check(await pg.evaluate(() => Store.listProjects().length >= 2), "프로젝트 export→import 왕복");

    // 12) 비교 탭
    await pg.click('.tab[data-tab="compare"]'); await pg.waitForTimeout(80);
    check(await pg.evaluate(() => document.querySelectorAll(".cmp-table tbody tr").length >= 5 && document.querySelectorAll(".cmp-roster").length >= 1), "비교 탭: 델타 표 + 로스터");

    check(perr.length === 0, "페이지 에러 없음" + (perr.length ? ": " + perr[0] : ""));
  } finally {
    await browser.close(); server.close();
  }
  console.log(`\n${"=".repeat(48)}\nE2E 결과: ${passed} 통과 / ${failed} 실패\n${"=".repeat(48)}`);
  fails.forEach((f) => console.log("  - " + f));
  process.exit(failed ? 1 : 0);
}
run().catch((e) => { console.error("E2E 오류:", e); process.exit(2); });
