// 오른쪽 아래 AI 도우미 채팅창. app.js 의 api 를 사용한다.
// 대화는 이 화면의 메모리에만 두고 저장하지 않는다 (새로고침·로그아웃하면 사라진다).
const CHAT_MAX_MESSAGES = 20; // 서버(agent_api.py)가 한 번에 받는 최대 개수와 같아야 한다
const CHAT_SUGGESTIONS = [
  "결혼하면 며칠 쉴 수 있어요?",
  "증빙서류는 언제까지 내요?",
  "조퇴나 외출은 어떻게 신청해요?",
  "질병으로 결석하면 어떤 서류가 필요해요?",
];

const chat = { messages: [], busy: false, root: null };

// ── 안전하게 표시하기 ──────────────────────────────────────
// AI 가 보낸 글은 innerHTML 에 넣지 않는다. createElement + textContent 만 쓰므로
// 글 안에 <script> 같은 것이 있어도 그냥 글자로 보일 뿐 실행되지 않는다.
function renderInline(parent, text) {
  // **굵게** 만 서식으로 바꾸고, 나머지는 글자 그대로 둔다
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      parent.append(strong);
    } else if (part) {
      parent.append(document.createTextNode(part));
    }
  });
}

function renderMarkdown(container, text) {
  let list = null; // 지금 이어 붙이고 있는 목록(ul/ol)
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const number = line.match(/^\s*\d+\.\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);

    if (bullet || number) {
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        container.append(list);
      }
      const li = document.createElement("li");
      renderInline(li, (bullet || number)[1]);
      list.append(li);
      continue;
    }
    list = null;
    if (!line.trim()) continue; // 빈 줄은 문단 사이 간격(CSS)으로 대신한다
    const p = document.createElement("p");
    if (heading) {
      const strong = document.createElement("strong");
      renderInline(strong, heading[1]);
      p.append(strong);
    } else {
      renderInline(p, line);
    }
    container.append(p);
  }
}

// ── 화면 만들기 ────────────────────────────────────────────
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const CHAT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>`;

function buildChatbot() {
  const root = el("div");
  root.id = "chatbot";
  // 아이콘·고정 문구만 innerHTML 로 넣는다 (사용자·AI 글은 아래에서 textContent 로만 넣는다)
  root.innerHTML = `
    <section id="chat-window" role="dialog" aria-label="AI 도우미" hidden>
      <header class="chat-head">
        <div><strong>AI 도우미</strong><span>출결 규정·앱 사용법 안내</span></div>
        <div class="chat-head-actions">
          <button type="button" id="chat-clear" title="새 대화">새 대화</button>
          <button type="button" id="chat-close" aria-label="닫기">${CLOSE_ICON}</button>
        </div>
      </header>
      <div id="chat-log" aria-live="polite"></div>
      <div id="chat-suggestions"></div>
      <p class="chat-notice">이름·병명·서류 내용 같은 개인정보는 입력하지 마세요. 안내가 틀릴 수 있으니 중요한 내용은 담당자에게 확인하세요.</p>
      <form id="chat-form">
        <textarea id="chat-input" rows="1" maxlength="1000" placeholder="궁금한 점을 입력하세요" aria-label="질문 입력"></textarea>
        <button type="submit" id="chat-send">보내기</button>
      </form>
    </section>
    <button type="button" id="chat-fab" aria-label="AI 도우미 열기" aria-expanded="false">${CHAT_ICON}</button>`;
  return root;
}

const $chat = (id) => document.getElementById(id);

function scrollLogToEnd() {
  const log = $chat("chat-log");
  log.scrollTop = log.scrollHeight;
}

function addBubble(kind, text) {
  const bubble = el("div", `chat-bubble ${kind}`);
  if (kind === "bot") renderMarkdown(bubble, text);
  else bubble.textContent = text; // 사용자 글·오류 문구는 글자 그대로
  $chat("chat-log").append(bubble);
  scrollLogToEnd();
  return bubble;
}

function renderChat() {
  const log = $chat("chat-log");
  log.replaceChildren();
  addBubble("bot", "안녕하세요! 출결 규정과 앱 사용법을 안내해 드려요. 궁금한 점을 물어보세요.");
  chat.messages.forEach((m) => addBubble(m.role === "user" ? "me" : "bot", m.content));

  const box = $chat("chat-suggestions");
  box.replaceChildren();
  if (!chat.messages.length) {
    CHAT_SUGGESTIONS.forEach((q) => {
      const b = el("button", "chat-chip", q);
      b.type = "button";
      b.onclick = () => sendChat(q);
      box.append(b);
    });
  }
}

function setBusy(busy) {
  chat.busy = busy;
  $chat("chat-input").disabled = busy;
  $chat("chat-send").disabled = busy;
  $chat("chat-send").textContent = busy ? "…" : "보내기";
}

function showTyping() {
  const bubble = el("div", "chat-bubble bot typing");
  bubble.id = "chat-typing";
  bubble.setAttribute("aria-label", "답변을 작성하는 중");
  bubble.append(el("span"), el("span"), el("span"));
  $chat("chat-log").append(bubble);
  scrollLogToEnd();
}

// ── 보내기 ─────────────────────────────────────────────────
async function sendChat(text) {
  text = text.trim();
  if (chat.busy || !text) return;

  if (chat.messages.length >= CHAT_MAX_MESSAGES) {
    addBubble("error", "대화가 길어졌어요. 위의 '새 대화'를 눌러 다시 시작해 주세요.");
    return;
  }

  chat.messages.push({ role: "user", content: text });
  $chat("chat-input").value = "";
  autoGrow();
  renderChat();
  setBusy(true);
  showTyping();

  try {
    // 서버는 대화를 기억하지 않으므로 지금까지의 대화 전체를 매번 보낸다
    const { reply } = await api("/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chat.messages }),
    });
    chat.messages.push({ role: "assistant", content: reply });
    $chat("chat-typing")?.remove();
    renderChat();
  } catch (err) {
    // 실패한 질문은 대화에서 빼고 입력창에 돌려놓는다: 대화 순서가 어긋나지 않고, 다시 보내기 쉽다
    chat.messages.pop();
    $chat("chat-typing")?.remove();
    renderChat();
    $chat("chat-input").value = text;
    autoGrow();
    addBubble("error", err.message || "답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    setBusy(false);
    $chat("chat-input").focus();
  }
}

// ── 열기·닫기, 입력창 ──────────────────────────────────────
function openChat(open) {
  const win = $chat("chat-window");
  const fab = $chat("chat-fab");
  win.hidden = !open;
  fab.setAttribute("aria-expanded", String(open));
  fab.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
  fab.setAttribute("aria-label", open ? "AI 도우미 닫기" : "AI 도우미 열기");
  chat.root.classList.toggle("open", open);
  if (open) {
    scrollLogToEnd();
    $chat("chat-input").focus();
  } else {
    fab.focus();
  }
}

function autoGrow() {
  const input = $chat("chat-input");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 96)}px`; // 최대 4줄 정도까지만 늘어난다
  input.style.overflowY = input.scrollHeight > 96 ? "auto" : "hidden"; // 넘칠 때만 스크롤바를 보여준다
}

function startChatbot() {
  stopChatbot();
  chat.root = buildChatbot();
  document.body.append(chat.root);
  chat.messages = [];
  setBusy(false);
  renderChat();

  $chat("chat-fab").onclick = () => openChat($chat("chat-window").hidden);
  $chat("chat-close").onclick = () => openChat(false);
  $chat("chat-clear").onclick = () => {
    if (chat.busy) return;
    chat.messages = [];
    renderChat();
    $chat("chat-input").focus();
  };
  $chat("chat-form").onsubmit = (e) => {
    e.preventDefault();
    sendChat($chat("chat-input").value);
  };
  const input = $chat("chat-input");
  input.oninput = autoGrow;
  input.onkeydown = (e) => {
    // 한글 입력 중(조합 중)의 엔터는 글자를 확정하는 것이라 보내기로 처리하면 안 된다
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendChat(input.value);
    }
  };
  $chat("chat-window").onkeydown = (e) => {
    if (e.key === "Escape") openChat(false);
  };
}

function stopChatbot() {
  if (chat.root) chat.root.remove(); // 로그아웃하면 창과 대화를 모두 지운다
  chat.root = null;
  chat.messages = [];
  chat.busy = false;
}
