// 알림 종(bell): 안 읽은 알림 개수 표시, 눌러서 목록 보기, 읽음 처리. app.js 의 api, escapeHtml 을 사용한다.
const NOTIFY_POLL_MS = 30000; // 30초마다 새 알림이 있는지 확인
let notifyTimer = null;

// 서버는 UTC 시각을 보낸다. 시간대 표시가 없으면 UTC 로 보고 브라우저 시간으로 바꾼다.
function parseUtc(value) {
  const s = String(value);
  return new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
}

function timeAgo(value) {
  const sec = Math.max(0, Math.floor((Date.now() - parseUtc(value).getTime()) / 1000));
  if (sec < 60) return "방금 전";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  const days = Math.floor(sec / 86400);
  return days < 7 ? `${days}일 전` : parseUtc(value).toLocaleDateString("ko-KR");
}

function setBadge(count) {
  const badge = document.getElementById("bell-badge");
  if (!badge) return;
  badge.hidden = count <= 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}

async function refreshUnread() {
  try {
    const { unread } = await api("/notifications/unread-count");
    setBadge(unread);
  } catch {
    /* 일시적인 오류는 무시하고 다음 확인 때 다시 시도한다 */
  }
}

function closePanel() {
  const panel = document.getElementById("notif-panel");
  if (panel) panel.hidden = true;
}

async function openPanel() {
  const panel = document.getElementById("notif-panel");
  panel.hidden = false;
  panel.innerHTML = '<div class="notif-empty">불러오는 중...</div>';
  try {
    const { unread, items } = await api("/notifications");
    setBadge(unread);
    panel.innerHTML = `
      <div class="notif-head">
        <strong>알림</strong>
        <button type="button" class="link" data-n="read-all" ${unread ? "" : "disabled"}>모두 읽음</button>
      </div>
      <div class="notif-list">
        ${
          items.length
            ? items
                .map(
                  (n) => `
          <button type="button" class="notif-item${n.read ? "" : " unread"}" data-n="open" data-id="${n.id}" data-link="${escapeHtml(n.link)}">
            <span class="dot"></span>
            <span class="txt">
              <strong>${escapeHtml(n.title)}</strong>
              ${n.body ? `<span class="body">${escapeHtml(n.body)}</span>` : ""}
              <small>${timeAgo(n.created_at)}</small>
            </span>
          </button>`,
                )
                .join("")
            : '<div class="notif-empty">아직 알림이 없습니다.</div>'
        }
      </div>`;
  } catch (err) {
    panel.innerHTML = `<div class="notif-empty">${escapeHtml(err.message)}</div>`;
  }
}

function startNotifications() {
  stopNotifications();
  const bell = document.getElementById("bell");
  const panel = document.getElementById("notif-panel");

  bell.onclick = (e) => {
    e.stopPropagation();
    if (panel.hidden) openPanel();
    else closePanel();
  };
  panel.onclick = async (e) => {
    e.stopPropagation();
    const el = e.target.closest("[data-n]");
    if (!el) return;
    if (el.dataset.n === "read-all") {
      await api("/notifications/read-all", { method: "POST" });
      openPanel();
    } else if (el.dataset.n === "open") {
      try {
        const { unread } = await api(`/notifications/${el.dataset.id}/read`, { method: "POST" });
        setBadge(unread);
      } catch {
        /* 읽음 처리에 실패해도 화면 이동은 한다 */
      }
      closePanel();
      const link = el.dataset.link;
      if (link) {
        if (location.hash === link) window.dispatchEvent(new HashChangeEvent("hashchange")); // 같은 화면이면 새로 그린다
        else location.hash = link;
      }
    }
  };
  document.addEventListener("click", closePanel); // 바깥을 누르면 닫기

  refreshUnread();
  notifyTimer = setInterval(refreshUnread, NOTIFY_POLL_MS);
}

function stopNotifications() {
  if (notifyTimer) clearInterval(notifyTimer);
  notifyTimer = null;
  document.removeEventListener("click", closePanel);
  closePanel();
  setBadge(0);
}
