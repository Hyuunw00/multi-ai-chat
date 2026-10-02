// 사이트 화면이 바뀌어 전송이나 답변 표시가 안 되면 여기 선택자를 고친다.
// send(전송 버튼)가 없거나 못 찾으면 입력창에서 Enter 키로 전송한다.
// busy는 답변을 생성하는 동안에만 화면에 있는 요소다.
const SITES = {
  'chatgpt.com': {
    input: '#prompt-textarea',
    send: 'button[data-testid="send-button"]',
    answer: '[data-message-author-role="assistant"]',
    busy: 'button[data-testid="stop-button"]',
  },
  'gemini.google.com': {
    input: 'rich-textarea .ql-editor',
    answer: 'model-response message-content',
    busy: 'mat-icon[fonticon="stop"]',
  },
  'claude.ai': {
    input: 'div.ProseMirror[contenteditable="true"]',
    send: 'button[aria-label="Send message"]',
    answer: '[data-is-streaming]',
    busy: '[data-is-streaming="true"]',
  },
};

const site = SITES[location.hostname];
const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inputText = (input) => (input?.value ?? input?.innerText ?? '').trim();
const currentInput = () => document.querySelector(site.input);

// 전송 시점의 답변 개수. 이보다 늘어난 뒤의 마지막 답변만 새 답변으로 보고한다.
let answersBeforeSend = Infinity;
let reportedHtml = '';
let reportTimer = null;
let doneTimer = null;
// 지금 받는 답변을 확장 페이지의 어느 칸에 표시할지: 'answer'(사이트별 칸) 또는 'synthesis'(종합 칸)
let answerSlot = 'answer';

// 확장 페이지에 직접 삽입된 프레임에서만 동작한다. 일반 탭에서는 아무것도 하지 않는다.
if (site && location.ancestorOrigins[0] === extensionOrigin) {
  chrome.runtime.onMessage.addListener(({ prompt, targets, slot }) => {
    // 메시지는 탭의 모든 프레임에 오므로, targets에 들어 있는 사이트만 처리한다.
    if (!targets.includes(location.hostname)) return;
    clearTimeout(doneTimer);
    answerSlot = slot;
    answersBeforeSend = document.querySelectorAll(site.answer).length;
    reportedHtml = '';
    send(prompt);
  });

  // 답변이 스트리밍되는 동안 0.3초 간격으로 확장 페이지에 전달한다.
  new MutationObserver(() => {
    reportTimer ??= setTimeout(() => {
      reportTimer = null;
      reportAnswer();
    }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // 새 대화로 다시 불러온 경우, 확장 페이지가 이 신호를 받고 대기 중인 프롬프트를 보낸다.
  chrome.runtime.sendMessage({ site: location.hostname, ready: true });
  reportUsable();
}

// 입력창이 있는지로, 이 사이트에 질문을 보낼 수 있는 상태인지 알린다.
// 로그인이 필요한 사이트는 로그아웃 상태에서 입력창이 나오지 않는다.
async function reportUsable() {
  for (let attempt = 0; attempt < 20 && !currentInput(); attempt++) await sleep(500);
  chrome.runtime.sendMessage({ site: location.hostname, usable: !!currentInput() });
}

function reportAnswer() {
  const answers = document.querySelectorAll(site.answer);
  if (answers.length <= answersBeforeSend) return;
  const answer = answers[answers.length - 1].cloneNode(true);
  // Gemini는 표와 코드블록을 커스텀 요소로 감싼다. 확장 페이지의 setHTML이 커스텀 요소를
  // 내용째 제거하므로 div로 바꿔서 보낸다.
  for (const element of answer.querySelectorAll('*')) {
    if (!element.localName.includes('-')) continue;
    const div = document.createElement('div');
    div.append(...element.childNodes);
    element.replaceWith(div);
  }
  const html = answer.innerHTML;
  if (html === reportedHtml) return;
  reportedHtml = html;
  chrome.runtime.sendMessage({ site: location.hostname, html, slot: answerSlot });
  // 답변이 3초 동안 바뀌지 않고 생성 중 표시도 없으면 끝난 것으로 본다.
  clearTimeout(doneTimer);
  doneTimer = setTimeout(reportDone, 3000);
}

function reportDone() {
  if (document.querySelector(site.busy)) {
    doneTimer = setTimeout(reportDone, 1000);
    return;
  }
  chrome.runtime.sendMessage({ site: location.hostname, done: true, slot: answerSlot });
}

async function send(prompt) {
  // 1) 입력: 사이트를 막 불러온 직후에는 입력창이 없거나 아직 동작하지 않을 수 있으므로,
  //    글이 실제로 들어갈 때까지 다시 시도한다.
  for (let attempt = 0; attempt < 30 && !inputText(currentInput()); attempt++) {
    if (currentInput()) insert(currentInput(), prompt);
    await sleep(300); // 입력이 반영된 뒤에야 전송 버튼이 활성화된다.
  }
  if (!inputText(currentInput())) {
    console.warn('[Multi AI Chat] 입력하지 못함:', site.input);
    chrome.runtime.sendMessage({ site: location.hostname, failed: true, slot: answerSlot });
    return;
  }

  // 2) 전송: 입력창이 비워지면 전송된 것이다. 3초 안에 비워지지 않으면 다시 누른다.
  //    전송된 뒤에는 다시 입력하거나 누르지 않는다 (답변 생성 중에 누르면 중복 전송되거나 생성이 멈춘다).
  for (let attempt = 0; attempt < 5; attempt++) {
    const button = site.send && document.querySelector(site.send);
    if (button) {
      button.click();
    } else {
      currentInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    }
    for (let check = 0; check < 10; check++) {
      await sleep(300);
      if (!inputText(currentInput())) return;
    }
  }
  console.warn('[Multi AI Chat] 전송하지 못함:', site.send ?? 'Enter');
  chrome.runtime.sendMessage({ site: location.hostname, failed: true, slot: answerSlot });
}

function insert(input, prompt) {
  input.focus();
  const data = new DataTransfer();
  data.setData('text/plain', prompt);
  const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  // 에디터가 붙여넣기를 처리하지 않았으면 직접 입력한다.
  if (input.dispatchEvent(paste)) document.execCommand('insertText', false, prompt);
}
