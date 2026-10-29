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

async function loadCourses() {
  try {
    const courses = await api("/courses");
    const select = document.querySelector('#signup-form select[name="course"]');
    courses.forEach((c) => select.add(new Option(c, c)));
  } catch {
    showMessage("과정 목록을 불러오지 못했습니다. 서버가 켜져 있는지 확인해 주세요.");
  }
}
loadCourses();

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
        course: f.get("course"),
      }),
    });
    e.target.reset();
    setTab("login");
    showMessage("가입 신청이 접수되었습니다. 담당자가 승인하면 로그인할 수 있습니다.", "ok");
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
};

// ── 앱 화면 ────────────────────────────────────────────────
const ROLE_LABEL = { student: "학생", instructor: "강사", manager: "담당자" };

// 역할별 메뉴. 화면에서만 숨기는 것이고, 실제 권한은 서버가 검사한다.
const NAV = {
  student: [
    ["home", "홈"], ["request", "출결 신청"], ["status", "출결 현황"],
    ["calendar", "수업 일정"], ["notice", "공지사항"], ["docs", "문서 보관함"], ["chat", "AI 도우미"],
  ],
  instructor: [
    ["home", "홈"], ["calendar", "수업 일정·계획"], ["absences", "결석 예정"], ["chat", "AI 도우미"],
  ],
  manager: [
    ["home", "홈"], ["signups", "가입 승인"], ["approvals", "출결 승인"], ["status", "전체 출결 현황"],
    ["calendar", "수업 일정 관리"], ["notice", "공지 작성"], ["managers", "담당자 관리"], ["chat", "AI 도우미"],
  ],
};

const PAGES = {
  home: (user) => `
    <h2>${escapeHtml(user.name)}님, 안녕하세요</h2>
    <p class="desc">${{ manager: "처리할 일과 오늘의 현황입니다.", instructor: "오늘 우리 과정의 현황과 수업 계획입니다." }[user.role] || "내 출결 현황과 오늘의 수업 계획입니다."}</p>
    <div id="dash-root"></div>
    <div id="home-plan"></div>`,
  request: () => `
    <h2>출결 신청</h2>
    <p class="desc">결석(공결·휴가), 조퇴, 외출을 신청합니다. 결석은 승인된 뒤 증빙서류를 올려 주세요.</p>
    <div class="tabs-lite" id="req-kinds">
      <button type="button" data-kind="absence" class="on">결석·휴가</button>
      <button type="button" data-kind="조퇴">조퇴</button>
      <button type="button" data-kind="외출">외출</button>
    </div>
    <div id="req-root"></div>
    <div id="short-root" hidden></div>`,
  status: (u) => u.role === "manager"
    ? placeholder("전체 출결 현황", "모든 반 학생의 출결 기록과 위험군을 보는 화면입니다.")
    : `<h2>출결 현황</h2>
       <p class="desc">내가 신청한 내역과 승인 상태입니다. 승인된 신청은 기한 안에 증빙서류를 올려 주세요.</p>
       <div id="my-root"></div>
       <h3 class="section">조퇴·외출 신청</h3>
       <div id="my-short-root"></div>`,
  calendar: (u) => `
    <h2>${{ manager: "수업 일정 관리", instructor: "수업 일정·계획" }[u.role] || "수업 일정"}</h2>
    <p class="desc">${{
      manager: "과정별 수업 기간과 휴강일을 입력합니다. 날짜를 누르면 강사가 쓴 그날의 수업 계획을 볼 수 있습니다.",
      instructor: "날짜를 눌러 그날의 수업 계획을 시간대별로 쓰고 고칩니다. 학생은 이 계획을 읽기만 합니다.",
    }[u.role] || "내 과정의 수업일과 휴강일입니다. 날짜를 누르면 그날의 수업 계획이 보입니다."}</p>
    <div id="cal-root"></div>`,
  notice: (u) => u.role === "manager"
    ? placeholder("공지 작성", "학생들에게 보낼 공지를 작성하는 화면입니다.")
    : placeholder("공지사항", "담당자가 올린 공지를 보는 화면입니다."),
  docs: () => placeholder("문서 보관함", "제출한 증빙서류를 모아 보는 화면입니다."),
  chat: () => placeholder("AI 도우미", "출결 규정을 물어보는 챗봇입니다."),
  signups: () => `
    <h2>가입 승인</h2>
    <p class="desc">가입을 신청한 학생입니다. 승인해야 로그인할 수 있습니다.</p>
    <div id="signup-list" class="list"><div class="placeholder">불러오는 중...</div></div>`,
  absences: () => `
    <h2>결석 예정</h2>
    <p class="desc">우리 과정에서 결석이 예정되었거나 진행 중인 학생입니다. 사유와 서류는 담당자만 확인합니다.</p>
    <div id="abs-root" class="list"><div class="placeholder">불러오는 중...</div></div>`,
  approvals: () => `
    <h2>출결 승인</h2>
    <p class="desc">학생들의 신청을 승인하고, 제출된 증빙서류를 확인합니다.</p>
    <div class="tabs-lite" id="apr-kinds">
      <button type="button" data-kind="absence" class="on">결석·휴가</button>
      <button type="button" data-kind="short">조퇴·외출</button>
    </div>
    <div id="apr-root"></div>
    <div id="apr-short-root" hidden></div>`,
  managers: () => `
    <h2>담당자 관리</h2>
    <p class="desc">새 담당자 계정을 추가합니다. 담당자는 모든 반의 신청을 승인할 수 있습니다.</p>
    <form id="manager-form" class="panel">
      <label>이름<input name="name" type="text" required></label>
      <label>이메일<input name="email" type="email" required></label>
      <label>임시 비밀번호 (8자 이상)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="primary" type="submit">담당자 추가</button>
      <p id="manager-msg" class="message" role="alert"></p>
    </form>
    <div id="inst-root"></div>`,
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

function renderNav() {
  const items = NAV[currentUser.role] || NAV.student;
  document.getElementById("nav").innerHTML = items
    .map(([key, label]) => `<a href="#${key}" class="nav-item" data-page="${key}">${label}</a>`)
    .join("");
}

function renderPage() {
  const allowed = (NAV[currentUser.role] || NAV.student).map(([key]) => key);
  const name = location.hash.slice(1) || "home";
  const key = allowed.includes(name) && PAGES[name] ? name : "home";
  pageEl.innerHTML = PAGES[key](currentUser);
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === key);
  });
  if (key === "managers") { bindManagerForm(); initInstructorSection(); }
  if (key === "home") { initDashboard(); initHomePlan(); }
  if (key === "absences") initAbsencesPage();
  if (key === "signups") loadSignups();
  if (key === "calendar") initCalendarPage();
  if (key === "request") { initRequestPage(); initShortForm(); }
  if (key === "status" && currentUser.role !== "manager") { initMyRequestsPage(); initMyShortList(); }
  if (key === "approvals") { initApprovalsPage(); initApprovalKinds(); }
}

async function loadSignups() {
  const box = document.getElementById("signup-list");
  try {
    const list = await api("/signups");
    if (!list.length) {
      box.innerHTML = '<div class="placeholder">승인 대기 중인 가입 신청이 없습니다.</div>';
      return;
    }
    box.innerHTML = list.map((u) => `
      <div class="row" data-id="${u.id}">
        <div class="who"><strong>${escapeHtml(u.name)}</strong><span>${escapeHtml(u.course || "과정 미선택")} · ${escapeHtml(u.email)}</span></div>
        <div class="actions">
          <button class="approve" type="button">승인</button>
          <button class="reject" type="button">반려</button>
        </div>
      </div>`).join("");
    box.querySelectorAll(".row").forEach((row) => {
      const id = row.dataset.id;
      const name = row.querySelector("strong").textContent;
      row.querySelector(".approve").onclick = () => decideSignup(id, "approve");
      row.querySelector(".reject").onclick = () => {
        if (confirm(`${name} 님의 가입을 반려할까요? 가입 정보가 삭제됩니다.`)) decideSignup(id, "reject");
      };
    });
  } catch (err) {
    box.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
  }
}

async function decideSignup(id, action) {
  try {
    if (action === "approve") await api(`/signups/${id}/approve`, { method: "POST" });
    else await api(`/signups/${id}`, { method: "DELETE" });
  } catch (err) {
    alert(err.message);
  }
  loadSignups();
}

function bindManagerForm() {
  const form = document.getElementById("manager-form");
  const msg = document.getElementById("manager-msg");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const m = await api("/managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.get("name"), email: f.get("email"), password: f.get("password") }),
      });
      msg.textContent = `${m.name} 담당자 계정을 만들었습니다.`;
      msg.className = "message ok";
      form.reset();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "message error";
    } finally {
      btn.disabled = false;
    }
  };
}

async function enterApp() {
  currentUser = await api("/me");
  const role = ROLE_LABEL[currentUser.role] || currentUser.role;
  document.getElementById("user-info").textContent =
    `${currentUser.name} (${currentUser.course ? `${role} · ${currentUser.course}` : role})`;
  authView.hidden = true;
  appView.hidden = false;
  renderNav();
  renderPage();
  startNotifications();
}

function leaveApp() {
  stopNotifications();
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
