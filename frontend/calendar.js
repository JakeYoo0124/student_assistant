// 수업 일정(달력) 화면. app.js 의 api, currentUser, escapeHtml 을 사용한다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const cal = { course: null, year: 0, month: 0, schedule: null };

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

async function initCalendarPage() {
  const root = document.getElementById("cal-root");
  const now = new Date();
  cal.year = now.getFullYear();
  cal.month = now.getMonth();

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

async function loadCalendar() {
  try {
    cal.schedule = await api(`/schedule/${encodeURIComponent(cal.course)}`);
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
  if (dow === 0 || dow === 6) return { type: "weekend" };  // 토·일은 항상 쉬는 날
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

  let cells = "";
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="day blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = ymd(cal.year, cal.month, d);
    const dow = new Date(cal.year, cal.month, d).getDay();
    const info = dayType(dateStr, dow);
    const title = info.label ? ` title="${escapeHtml(info.label)}"` : "";
    const tag = info.label ? `<span class="tag">${escapeHtml(info.label)}</span>` : "";
    const dowClass = dow === 0 ? " sun" : dow === 6 ? " sat" : "";
    cells += `<div class="day ${info.type}${dowClass}${dateStr === todayStr ? " today" : ""}"${title}><span class="num">${d}</span>${tag}</div>`;
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
      </div>
    </div>
    ${manage}
    <h3 class="section">휴강·공휴일 목록</h3>
    <div class="list">${holidayRows}</div>`;

  document.getElementById("cal-prev").onclick = () => shiftMonth(-1);
  document.getElementById("cal-next").onclick = () => shiftMonth(1);
  if (isManager) bindScheduleForms();
}

function shiftMonth(delta) {
  const d = new Date(cal.year, cal.month + delta, 1);
  cal.year = d.getFullYear();
  cal.month = d.getMonth();
  drawCalendar();
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
