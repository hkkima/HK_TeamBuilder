/* 공유용 로그인 게이트 (운영진 내부 공유 목적).
   주의: 정적 페이지의 클라이언트 게이트는 '난독화' 수준의 보호입니다.
   소스를 분석하면 우회 가능하므로 강한 보안이 필요하면 저장소를 private으로 두세요.
   실제 학생 데이터는 브라우저에서만 처리되며 서버/저장소로 전송되지 않습니다. */
(function () {
  "use strict";

  // 자격증명 설정: salt + "\n" + id + "\n" + pw 의 SHA-256(hex).
  // 변경하려면 setup.html 에서 새 해시를 생성해 아래 값을 교체하세요.
  const SALT = "hk_teambuilder_v1";
  const CREDENTIAL_HASH = "e908ea6ba65f59dd9350710e6cb23b382d98f72cd203d8cbcd5e908aa8ea7af8";
  // 기본값: ID = hkadmin / PW = teambuilder2026  (반드시 변경 권장)

  const SESSION_KEY = "hk_tb_auth_ok";

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function reveal() {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.body.classList.add("authed");
    if (window.AppInit && !window.__appInited) { window.__appInited = true; window.AppInit(); }
  }

  async function tryLogin(id, pw) {
    const h = await sha256Hex(`${SALT}\n${id}\n${pw}`);
    return h === CREDENTIAL_HASH;
  }

  document.addEventListener("DOMContentLoaded", function () {
    // 세션 동안 재로그인 생략
    if (sessionStorage.getItem(SESSION_KEY) === "1") { reveal(); return; }

    const form = document.getElementById("login-form");
    const err = document.getElementById("login-error");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      err.textContent = "";
      const id = document.getElementById("login-id").value.trim();
      const pw = document.getElementById("login-pw").value;
      const ok = await tryLogin(id, pw).catch(() => false);
      if (ok) { sessionStorage.setItem(SESSION_KEY, "1"); reveal(); }
      else {
        err.textContent = "ID 또는 비밀번호가 올바르지 않습니다.";
        document.getElementById("login-pw").value = "";
      }
    });
  });

  window.HKLogout = function () { sessionStorage.removeItem(SESSION_KEY); location.reload(); };
})();
