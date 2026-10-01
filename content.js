// 사이트 화면이 바뀌어 전송이나 답변 표시가 안 되면 여기 선택자를 고친다.
const SITES = {
  'chatgpt.com': {
    input: '#prompt-textarea',
    send: 'button[data-testid="send-button"]',
    answer: '[data-message-author-role="assistant"]',
  },
  'gemini.google.com': {
    input: 'rich-textarea .ql-editor',
    send: 'button.send-button',
    answer: 'model-response message-content',
  },
  'claude.ai': {
    input: 'div.ProseMirror[contenteditable="true"]',
    send: 'button[aria-label="Send message"]',
    answer: '[data-is-streaming]',
  },
};

const site = SITES[location.hostname];
const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

// 전송 시점의 답변 개수. 이보다 늘어난 뒤의 마지막 답변만 새 답변으로 보고한다.
let answersBeforeSend = Infinity;
let reportedHtml = '';
let reportTimer = null;
// 지금 받는 답변을 확장 페이지의 어느 칸에 표시할지: 'answer'(사이트별 칸) 또는 'synthesis'(종합 칸)
let answerSlot = 'answer';

// 확장 페이지에 직접 삽입된 프레임에서만 동작한다. 일반 탭에서는 아무것도 하지 않는다.
if (site && location.ancestorOrigins[0] === extensionOrigin) {
  chrome.runtime.onMessage.addListener(({ prompt, target, slot }) => {
    // 종합 요청은 target으로 지정된 사이트 한 곳에만 보낸다.
    if (target && target !== location.hostname) return;
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
}

async function send(prompt) {
  const input = document.querySelector(site.input);
  if (!input) {
    console.warn('[Multi AI Chat] 입력창을 찾지 못함:', site.input);
    return;
  }
  input.focus();

  const data = new DataTransfer();
  data.setData('text/plain', prompt);
  const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  // 에디터가 붙여넣기를 처리하지 않았으면 직접 입력한다.
  if (input.dispatchEvent(paste)) document.execCommand('insertText', false, prompt);

  // 입력이 반영된 뒤에야 전송 버튼이 활성화된다.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const button = document.querySelector(site.send);
  if (button) {
    button.click();
  } else {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  }
}
