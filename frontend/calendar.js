// 수업 일정(달력)과 일일 수업 계획 화면. app.js 의 api, currentUser, escapeHtml 을 사용한다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const cal = { course: null, year: 0, month: 0, schedule: null, plans: [], selected: null, editingId: null };

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const hhmm = (t) => String(t).slice(0, 5); // "09:10:00" -> "09:10"

async function initCalendarPage() {
  const root = document.getElementById("cal-root");
  const now = new Date();
  cal.year = now.getFullYear();
  cal.month = now.getMonth();
  cal.selected = ymd(cal.year, cal.month, now.getDate());
  cal.editingId = null;

  if (currentUser.role === "manager") {
    const courses = await api("/courses");
    if (!courses.includes(cal.course)) cal.course = courses[0];
    root.innerHTML = `
      <div class="toolbar">
        <label>과정
          <select id="cal-course">${courses
            .map((c) => `<option ${c === cal.course ? "selected" : ""}>${escapeHtml(c)}</option>`)
            .join("")}</select>
        </label>
      </div>
      <div id="cal-body"></div>`;
    document.getElementById("cal-course").onchange = (e) => {
      cal.course = e.target.value;
      cal.editingId = null;
      loadCalendar();
    };
  } else {
    if (!currentUser.course) {
      root.innerHTML = '<div class="placeholder">과정이 지정되지 않은 계정입니다. 담당자에게 문의해 주세요.</div>';
      return;
    }
    cal.course = currentUser.course;
    root.innerHTML = '<div id="cal-body"></div>';
  }
  loadCalendar();
}

async function loadPlans() {
  const last = new Date(cal.year, cal.month + 1, 0).getDate();
  const start = ymd(cal.year, cal.month, 1);
  const end = ymd(cal.year, cal.month, last);
  cal.plans = await api(`/plans/${encodeURIComponent(cal.course)}?start=${start}&end=${end}`);
}

async function loadCalendar() {
  try {
    cal.schedule = await api(`/schedule/${encodeURIComponent(cal.course)}`);
    await loadPlans();
    drawCalendar();
  } catch (err) {
    document.getElementById("cal-body").innerHTML = `<div class="placeholder">${escapeHtml(err.message)}</div>`;
  }
}

// 서버(schedule.py)의 수업일 규칙과 같다: 수업 기간 안의 평일(월~금) 중 휴강일·공휴일이 아닌 날
function dayType(dateStr, dow) {
  const { start_date: start, end_date: end, holidays } = cal.schedule;
  const holiday = holidays.find((h) => h.day === dateStr);
  if (holiday) return { type: "holiday", label: holiday.reason };
  if (dow === 0 || dow === 6) return { type: "weekend" }; // 토·일은 항상 쉬는 날
  if (start && end && dateStr >= start && dateStr <= end && dow >= 1 && dow <= 5) return { type: "class" };
  return { type: "off" };
}

function drawCalendar() {
  const body = document.getElementById("cal-body");
  const isManager = currentUser.role === "manager";
  const { start_date: start, end_date: end, holidays } = cal.schedule;

  const first = new Date(cal.year, cal.month, 1);
  const daysInMonth = new Date(cal.year, cal.month + 1, 0).getDate();
  const today = new Date();
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const planDays = new Set(cal.plans.map((p) => p.day));

  let cells = "";
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="day blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = ymd(cal.year, cal.month, d);
    const dow = new Date(cal.year, cal.month, d).getDay();
    const info = dayType(dateStr, dow);
    const title = info.label ? ` title="${escapeHtml(info.label)}"` : "";
    const tag = info.label ? `<span class="tag">${escapeHtml(info.label)}</span>` : "";
    const dot = planDays.has(dateStr) ? '<i class="pd" title="수업 계획 있음"></i>' : "";
    const dowClass = dow === 0 ? " sun" : dow === 6 ? " sat" : "";
    const sel = dateStr === cal.selected ? " selected" : "";
    cells += `<div class="day ${info.type}${dowClass}${dateStr === todayStr ? " today" : ""}${sel}" data-date="${dateStr}"${title}><span class="num">${d}</span>${dot}${tag}</div>`;
  }

  const termText = start && end ? `수업 기간 ${start} ~ ${end}` : "수업 기간이 아직 등록되지 않았습니다.";

  const holidayRows = holidays.length
    ? holidays
        .map(
          (h) => `
        <div class="row"${h.id ? ` data-id="${h.id}"` : ""}>
          <div class="who"><strong>${h.day} · ${escapeHtml(h.reason)}</strong>
            <span>${h.public ? "공휴일 (자동)" : h.course ? `${escapeHtml(h.course)}만` : "모든 과정"}</span></div>
          ${isManager && !h.public ? '<div class="actions"><button class="reject" type="button">삭제</button></div>' : ""}
        </div>`,
        )
        .join("")
    : '<div class="placeholder">휴강일이 없습니다.</div>';

  const manage = isManager
    ? `
    <div class="manage">
      <form id="term-form" class="panel">
        <h3>수업 기간</h3>
        <label>시작일<input name="start" type="date" required value="${start || ""}"></label>
        <label>종료일<input name="end" type="date" required value="${end || ""}"></label>
        <button class="primary" type="submit">기간 저장</button>
        <p id="term-msg" class="message" role="alert"></p>
      </form>
      <form id="holiday-form" class="panel">
        <h3>휴강일 추가</h3>
        <p class="hint">공휴일과 주말은 자동으로 쉬는 날이라 입력하지 않아도 됩니다. 자체 휴강만 추가하세요.</p>
        <label>날짜<input name="day" type="date" required></label>
        <label>사유<input name="reason" type="text" required placeholder="예: 워크숍, 자체 휴강"></label>
        <label>적용 범위
          <select name="scope">
            <option value="all">모든 과정</option>
            <option value="one">${escapeHtml(cal.course)}만</option>
          </select>
        </label>
        <button class="primary" type="submit">휴강일 추가</button>
        <p id="holiday-msg" class="message" role="alert"></p>
      </form>
    </div>`
    : "";

  body.innerHTML = `
    <div class="cal-card">
      <div class="cal-head">
        <button id="cal-prev" class="ghost" type="button" aria-label="이전 달">‹</button>
        <strong>${cal.year}년 ${cal.month + 1}월</strong>
        <button id="cal-next" class="ghost" type="button" aria-label="다음 달">›</button>
      </div>
      <p class="term">${termText}</p>
      <div class="cal-grid">
        ${WEEKDAYS.map((w, i) => `<div class="dow${i === 0 ? " sun" : ""}">${w}</div>`).join("")}
        ${cells}
      </div>
      <div class="legend">
        <span><i class="dot class"></i>수업일</span>
        <span><i class="dot holiday"></i>휴강·공휴일</span>
        <span><i class="dot weekend"></i>주말(휴무)</span>
        <span><i class="dot off"></i>수업 기간 밖</span>
        <span><i class="dot plan"></i>수업 계획 있음</span>
      </div>
    </div>
    <div id="plan-panel"></div>
    ${manage}
    <h3 class="section">휴강·공휴일 목록</h3>
    <div class="list">${holidayRows}</div>`;

  document.getElementById("cal-prev").onclick = () => shiftMonth(-1);
  document.getElementById("cal-next").onclick = () => shiftMonth(1);
  body.querySelectorAll(".day[data-date]").forEach((el) => {
    el.onclick = () => {
      cal.selected = el.dataset.date;
      cal.editingId = null;
      body.querySelectorAll(".day.selected").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      renderPlanPanel();
    };
  });
  renderPlanPanel();
  if (isManager) bindScheduleForms();
}

async function shiftMonth(delta) {
  const d = new Date(cal.year, cal.month + delta, 1);
  cal.year = d.getFullYear();
  cal.month = d.getMonth();
  cal.selected = null;
  cal.editingId = null;
  try {
    await loadPlans();
  } catch (err) {
    alert(err.message);
  }
  drawCalendar();
}

// ── 선택한 날짜의 수업 계획 ─────────────────────────────────
function renderPlanPanel() {
  const panel = document.getElementById("plan-panel");
  if (!panel) return;
  if (!cal.selected) {
    panel.innerHTML = '<div class="plan-panel"><p class="muted">날짜를 눌러 그날의 수업 계획을 확인하세요.</p></div>';
    return;
  }
  const [y, m, d] = cal.selected.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const isClassDay = dayType(cal.selected, dow).type === "class";
  const isInstructor = currentUser.role === "instructor";
  const plans = cal.plans.filter((p) => p.day === cal.selected);

  const rows = plans
    .map(
      (p) => `
      <div class="plan-row" data-id="${p.id}">
        <div class="time">${hhmm(p.start_time)}<span>~ ${hhmm(p.end_time)}</span></div>
        <div class="what">
          <strong>${escapeHtml(p.title)}</strong>
          ${p.note ? `<p>${escapeHtml(p.note)}</p>` : ""}
          <small>${escapeHtml(p.instructor_name)}</small>
        </div>
        ${isInstructor ? `<div class="actions"><button type="button" class="ghost" data-plan="edit">수정</button><button type="button" class="ghost danger" data-plan="delete">삭제</button></div>` : ""}
      </div>`,
    )
    .join("");

  let content;
  if (!isClassDay) {
    content = `<p class="muted">수업이 없는 날입니다 (주말·휴강일·수업 기간 밖).</p>`;
  } else if (!plans.length) {
    content = `<p class="muted">${isInstructor ? "아직 쓴 계획이 없습니다. 아래에서 시간대별로 추가해 주세요." : "아직 등록된 수업 계획이 없습니다."}</p>`;
  } else {
    content = rows;
  }

  const editing = plans.find((p) => p.id === cal.editingId);
  const form =
    isInstructor && isClassDay
      ? `
      <form id="plan-form" class="plan-form">
        <h4>${editing ? "계획 수정" : "계획 추가"}</h4>
        <div class="two">
          <label>시작<input name="start" type="time" required value="${editing ? hhmm(editing.start_time) : "09:10"}"></label>
          <label>종료<input name="end" type="time" required value="${editing ? hhmm(editing.end_time) : "10:00"}"></label>
        </div>
        <label>주제<input name="title" type="text" required maxlength="100" placeholder="예: 프롬프트 설계 기초" value="${editing ? escapeHtml(editing.title) : ""}"></label>
        <label>준비물·메모<textarea name="note" rows="2" maxlength="500" placeholder="학생이 미리 준비할 것, 참고 자료 등">${editing ? escapeHtml(editing.note) : ""}</textarea></label>
        <div class="req-actions">
          <button class="primary small" type="submit">${editing ? "저장" : "추가"}</button>
          ${editing ? '<button class="ghost" type="button" data-plan="cancel">수정 취소</button>' : ""}
        </div>
        <p id="plan-msg" class="message" role="alert"></p>
      </form>`
      : "";

  panel.innerHTML = `
    <section class="plan-panel">
      <h3>${m}월 ${d}일(${WEEKDAYS[dow]}) 수업 계획</h3>
      ${content}
      ${form}
    </section>`;
  bindPlanPanel(panel);
}

function bindPlanPanel(panel) {
  panel.onclick = async (e) => {
    const btn = e.target.closest("[data-plan]");
    if (!btn) return;
    const row = btn.closest(".plan-row");
    const act = btn.dataset.plan;
    if (act === "edit") {
      cal.editingId = Number(row.dataset.id);
      renderPlanPanel();
      document.getElementById("plan-form")?.scrollIntoView({ block: "nearest" });
    } else if (act === "cancel") {
      cal.editingId = null;
      renderPlanPanel();
    } else if (act === "delete") {
      const title = row.querySelector("strong").textContent;
      if (!confirm(`'${title}' 계획을 삭제할까요?`)) return;
      try {
        await api(`/plans/${row.dataset.id}`, { method: "DELETE" });
        await afterPlanChange();
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const form = document.getElementById("plan-form");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const msg = document.getElementById("plan-msg");
    const payload = {
      day: cal.selected,
      start_time: f.get("start"),
      end_time: f.get("end"),
      title: f.get("title"),
      note: f.get("note"),
    };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api(cal.editingId ? `/plans/${cal.editingId}` : "/plans", {
        method: cal.editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      cal.editingId = null;
      await afterPlanChange();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "message error";
      btn.disabled = false;
    }
  };
}

async function afterPlanChange() {
  await loadPlans();
  drawCalendar(); // 달력의 '계획 있음' 점도 같이 갱신
}

// ── 홈 화면: 오늘의 수업 계획 (학생·강사) ─────────────────────
async function initHomePlan() {
  const box = document.getElementById("home-plan");
  if (!box) return;
  if (!currentUser.course) {
    box.innerHTML = "";
    return;
  }
  const t = new Date();
  const today = ymd(t.getFullYear(), t.getMonth(), t.getDate());
  try {
    const plans = await api(`/plans/${encodeURIComponent(currentUser.course)}?start=${today}&end=${today}`);
    box.innerHTML = `
      <section class="plan-panel">
        <h3>오늘의 수업 계획 <small class="muted">${currentUser.course}</small></h3>
        ${
          plans.length
            ? plans
                .map(
                  (p) => `<div class="plan-row"><div class="time">${hhmm(p.start_time)}<span>~ ${hhmm(p.end_time)}</span></div>
                  <div class="what"><strong>${escapeHtml(p.title)}</strong>${p.note ? `<p>${escapeHtml(p.note)}</p>` : ""}</div></div>`,
                )
                .join("")
            : '<p class="muted">오늘 등록된 수업 계획이 없습니다.</p>'
        }
      </section>`;
  } catch {
    box.innerHTML = "";
  }
}

function bindScheduleForms() {
  const note = (id, text, type) => {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `message ${type}`;
  };

  document.getElementById("term-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      cal.schedule = await api(`/schedule/${encodeURIComponent(cal.course)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: f.get("start"), end_date: f.get("end") }),
      });
      drawCalendar();
      note("term-msg", "수업 기간을 저장했습니다.", "ok");
    } catch (err) {
      note("term-msg", err.message, "error");
    }
  };

  document.getElementById("holiday-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day: f.get("day"),
          reason: f.get("reason"),
          course: f.get("scope") === "one" ? cal.course : null,
        }),
      });
      await loadCalendar();
      note("holiday-msg", "휴강일을 추가했습니다.", "ok");
    } catch (err) {
      note("holiday-msg", err.message, "error");
    }
  };

  document.querySelectorAll("#cal-body .row .reject").forEach((btn) => {
    btn.onclick = async () => {
      const row = btn.closest(".row");
      const label = row.querySelector("strong").textContent;
      const common = row.querySelector("span").textContent === "모든 과정";
      const warn = common ? "\n(모든 과정에 적용된 휴강일이라 전체에서 삭제됩니다)" : "";
      if (!confirm(`${label}\n이 휴강일을 삭제할까요?${warn}`)) return;
      try {
        await api(`/holidays/${row.dataset.id}`, { method: "DELETE" });
        loadCalendar();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}
