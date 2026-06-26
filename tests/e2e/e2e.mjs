/* 브라우저 E2E 테스트 (Playwright + 실제 Chromium).
 *
 * 검증 시나리오:
 *   1) 로그인 게이트: 잘못된 PW 거부 / 올바른 자격증명 통과
 *   2) 10·25·60명 규모 각각에 대해 실제 앱에서 팀 추천 생성 후 결과 검증
 *      - 인식 인원수 일치, 추천안 개수, 팀 크기 합/균형, 전원 1회 배정
 *      - 최상위 추천안의 같은 팀 내 갈등쌍 0개(✅ 플래그)
 *      - 추천안들이 서로 다른 구성
 *   3) CSV 내보내기(다운로드) 동작 및 행 수 검증
 *
 * 실행: node tests/e2e/e2e.mjs
 * (데이터는 data/make_sample.py 로 각 규모마다 생성해 앱에 붙여넣어 구동)
 */
import { chromium } from "playwright-core";
import http from "node:http";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const DOCS = path.join(REPO, "docs");
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const CREDENTIALS = { id: "hkadmin", pw: "teambuilder2026" };
const CASES = [
  { n: 10, teams: 2 },
  { n: 25, teams: 5 },
  { n: 60, teams: 10 },
];

// ---- 단순 정적 서버 (docs/ 제공, localhost = secure context) -------------
const MIME = { ".html": "text/html", ".js": "text/javascript",
  ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const fp = path.join(DOCS, path.normalize(p));
    if (!fp.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
    try {
      const body = readFileSync(fp);
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () =>
    resolve({ server, port: server.address().port })));
}

// ---- 데이터 생성 (실제 generator 사용) -----------------------------------
function genData(n, seed = 7) {
  const dir = mkdtempSync(path.join(tmpdir(), `tb-n${n}-`));
  execFileSync("python3", [path.join(REPO, "data", "make_sample.py"),
    "--n", String(n), "--seed", String(seed), "--out-dir", dir]);
  return {
    students: readFileSync(path.join(dir, "students.csv"), "utf-8"),
    evals: readFileSync(path.join(dir, "peer_evaluations.csv"), "utf-8"),
    meta: JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf-8")),
  };
}

// ---- 작은 단언 헬퍼 ------------------------------------------------------
let passed = 0, failed = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ❌ ${label}`); }
}

async function login(page, base, id, pw) {
  await page.goto(base + "/index.html");
  await page.fill("#login-id", id);
  await page.fill("#login-pw", pw);
  await page.click("#login-form button[type=submit]");
}

async function run() {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  try {
    // === 1) 로그인 게이트 ===
    console.log("\n[로그인 게이트]");
    await login(page, base, "hkadmin", "wrong-password");
    await page.waitForTimeout(300);
    check(await page.isHidden("#app"), "잘못된 PW → 앱 접근 차단");
    check((await page.textContent("#login-error")).includes("올바르지"),
      "잘못된 PW → 오류 메시지 표시");

    await login(page, base, CREDENTIALS.id, CREDENTIALS.pw);
    await page.waitForSelector("#app", { state: "visible", timeout: 5000 });
    // 접힌 <details>(강제 규칙/고급 설정) 펼쳐서 입력 가능하게
    await page.evaluate(() =>
      document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    check(true, "올바른 자격증명 → 앱 진입");

    // === 2) 규모별 팀 빌딩 ===
    for (const c of CASES) {
      console.log(`\n[N=${c.n}명 · ${c.teams}팀]`);
      const data = genData(c.n);

      // 이전 케이스의 강제 규칙 잔여값 제거
      await page.fill("#ta-together", "");
      await page.fill("#ta-apart", "");
      await page.fill("#ta-students", data.students);
      await page.fill("#ta-evals", data.evals);
      // 인식 상태 갱신 대기
      await page.waitForFunction(
        (n) => document.getElementById("data-status").textContent.includes(`학생 ${n}명`),
        c.n, { timeout: 5000 });
      check(true, "데이터 인식 (학생 수 표시)");

      await page.selectOption("#mode", "teams");
      await page.fill("#teams", String(c.teams));
      await page.fill("#options", "3");
      await page.fill("#restarts", "40");
      await page.fill("#seed", "42");

      await page.click("#btn-run");
      await page.waitForSelector("#output .rec", { timeout: 90000 });
      await page.waitForFunction(
        () => document.getElementById("overlay").style.display === "none",
        null, { timeout: 90000 });

      // 결과 스크레이핑
      const result = await page.evaluate(() => {
        const recs = [...document.querySelectorAll("#output .rec")].map((rec) => {
          const teams = [...rec.querySelectorAll(".team")].map((t) =>
            [...t.querySelectorAll(".member")].map((m) =>
              m.textContent.replace(/\s+/g, " ").trim()));
          return {
            hasOkFlag: !!rec.querySelector(".flag.ok"),
            teams,
            members: teams.flat(),
          };
        });
        return { summary: document.getElementById("summary").innerText, recs };
      });

      check(result.summary.includes(`${c.n}명`), `요약에 ${c.n}명 표기`);
      check(result.recs.length >= 1 && result.recs.length <= 3,
        `추천안 ${result.recs.length}개 (1~3)`);

      const top = result.recs[0];
      // 팀 크기 합 = N, 전원 유일 1회 배정
      const allMembers = top.members;
      const uniq = new Set(allMembers);
      check(allMembers.length === c.n && uniq.size === c.n,
        `최상위 추천안: 전원 ${c.n}명 정확히 1회 배정`);
      // 팀 개수/크기 균형
      const sizes = top.teams.map((t) => t.length);
      check(sizes.length === c.teams, `팀 개수 ${c.teams}개`);
      check(sizes.reduce((a, b) => a + b, 0) === c.n, "팀 크기 합 = 인원수");
      check(Math.max(...sizes) - Math.min(...sizes) <= 1, "팀 크기 균형(차이 ≤1)");
      // 갈등 분리
      check(top.hasOkFlag, "최상위 추천안: 같은 팀 내 갈등쌍 0개(✅)");
      // 추천안 상이성
      if (result.recs.length >= 2) {
        const sig = (r) => r.teams.map((t) => [...t].sort().join(",")).sort().join("|");
        check(sig(result.recs[0]) !== sig(result.recs[1]),
          "추천안 1 ≠ 추천안 2 (서로 다른 구성)");
      }

      // === 3) CSV 내보내기 (N=25에서) ===
      if (c.n === 25) {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 10000 }),
          page.click("#btn-export"),
        ]);
        const dl = await download.path();
        const csv = readFileSync(dl, "utf-8").replace(/^﻿/, "");
        const lines = csv.trim().split("\n");
        // 헤더 1 + 추천안 수 × N 행
        const expected = 1 + result.recs.length * c.n;
        check(lines.length === expected,
          `CSV 내보내기 행 수 ${lines.length} = 1+${result.recs.length}×${c.n}`);
        check(lines[0].startsWith("option,team,id,name"), "CSV 헤더 정상");
      }

      // === 운영진 강제 규칙 (N=25에서) ===
      if (c.n === 25) {
        console.log("[운영진 강제 규칙: S02+S20 결합 / S05-S06 분리]");
        await page.fill("#ta-together", "S02,S20");
        await page.fill("#ta-apart", "S05,S06");
        await page.click("#btn-run");
        await page.waitForSelector("#output .rec", { timeout: 90000 });
        await page.waitForFunction(
          () => document.getElementById("overlay").style.display === "none",
          null, { timeout: 90000 });

        // 강제 규칙 충족 플래그
        const okForced = await page.evaluate(() =>
          document.querySelector("#output .rec").innerText.includes("강제 규칙 모두 충족"));
        check(okForced, "최상위 추천안: 운영진 강제 규칙 모두 충족(✅)");

        // CSV로 실제 배치 검증
        const [dl2] = await Promise.all([
          page.waitForEvent("download", { timeout: 10000 }),
          page.click("#btn-export"),
        ]);
        const csv2 = readFileSync(await dl2.path(), "utf-8").replace(/^﻿/, "");
        const team = {};
        csv2.trim().split("\n").slice(1).forEach((ln) => {
          const [opt, tm, id] = ln.split(",");
          if (opt === "1") team[id] = tm;
        });
        check(team.S02 === team.S20, `강제 결합: S02·S20 같은 팀(${team.S02})`);
        check(team.S05 !== team.S06, `강제 분리: S05·S06 다른 팀(${team.S05}/${team.S06})`);

        // 모순 제약 → 오류 표시 검증
        await page.fill("#ta-together", "S05,S06");
        await page.fill("#ta-apart", "S05,S06");
        await page.click("#btn-run");
        await page.waitForFunction(
          () => /오류|모순/.test(document.getElementById("output").innerText),
          null, { timeout: 90000 });
        check(true, "모순 제약(결합+분리 동일 쌍) → 오류 메시지");
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${"=".repeat(48)}`);
  console.log(`E2E 결과: ${passed} 통과 / ${failed} 실패`);
  if (failed) { console.log("실패 항목:"); failures.forEach((f) => console.log("  - " + f)); }
  console.log("=".repeat(48));
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error("E2E 실행 오류:", e); process.exit(2); });
