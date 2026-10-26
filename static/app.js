const TOKEN_KEY = "token";

const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const messageEl = document.getElementById("message");
const pageEl = document.getElementById("page");

// ── 화면 전환 ──────────────────────────────────────────────
function showMessage(text, type = "error") {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}

function setTab(name) {
  const isLogin = name === "login";
  document.getElementById("login-form").hidden = !isLogin;
  document.getElementById("signup-form").hidden = isLogin;
  document.getElementById("tab-login").classList.toggle("active", isLogin);
  document.getElementById("tab-signup").classList.toggle("active", !isLogin);
  showMessage("");
}

document.getElementById("tab-login").onclick = () => setTab("login");
document.getElementById("tab-signup").onclick = () => setTab("signup");

// ── 서버 요청 ──────────────────────────────────────────────
async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "요청에 실패했습니다";
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function login(email, password) {
  // 서버의 /login 은 폼 형식(username, password)을 받는다
  const body = new URLSearchParams({ username: email, password });
  const data = await api("/login", { method: "POST", body });
  localStorage.setItem(TOKEN_KEY, data.access_token);
}

// ── 로그인 / 회원가입 폼 ───────────────────────────────────
document.getElementById("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await login(f.get("email"), f.get("password"));
    await enterApp();
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
};

document.getElementById("signup-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        email: f.get("email"),
        password: f.get("password"),
      }),
    });
    await login(f.get("email"), f.get("password"));
    await enterApp();
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
};

// ── 앱 화면 ────────────────────────────────────────────────
const ROLE_LABEL = { student: "학생", manager: "매니저", admin: "관리자" };

const PAGES = {
  home: (user) => `
    <h2>${escapeHtml(user.name)}님, 안녕하세요</h2>
    <p class="desc">오늘의 출결 현황을 확인하세요.</p>
    <div class="grid">
      <div class="tile"><div class="label">출석률</div><div class="value soon">준비 중</div></div>
      <div class="tile"><div class="label">결석·조퇴</div><div class="value soon">준비 중</div></div>
      <div class="tile"><div class="label">남은 휴가</div><div class="value soon">준비 중</div></div>
    </div>`,
  request: () => placeholder("출결 신청", "결석·조퇴·휴가를 신청하는 화면입니다."),
  status: () => placeholder("출결 현황", "내 출결 기록과 승인 상태를 보는 화면입니다."),
  calendar: () => placeholder("수업 일정", "반별 수업일과 휴강일을 보는 캘린더입니다."),
  notice: () => placeholder("공지사항", "매니저가 올린 공지를 보는 화면입니다."),
  docs: () => placeholder("문서 보관함", "제출한 증빙서류를 모아 보는 화면입니다."),
  chat: () => placeholder("AI 도우미", "출결 규정을 물어보는 챗봇입니다."),
};

function placeholder(title, desc) {
  return `<h2>${title}</h2><p class="desc">${desc}</p><div class="placeholder">아직 만들지 않은 기능입니다.</div>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

let currentUser = null;

function renderPage() {
  const name = location.hash.slice(1) || "home";
  const key = PAGES[name] ? name : "home";
  pageEl.innerHTML = PAGES[key](currentUser);
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === key);
  });
}

async function enterApp() {
  currentUser = await api("/me");
  document.getElementById("user-info").textContent =
    `${currentUser.name} (${ROLE_LABEL[currentUser.role] || currentUser.role})`;
  authView.hidden = true;
  appView.hidden = false;
  renderPage();
}

function leaveApp() {
  localStorage.removeItem(TOKEN_KEY);
  currentUser = null;
  appView.hidden = true;
  authView.hidden = false;
  setTab("login");
}

document.getElementById("logout").onclick = leaveApp;
window.addEventListener("hashchange", () => currentUser && renderPage());

// 새로고침해도 토큰이 유효하면 로그인 상태 유지
(async () => {
  if (!localStorage.getItem(TOKEN_KEY)) return;
  try {
    await enterApp();
  } catch {
    leaveApp();
  }
})();
