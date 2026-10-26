// 출결 신청 / 내 현황 / 담당자 승인 화면. app.js 의 api, currentUser, escapeHtml, TOKEN_KEY 를 사용한다.
const STATUS_LABEL = {
  pending: "승인 대기",
  approved: "증빙 제출 대기",
  submitted: "증빙 확인 대기",
  confirmed: "출석 인정 완료",
  rejected: "반려",
};

const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

function formMessage(el, text, type) {
  el.textContent = text;
  el.className = `message ${type}`;
}

// ── 학생: 신청 화면 ─────────────────────────────────────────
async function initRequestPage() {
  const root = document.getElementById("req-root");
  let rules, docGuide;
  try {
    ({ rules, doc_guide: docGuide } = await api("/excuse/rules"));
  } catch (err) {
    root.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
    return;
  }

  root.innerHTML = `
    <form id="req-form" class="panel wide">
      <label>사유
        <select name="reason" required>
          <option value="" disabled selected>사유를 선택하세요</option>
          ${rules.map((r) => `<option>${escapeHtml(r.reason)}</option>`).join("")}
        </select>
      </label>
      <label>대상
        <select name="target" required disabled><option value="">사유를 먼저 선택하세요</option></select>
      </label>
      <div id="req-info" class="info" hidden></div>
      <div class="two">
        <label>시작일<input name="start" type="date" min="${todayStr()}" required></label>
        <label>종료일<input name="end" type="date" min="${todayStr()}" required></label>
      </div>
      <label>상세 사유 (선택)<textarea name="memo" rows="3" maxlength="300" placeholder="담당자에게 전할 내용을 적어 주세요"></textarea></label>
      <button class="primary" type="submit">신청하기</button>
      <p id="req-msg" class="message" role="alert"></p>
    </form>`;

  const form = document.getElementById("req-form");
  const info = document.getElementById("req-info");
  const targetSel = form.target;

  form.reason.onchange = () => {
    const rule = rules.find((r) => r.reason === form.reason.value);
    targetSel.disabled = false;
    targetSel.innerHTML =
      '<option value="" disabled selected>대상을 선택하세요</option>' +
      rule.targets.map((t) => `<option>${escapeHtml(t)}</option>`).join("");
    if (rule.targets.length === 1) targetSel.value = rule.targets[0];
    showInfo();
  };
  targetSel.onchange = showInfo;

  function showInfo() {
    const rule = rules.find((r) => r.reason === form.reason.value);
    if (!rule) return (info.hidden = true);
    const days = rule.days_label;
    const docs = targetSel.value ? rule.docs[targetSel.value] : null;
    const docList = docs
      ? docs
          .map((d) => `<li><details><summary>${escapeHtml(d)}</summary><p>${escapeHtml(docGuide[d] || "등록된 안내가 없습니다.")}</p></details></li>`)
          .join("")
      : "<li>대상을 선택하면 필요한 서류가 보입니다.</li>";
    info.hidden = false;
    info.innerHTML = `
      <p><strong>인정 일수</strong> ${days}</p>
      ${rule.note ? `<p class="note">${escapeHtml(rule.note)}</p>` : ""}
      <p><strong>필요한 증빙서류</strong> <span class="muted">(서류 이름을 누르면 설명이 보입니다)</span></p>
      <ul>${docList}</ul>
      <p class="note">증빙서류는 신청이 승인된 뒤, <strong>결석 마지막 날의 다음 수업일까지</strong> 올려야 합니다.</p>`;
  }

  form.start.onchange = () => {
    form.end.min = form.start.value || todayStr();
    if (form.end.value && form.end.value < form.start.value) form.end.value = form.start.value;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById("req-msg");
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await api("/excuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: form.reason.value,
          target: form.target.value,
          start_date: form.start.value,
          end_date: form.end.value,
          memo: form.memo.value,
        }),
      });
      location.hash = "#status"; // 내 현황에서 방금 낸 신청이 보인다
    } catch (err) {
      formMessage(msg, err.message, "error");
    } finally {
      btn.disabled = false;
    }
  };
}

// ── 카드 그리기 (학생·담당자 공용) ──────────────────────────
function requestCard(r, asManager) {
  const badge = `<span class="badge ${r.status}">${STATUS_LABEL[r.status]}${r.overdue ? " · 기한 초과" : ""}</span>`;
  const who = asManager
    ? `<div class="who-line">${escapeHtml(r.student_name)} · ${escapeHtml(r.course)}</div>`
    : "";
  const partial = r.recognized_days < r.class_days
    ? `<p class="warn">${escapeHtml(r.rule_note)}</p>`
    : "";
  const comment = r.manager_comment
    ? `<p class="comment"><strong>${r.status === "rejected" ? "반려 사유" : "담당자 의견"}</strong> ${escapeHtml(r.manager_comment)}</p>`
    : "";

  let evidence = "";
  if (["approved", "submitted", "confirmed"].includes(r.status)) {
    const due = r.evidence_due
      ? `<p class="due ${r.overdue ? "late" : ""}">증빙 제출 기한 ${r.evidence_due}${r.overdue ? " (기한이 지났습니다)" : ""}</p>`
      : "";
    const rows = r.required_docs
      .map((doc) => {
        const file = r.evidence.find((e) => e.doc_name === doc && !e.rejected);
        const link = file
          ? `<a href="#" data-act="view" data-rid="${r.id}" data-eid="${file.id}">${escapeHtml(file.filename)}</a>`
          : '<span class="muted">미제출</span>';
        const canUpload = !asManager && r.status === "approved";
        const upload = canUpload
          ? `<span class="up"><input type="file" accept=".pdf,.jpg,.jpeg,.png" data-doc="${escapeHtml(doc)}"><button type="button" class="ghost" data-act="upload" data-rid="${r.id}" data-doc="${escapeHtml(doc)}">${file ? "다시 올리기" : "올리기"}</button></span>`
          : "";
        return `<li><span class="doc">${escapeHtml(doc)}</span> ${link} ${upload}</li>`;
      })
      .join("");
    evidence = `<div class="evidence">${due}<ul>${rows}</ul></div>`;
  }

  let actions = "";
  if (!asManager && r.status === "pending") {
    actions = `<button type="button" class="ghost" data-act="cancel" data-rid="${r.id}">신청 취소</button>`;
  }
  if (asManager && r.status === "pending") {
    actions = `<button type="button" class="ok" data-act="approve" data-rid="${r.id}">승인</button>
               <button type="button" class="ghost danger" data-act="reject" data-rid="${r.id}">반려</button>`;
  }
  if (asManager && r.status === "submitted") {
    actions = `<button type="button" class="ok" data-act="confirm" data-rid="${r.id}">증빙 확인(인정)</button>
               <button type="button" class="ghost danger" data-act="reject-evidence" data-rid="${r.id}">증빙 반려</button>`;
  }

  return `
    <article class="req-card">
      <header><strong>${escapeHtml(r.reason)} · ${escapeHtml(r.target)}</strong>${badge}</header>
      ${who}
      <p class="meta">${r.start_date} ~ ${r.end_date} · 수업일 ${r.class_days}일 · 인정 ${r.recognized_days}일</p>
      ${partial}
      ${r.memo ? `<p class="memo">${escapeHtml(r.memo)}</p>` : ""}
      ${comment}
      ${evidence}
      ${actions ? `<div class="req-actions">${actions}</div>` : ""}
    </article>`;
}

async function openEvidence(rid, eid) {
  const win = window.open("", "_blank"); // 클릭 직후에 열어야 팝업 차단이 안 된다
  try {
    const res = await fetch(`/excuse/${rid}/evidence/${eid}/file`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
    });
    if (!res.ok) throw new Error("파일을 열 수 없습니다");
    win.location = URL.createObjectURL(await res.blob());
  } catch (err) {
    if (win) win.close();
    alert(err.message);
  }
}

// ── 학생: 내 현황 ───────────────────────────────────────────
async function initMyRequestsPage() {
  const root = document.getElementById("my-root");
  async function load() {
    try {
      const list = await api("/excuse/mine");
      root.innerHTML = list.length
        ? list.map((r) => requestCard(r, false)).join("")
        : '<div class="placeholder">아직 신청한 내역이 없습니다.</div>';
    } catch (err) {
      root.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
    }
  }

  root.onclick = async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const { act, rid, eid, doc } = el.dataset;
    if (act === "view") {
      e.preventDefault();
      return openEvidence(rid, eid);
    }
    if (act === "cancel") {
      if (!confirm("이 신청을 취소할까요?")) return;
      try { await api(`/excuse/${rid}`, { method: "DELETE" }); } catch (err) { alert(err.message); }
      return load();
    }
    if (act === "upload") {
      const input = el.parentElement.querySelector('input[type="file"]');
      if (!input.files.length) return alert("올릴 파일을 먼저 선택해 주세요");
      const fd = new FormData();
      fd.append("doc_name", doc);
      fd.append("file", input.files[0]);
      el.disabled = true;
      try { await api(`/excuse/${rid}/evidence`, { method: "POST", body: fd }); } catch (err) { alert(err.message); }
      return load();
    }
  };
  load();
}

// ── 담당자: 출결 승인 ───────────────────────────────────────
const APPROVAL_TABS = [
  ["pending", "승인 대기"],
  ["submitted", "증빙 확인"],
  ["approved", "증빙 대기"],
  ["", "전체"],
];
let approvalTab = "pending";

async function initApprovalsPage() {
  const root = document.getElementById("apr-root");
  root.innerHTML = `
    <div class="tabs-lite">${APPROVAL_TABS.map(([k, label]) => `<button type="button" data-tab="${k}" class="${k === approvalTab ? "on" : ""}">${label}</button>`).join("")}</div>
    <div id="apr-list"></div>`;
  const list = document.getElementById("apr-list");

  async function load() {
    try {
      const rows = await api(`/excuse${approvalTab ? `?status=${approvalTab}` : ""}`);
      list.innerHTML = rows.length
        ? rows.map((r) => requestCard(r, true)).join("")
        : '<div class="placeholder">해당하는 신청이 없습니다.</div>';
    } catch (err) {
      list.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
    }
  }

  root.onclick = async (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      approvalTab = tab.dataset.tab;
      root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === tab));
      return load();
    }
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const { act, rid, eid } = el.dataset;
    if (act === "view") {
      e.preventDefault();
      return openEvidence(rid, eid);
    }
    const post = async (path, body) => {
      try {
        await api(path, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        alert(err.message);
      }
      load();
    };
    if (act === "approve") return post(`/excuse/${rid}/approve`);
    if (act === "confirm") return post(`/excuse/${rid}/evidence/confirm`);
    if (act === "reject" || act === "reject-evidence") {
      const comment = prompt(act === "reject" ? "반려 사유를 입력해 주세요" : "증빙을 반려하는 사유를 입력해 주세요");
      if (comment === null) return;
      return post(act === "reject" ? `/excuse/${rid}/reject` : `/excuse/${rid}/evidence/reject`, { comment });
    }
  };
  load();
}
