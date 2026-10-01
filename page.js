import { readCode } from './loaded-code.js';

// content.js 등은 탭 새로고침으로는 갱신되지 않는다. 로드된 코드가 디스크와 다르면
// 확장을 다시 로드한다. 그러면 이 탭은 닫히고 background.js가 다시 열어준다.
// storage 권한이 없으면 이 검사가 생기기 전의 확장이 로드된 상태이므로 바로 다시 로드한다.
if (!chrome.storage) chrome.runtime.reload();
const { loadedCode } = await chrome.storage.local.get('loadedCode');
if (loadedCode !== undefined && loadedCode !== await readCode()) {
  await chrome.storage.local.set({ reopen: true });
  chrome.runtime.reload();
}

const SITES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/', color: '#10a37f' },
  { name: 'Gemini', url: 'https://gemini.google.com/app', color: '#4285f4' },
  { name: 'Claude', url: 'https://claude.ai/new', color: '#d97757' },
];

const tab = await chrome.tabs.getCurrent();

// 세 사이트는 iframe 삽입을 헤더로 막는다. 이 탭 안의 iframe에 한해서만 그 헤더를 제거한다.
await chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [tab.id],
  addRules: [{
    id: tab.id,
    condition: {
      tabIds: [tab.id],
      resourceTypes: ['sub_frame'],
      requestDomains: SITES.map(({ url }) => new URL(url).hostname),
    },
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
      ],
    },
  }],
});

const frames = document.getElementById('frames');
const answers = document.getElementById('answers');
// hostname → { name, color, body }. body는 그 사이트의 답변이 들어가는 요소.
const columns = {};

function enableCopy(copy, body) {
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(body.innerText);
    copy.textContent = '복사됨';
    setTimeout(() => { copy.textContent = '복사'; }, 1500);
  });
}

for (const { name, url, color } of SITES) {
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.allow = 'clipboard-write';
  frames.append(iframe);

  // data-state: empty(전송 전) → waiting(답변 대기) → answer(답변 표시)
  const column = document.createElement('section');
  column.className = 'column';
  column.dataset.state = 'empty';
  column.style.setProperty('--brand', color);
  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = name;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy';
  copy.textContent = '복사';
  const body = document.createElement('div');
  body.className = 'answer';
  enableCopy(copy, body);
  header.append(title, copy);
  column.append(header, body);
  document.getElementById('columns').append(column);
  columns[new URL(url).hostname] = { name, color, body };
}

const answeredColumns = () => Object.values(columns).filter(({ body }) => body.parentElement.dataset.state === 'answer');

const synthesis = document.getElementById('synthesis');
const synthesisBody = synthesis.querySelector('.answer');
const synthesize = document.getElementById('synthesize');
enableCopy(synthesis.querySelector('.copy'), synthesisBody);

// content.js가 스트리밍 중인 답변 HTML을 보내온다. slot이 'synthesis'면 종합 칸에 표시한다.
chrome.runtime.onMessage.addListener(({ site, html, slot }, sender) => {
  if (sender.tab?.id !== tab.id) return;
  const body = slot === 'synthesis' ? synthesisBody : columns[site].body;
  body.parentElement.dataset.state = 'answer';
  // setHTML은 스크립트, 이벤트 핸들러, class/style 속성을 제거하고 넣는다.
  body.setHTML(html);
  // 비교할 답변이 둘 이상 있어야 종합할 수 있다.
  synthesize.disabled = answeredColumns().length < 2;
});

const form = document.getElementById('form');
const promptInput = document.getElementById('prompt');
const question = document.getElementById('question');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  question.textContent = prompt;
  document.getElementById('question-bar').hidden = false;
  synthesis.hidden = true;
  synthesize.disabled = true;
  for (const { body } of Object.values(columns)) {
    body.replaceChildren();
    body.parentElement.dataset.state = 'waiting';
  }
  // 이 탭의 모든 프레임에 있는 content.js로 전달된다.
  chrome.tabs.sendMessage(tab.id, { prompt, slot: 'answer' });
  promptInput.value = '';
  promptInput.dispatchEvent(new Event('input'));
  // content.js가 각 사이트 입력창에 포커스를 주므로, 전송이 끝난 뒤 다시 가져온다.
  setTimeout(() => promptInput.focus(), 1000);
});

promptInput.addEventListener('keydown', (event) => {
  // isComposing: 한글 조합 중의 Enter는 전송하지 않는다.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

promptInput.addEventListener('input', () => {
  document.getElementById('send').disabled = !promptInput.value.trim();
  // 내용에 맞춰 입력창 높이를 늘린다. 최대 높이는 CSS의 max-height.
  promptInput.style.height = 'auto';
  promptInput.style.height = `${promptInput.scrollHeight}px`;
});

// 종합 담당 AI. 한 번 고르면 다음에도 유지한다.
const judge = document.getElementById('judge');
for (const [hostname, { name }] of Object.entries(columns)) judge.add(new Option(name, hostname));
judge.value = localStorage.getItem('judge') ?? 'gemini.google.com';
judge.addEventListener('change', () => localStorage.setItem('judge', judge.value));

function synthesisPrompt(sources) {
  const names = sources.map(({ name }) => name).join(', ');
  return [
    `아래는 같은 질문에 대한 ${names}의 답변이다. 이 답변들을 교차 검증해서 하나로 종합해줘.`,
    `[질문]\n${question.textContent}`,
    ...sources.map(({ name, body }) => `[${name}의 답변]\n${body.innerText.trim()}`),
    [
      '아래 형식 그대로, 군더더기 없이 한국어로 답해줘.',
      '## 결론',
      '질문에 대한 가장 타당한 답을 2~4문장으로.',
      '## 공통된 내용',
      '답변들이 일치하는 핵심을 불릿으로.',
      '## 서로 다른 내용',
      `답변이 엇갈리는 지점을 표로 정리 (열: 항목, ${names}). 표 아래에 어느 쪽이 더 타당한지와 그 이유를 한 줄씩.`,
      '## 확인이 필요한 내용',
      '사실 여부가 의심되거나 답변끼리 모순되는 내용. 없으면 "없음".',
    ].join('\n'),
  ].join('\n\n');
}

synthesize.addEventListener('click', () => {
  const sources = answeredColumns();
  // 어떤 답변들을 종합했는지 종합 칸 머리에 표시한다.
  document.getElementById('sources').replaceChildren(...sources.map(({ name, color }) => {
    const chip = document.createElement('span');
    chip.className = 'source';
    chip.style.setProperty('--brand', color);
    chip.textContent = name;
    return chip;
  }));
  document.getElementById('judge-name').textContent = `${columns[judge.value].name}가 정리`;
  synthesisBody.replaceChildren();
  synthesis.dataset.state = 'waiting';
  synthesis.hidden = false;
  chrome.tabs.sendMessage(tab.id, { prompt: synthesisPrompt(sources), target: judge.value, slot: 'synthesis' });
});

const viewButtons = {
  answers: document.getElementById('view-answers'),
  sites: document.getElementById('view-sites'),
};
for (const [view, button] of Object.entries(viewButtons)) {
  button.addEventListener('click', () => {
    answers.hidden = view !== 'answers';
    for (const [name, other] of Object.entries(viewButtons)) other.setAttribute('aria-pressed', name === view);
  });
}

// 로그인 페이지는 iframe 안에서 열리지 않으므로 세 사이트를 새 탭으로 연다.
document.getElementById('login').addEventListener('click', () => {
  for (const { url } of SITES) chrome.tabs.create({ url });
  // 로그인하고 이 탭으로 돌아오면 iframe에 로그인 상태가 반영되도록 다시 불러온다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') location.reload();
  });
});
