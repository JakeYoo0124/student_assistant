// 조퇴·외출 간단 신청 화면 세 곳. app.js 의 api, escapeHtml 을 사용한다.
//  1) 학생: 출결 신청 화면의 조퇴·외출 폼   2) 학생: 내 현황의 조퇴·외출 목록   3) 담당자: 조퇴·외출 승인

const SHORT_STATUS = { pending: "승인 대기", approved: "승인됨", rejected: "반려" };
const SHORT_BADGE = { pending: "pending", approved: "confirmed", rejected: "rejected" };

function shortTimeText(s) {
  const from = String(s.start_time).slice(0, 5);
  if (s.kind === "외출" && s.end_time) return `${from} ~ ${String(s.end_time).slice(0, 5)}`;
  return `${from}에 퇴실`;
}

function shortCard(s, asManager) {
  const comment = s.manager_comment
    ? `<p class="comment"><strong>반려 사유</strong> ${escapeHtml(s.manager_comment)}</p>`
    : "";
  let actions = "";
  if (!asManager && s.status === "pending") {
    actions = `<button type="button" class="ghost" data-act="cancel" data-sid="${s.id}">신청 취소</button>`;
  }
  if (asManager && s.status === "pending") {
    actions = `<button type="button" class="ok" data-act="approve" data-sid="${s.id}">승인</button>
               <button type="button" class="ghost danger" data-act="reject" data-sid="${s.id}">반려</button>`;
  }
  return `
    <article class="req-card">
      <header><strong>${escapeHtml(s.kind)} · ${s.day}</strong>
        <span class="badge ${SHORT_BADGE[s.status]}">${SHORT_STATUS[s.status]}</span></header>
      ${asManager ? `<div class="who-line">${escapeHtml(s.student_name)} · ${escapeHtml(s.course)}</div>` : ""}
      <p class="meta">${shortTimeText(s)}</p>
      <p class="memo">${escapeHtml(s.reason)}</p>
      ${comment}
      ${actions ? `<div class="req-actions">${actions}</div>` : ""}
    </article>`;
}

// ── 1) 학생: 신청 화면 (결석·휴가 / 조퇴 / 외출 선택) ───────────
function initShortForm() {
  const tabs = document.getElementById("req-kinds");
  const absenceRoot = document.getElementById("req-root");
  const shortRoot = document.getElementById("short-root");
  if (!tabs || !shortRoot) return;

  function drawForm(kind) {
    const isOut = kind === "외출";
    const today = todayStr();
    shortRoot.innerHTML = `
      <form id="short-form" class="panel wide">
        <p class="hint">${kind} 신청은 증빙서류 없이 날짜·시간·사유만 적어서 냅니다. 담당자가 승인하면 확정됩니다.</p>
        <label>날짜<input name="day" type="date" min="${today}" required></label>
        <div class="two">
          <label>${isOut ? "나가는 시각" : "나가는(퇴실) 시각"}<input name="start" type="time" min="09:00" max="18:00" required></label>
          ${isOut ? '<label>돌아오는 시각<input name="end" type="time" min="09:00" max="18:00" required></label>' : ""}
        </div>
        <label>사유<textarea name="reason" rows="3" minlength="2" maxlength="200" required placeholder="예: 병원 진료, 은행 업무"></textarea></label>
        <button class="primary" type="submit">${kind} 신청하기</button>
        <p id="short-msg" class="message" role="alert"></p>
      </form>`;
    const form = document.getElementById("short-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = document.getElementById("short-msg");
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        await api("/short", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            day: form.day.value,
            start_time: form.start.value,
            end_time: isOut ? form.end.value : null,
            reason: form.reason.value,
          }),
        });
        location.hash = "#status";
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "message error";
        btn.disabled = false;
      }
    };
  }

  tabs.onclick = (e) => {
    const btn = e.target.closest("[data-kind]");
    if (!btn) return;
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    const kind = btn.dataset.kind;
    absenceRoot.hidden = kind !== "absence";
    shortRoot.hidden = kind === "absence";
    if (kind !== "absence") drawForm(kind);
  };
}

// ── 2) 학생: 내 현황 안의 조퇴·외출 목록 ────────────────────────
async function initMyShortList() {
  const root = document.getElementById("my-short-root");
  if (!root) return;
  async function load() {
    try {
      const list = await api("/short/mine");
      root.innerHTML = list.length
        ? list.map((s) => shortCard(s, false)).join("")
        : '<div class="placeholder">아직 신청한 조퇴·외출이 없습니다.</div>';
    } catch (err) {
      root.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
    }
  }
  root.onclick = async (e) => {
    const el = e.target.closest('[data-act="cancel"]');
    if (!el) return;
    if (!confirm("이 신청을 취소할까요?")) return;
    try {
      await api(`/short/${el.dataset.sid}`, { method: "DELETE" });
    } catch (err) {
      alert(err.message);
    }
    load();
  };
  load();
}

// ── 3) 담당자: 출결 승인 화면에서 결석·휴가 / 조퇴·외출 전환 ──────
let shortTab = "pending";
const SHORT_TABS = [["pending", "승인 대기"], ["approved", "승인됨"], ["rejected", "반려"], ["", "전체"]];

function initApprovalKinds() {
  const toggle = document.getElementById("apr-kinds");
  const absenceRoot = document.getElementById("apr-root");
  const shortRoot = document.getElementById("apr-short-root");
  if (!toggle || !shortRoot) return;

  toggle.onclick = (e) => {
    const btn = e.target.closest("[data-kind]");
    if (!btn) return;
    toggle.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    const isShort = btn.dataset.kind === "short";
    absenceRoot.hidden = isShort;
    shortRoot.hidden = !isShort;
    if (isShort) drawShortApprovals(shortRoot);
  };
}

function drawShortApprovals(root) {
  root.innerHTML = `
    <div class="tabs-lite">${SHORT_TABS.map(([k, label]) => `<button type="button" data-tab="${k}" class="${k === shortTab ? "on" : ""}">${label}</button>`).join("")}</div>
    <div id="apr-short-list"></div>`;
  const list = document.getElementById("apr-short-list");

  async function load() {
    try {
      const rows = await api(`/short${shortTab ? `?status=${shortTab}` : ""}`);
      list.innerHTML = rows.length
        ? rows.map((s) => shortCard(s, true)).join("")
        : '<div class="placeholder">해당하는 신청이 없습니다.</div>';
    } catch (err) {
      list.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
    }
  }

  root.onclick = async (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      shortTab = tab.dataset.tab;
      root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === tab));
      return load();
    }
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const { act, sid } = el.dataset;
    try {
      if (act === "approve") {
        await api(`/short/${sid}/approve`, { method: "POST" });
      } else if (act === "reject") {
        const comment = prompt("반려 사유를 입력해 주세요");
        if (comment === null) return;
        await api(`/short/${sid}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment }),
        });
      }
    } catch (err) {
      alert(err.message);
    }
    load();
  };
  load();
}
