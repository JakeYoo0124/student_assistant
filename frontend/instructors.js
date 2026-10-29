// 강사 관련 화면 두 가지. app.js 의 api, escapeHtml 을 사용한다.
//  1) 담당자 화면의 '강사 관리' 영역   2) 강사 화면의 '결석 예정' 목록

async function initInstructorSection() {
  const root = document.getElementById("inst-root");
  if (!root) return;
  let courses, list;
  try {
    [courses, list] = await Promise.all([api("/courses"), api("/instructors")]);
  } catch (err) {
    root.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
    return;
  }

  const taken = new Set(list.map((i) => i.course));
  const freeCourses = courses.filter((c) => !taken.has(c));

  const rows = list.length
    ? list
        .map(
          (i) => `
        <div class="row" data-id="${i.id}">
          <div class="who"><strong>${escapeHtml(i.name)}</strong><span>${escapeHtml(i.course || "")} · ${escapeHtml(i.email)}</span></div>
          <div class="actions"><button class="reject" type="button">삭제</button></div>
        </div>`,
        )
        .join("")
    : '<div class="placeholder">등록된 강사가 없습니다.</div>';

  const addForm = freeCourses.length
    ? `
    <form id="inst-form" class="panel">
      <h3>강사 추가</h3>
      <label>이름<input name="name" type="text" required></label>
      <label>담당 과정
        <select name="course" required>${freeCourses.map((c) => `<option>${escapeHtml(c)}</option>`).join("")}</select>
      </label>
      <label>이메일<input name="email" type="email" required></label>
      <label>임시 비밀번호 (8자 이상)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="primary" type="submit">강사 추가</button>
      <p id="inst-msg" class="message" role="alert"></p>
    </form>`
    : '<p class="muted">모든 과정에 강사가 등록되어 있습니다.</p>';

  root.innerHTML = `
    <h3 class="section">강사</h3>
    <p class="desc">과정마다 강사는 1명입니다. 강사는 자기 과정의 수업 계획을 쓰고, 결석 예정 학생의 이름과 기간만 볼 수 있습니다.</p>
    <div class="list">${rows}</div>
    ${addForm}`;

  root.querySelectorAll(".row .reject").forEach((btn) => {
    btn.onclick = async () => {
      const row = btn.closest(".row");
      const name = row.querySelector("strong").textContent;
      if (!confirm(`${name} 강사 계정을 삭제할까요?\n이 강사가 쓴 수업 계획은 남고, 작성자만 '삭제된 사용자'로 표시됩니다.`)) return;
      try {
        await api(`/instructors/${row.dataset.id}`, { method: "DELETE" });
        initInstructorSection();
      } catch (err) {
        alert(err.message);
      }
    };
  });

  const form = document.getElementById("inst-form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const msg = document.getElementById("inst-msg");
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        await api("/instructors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: f.get("name"),
            email: f.get("email"),
            password: f.get("password"),
            course: f.get("course"),
          }),
        });
        initInstructorSection();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "message error";
        btn.disabled = false;
      }
    };
  }
}

// 강사: 우리 과정에서 결석이 예정됐거나 진행 중인 학생 (이름·기간만)
async function initAbsencesPage() {
  const root = document.getElementById("abs-root");
  if (!root) return;
  try {
    const list = await api("/excuse/course");
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    root.innerHTML = list.length
      ? list
          .map((a) => {
            const now = a.start_date <= today && today <= a.end_date;
            const range = a.start_date === a.end_date ? a.start_date : `${a.start_date} ~ ${a.end_date}`;
            return `
        <div class="row">
          <div class="who"><strong>${escapeHtml(a.student_name)}</strong>
            <span>${range} · 수업일 ${a.class_days}일${now ? " · 오늘 결석" : ""}</span></div>
          <span class="badge ${a.approved ? "confirmed" : "pending"}">${a.approved ? "승인됨" : "승인 대기"}</span>
        </div>`;
          })
          .join("")
      : '<div class="placeholder">결석 예정인 학생이 없습니다.</div>';
  } catch (err) {
    root.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
  }
}
