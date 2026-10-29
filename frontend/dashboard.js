// 홈 화면 대시보드. 역할마다 다른 요약을 그린다. app.js 의 api, currentUser, escapeHtml 을 사용한다.

const fmtDays = (a, b) => (a === b ? a : `${a} ~ ${b}`);

function tile(label, value, sub = "", href = "", tone = "") {
  const inner = `<div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}`;
  return href ? `<a class="tile link ${tone}" href="${href}">${inner}</a>` : `<div class="tile ${tone}">${inner}</div>`;
}

function listBlock(title, rows, empty) {
  return `
    <section class="dash-block">
      <h3>${title}</h3>
      ${rows.length ? `<ul>${rows.join("")}</ul>` : `<p class="muted">${empty}</p>`}
    </section>`;
}

function renderStudent(d) {
  if (!d.has_term) {
    return `<div class="placeholder">${d.course ? "아직 수업 기간이 등록되지 않았습니다. 담당자에게 문의해 주세요." : "과정이 지정되지 않은 계정입니다."}</div>`;
  }
  const p = d.progress;
  const v = d.vacation;
  const todoRows = d.todo.evidence.map(
    (e) => `<li class="${e.overdue ? "late" : ""}"><a href="#status"><strong>${escapeHtml(e.reason)}</strong> ${fmtDays(e.start_date, e.end_date)}
      <span>증빙서류 기한 ${e.due}${e.overdue ? " (지났습니다)" : ""}</span></a></li>`,
  );
  if (d.todo.pending) todoRows.push(`<li><a href="#status">승인 대기 중인 신청 ${d.todo.pending}건 <span>담당자가 확인하면 알려 드립니다</span></a></li>`);

  return `
    <div class="grid">
      <div class="tile wide">
        <div class="label">수업 진행률</div>
        <div class="value">${p.percent}<small>%</small></div>
        <div class="bar"><i style="width:${p.percent}%"></i></div>
        <div class="sub">오늘까지 ${p.done}일 / 전체 ${p.total}일</div>
      </div>
      ${tile("남은 휴가", v.limit ? `${v.left}<small>일</small>` : "-", v.limit ? `발생 ${v.accrued}일 · 사용 ${v.used}일 (과정 전체 ${v.limit}일)` : "이 과정은 휴가가 부여되지 않습니다")}
      ${tile("질병·입원", `${d.sick.used}<small>/ ${d.sick.limit}일</small>`, "신청한 일수 (상한까지만 인정)", "", d.sick.limit && d.sick.used >= d.sick.limit * 0.8 ? "warn" : "")}
      ${tile("이번 달", `${d.month.absence_days}<small>일 결석</small>`, `조퇴 ${d.month.early}회 · 외출 ${d.month.out}회 (승인된 것)`, "#calendar")}
    </div>
    ${listBlock("처리할 일", todoRows, "처리할 일이 없습니다.")}`;
}

function renderInstructor(d) {
  if (!d.course) return '<div class="placeholder">담당 과정이 지정되지 않은 계정입니다.</div>';
  if (!d.class_day) return `<div class="placeholder">오늘은 ${escapeHtml(d.course)} 수업이 없는 날입니다.</div>`;
  const absent = d.absent.map((a) => `<li><strong>${escapeHtml(a.student)}</strong> <span>결석 ${fmtDays(a.start_date, a.end_date)}</span></li>`);
  const short = d.short.map((s) => `<li><strong>${escapeHtml(s.student)}</strong> <span>${s.kind} ${s.when}</span></li>`);
  return `
    <div class="grid">
      ${tile("오늘 결석", `${d.absent.length}<small>명</small>`, `우리 과정 학생 ${d.students}명`, "#absences")}
      ${tile("오늘 조퇴·외출", `${d.short.length}<small>건</small>`, "승인된 것")}
    </div>
    <div class="dash-cols">
      ${listBlock("오늘 결석", absent, "오늘 결석 예정인 학생이 없습니다.")}
      ${listBlock("오늘 조퇴·외출", short, "오늘 조퇴·외출 예정인 학생이 없습니다.")}
    </div>`;
}

function renderManager(d) {
  const p = d.pending;
  const total = p.signups + p.absences + p.evidence + p.short;
  const overdue = d.overdue.map((o) => `<li class="late"><a href="#approvals"><strong>${escapeHtml(o.student)}</strong> ${escapeHtml(o.course)} · ${escapeHtml(o.reason)}
      <span>증빙 기한 ${o.due} 지남</span></a></li>`);
  const absent = d.today_absent.map((a) => `<li><strong>${escapeHtml(a.student)}</strong> <span>${escapeHtml(a.course)} · 결석 ${fmtDays(a.start_date, a.end_date)}</span></li>`);
  const short = d.today_short.map((s) => `<li><strong>${escapeHtml(s.student)}</strong> <span>${escapeHtml(s.course)} · ${s.kind} ${s.when}</span></li>`);
  const watch = d.watch.map((w) => `<li class="late"><strong>${escapeHtml(w.student)}</strong> <span>${escapeHtml(w.course)} · ${escapeHtml(w.why)}</span></li>`);
  const courses = d.courses
    .map(
      (c) => `<tr><td>${escapeHtml(c.course)}</td><td>${c.students}명</td>
        <td>${c.has_term ? `${c.month_absence_days}일` : "-"}</td><td>${c.month_early}회</td><td>${c.month_out}회</td></tr>`,
    )
    .join("");

  return `
    <h3 class="section first">처리 대기 <small class="muted">${total ? `${total}건` : "없음"}</small></h3>
    <div class="grid">
      ${tile("가입 승인", `${p.signups}<small>건</small>`, "", "#signups", p.signups ? "alert" : "")}
      ${tile("결석 승인", `${p.absences}<small>건</small>`, "", "#approvals", p.absences ? "alert" : "")}
      ${tile("증빙 확인", `${p.evidence}<small>건</small>`, "", "#approvals", p.evidence ? "alert" : "")}
      ${tile("조퇴·외출 승인", `${p.short}<small>건</small>`, "", "#approvals", p.short ? "alert" : "")}
    </div>
    <div class="dash-cols">
      ${listBlock("증빙 기한이 지난 신청", overdue, "기한이 지난 신청이 없습니다.")}
      ${listBlock("주의가 필요한 학생", watch, "주의가 필요한 학생이 없습니다.")}
      ${listBlock("오늘 결석", absent, "오늘 결석 예정인 학생이 없습니다.")}
      ${listBlock("오늘 조퇴·외출", short, "오늘 조퇴·외출 예정인 학생이 없습니다.")}
    </div>
    <section class="dash-block">
      <h3>과정별 요약 <small class="muted">이번 달, 승인된 신청 기준</small></h3>
      <table class="mini"><thead><tr><th>과정</th><th>학생</th><th>결석</th><th>조퇴</th><th>외출</th></tr></thead><tbody>${courses}</tbody></table>
    </section>`;
}

async function initDashboard() {
  const root = document.getElementById("dash-root");
  if (!root) return;
  try {
    const d = await api("/dashboard");
    root.innerHTML = { student: renderStudent, instructor: renderInstructor, manager: renderManager }[d.role](d);
  } catch (err) {
    root.innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
  }
}
