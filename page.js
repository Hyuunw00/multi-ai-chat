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
// hostname → { name, color, url, iframe, column, body, step, chip }.
// body는 그 사이트의 답변이 들어가는 요소, column은 body를 감싼 칸.
const columns = {};
// 새 대화로 다시 불러오는 중인 사이트에 보낼 프롬프트. 사이트가 준비됐다고 알려오면 보낸다.
const pendingPrompts = {};

// 방식: 'synthesis'(동시에 묻고 종합) 또는 'chain'(차례로 검증하는 교차검증)
let mode = localStorage.getItem('mode') ?? 'synthesis';
// 사용할 AI의 hostname 목록. 교차검증은 이 순서대로 진행한다.
let selected = JSON.parse(localStorage.getItem('selected')) ?? SITES.map(({ url }) => new URL(url).hostname);
// 진행 중인 교차검증. step은 지금 답변을 받고 있는 selected의 인덱스.
let chain = null;

// targets에 든 사이트의 content.js가 프롬프트를 입력하고 전송한다.
function sendTo(targets, prompt, slot) {
  chrome.tabs.sendMessage(tab.id, { prompt, targets, slot });
}

// 로그인 페이지는 iframe 안에서 열리지 않으므로 사이트를 새 탭으로 연다.
function openForLogin(urls) {
  for (const url of urls) chrome.tabs.create({ url });
  // 로그인하고 이 탭으로 돌아오면 iframe에 로그인 상태가 반영되도록 다시 불러온다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') location.reload();
  });
}

// 사이트에 질문을 보낼 수 없을 때(대개 로그아웃 상태) 칸에 이유와 로그인 버튼을 보여준다.
function showBlocked(body, site) {
  const { name, url } = columns[site];
  const message = document.createElement('p');
  message.textContent = `${name}에 질문을 보낼 수 없습니다. 로그인이 필요할 수 있습니다.`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost';
  button.textContent = `${name} 열어서 로그인`;
  button.addEventListener('click', () => openForLogin([url]));
  body.replaceChildren(message, button);
  body.parentElement.dataset.state = 'blocked';
}

function enableCopy(copy, body) {
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(body.innerText);
    copy.textContent = '복사됨';
    setTimeout(() => { copy.textContent = '복사'; }, 1500);
  });
}

for (const { name, url, color } of SITES) {
  const hostname = new URL(url).hostname;

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.allow = 'clipboard-write';
  frames.append(iframe);

  // data-state: empty(전송 전) → queued(교차검증에서 앞 단계 대기) → waiting(답변 대기) → answer(답변 표시)
  // blocked는 사이트에 질문을 보낼 수 없는 상태.
  const column = document.createElement('section');
  column.className = 'column';
  column.dataset.state = 'empty';
  column.style.setProperty('--brand', color);
  const header = document.createElement('header');
  const title = document.createElement('h2');
  const step = document.createElement('span');
  step.className = 'step';
  title.append(name, step);
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

  // 사용할 AI를 켜고 끄는 버튼. 끈 AI를 다시 켜면 순서의 맨 뒤로 간다.
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.style.setProperty('--brand', color);
  const order = document.createElement('span');
  order.className = 'order';
  chip.append(name, order);
  chip.addEventListener('click', () => {
    if (!selected.includes(hostname)) selected.push(hostname);
    else if (selected.length > 1) selected = selected.filter((other) => other !== hostname);
    localStorage.setItem('selected', JSON.stringify(selected));
    applySettings();
  });
  document.getElementById('ai-chips').append(chip);

  columns[hostname] = { name, color, url, iframe, column, body, step, chip };
}

const judge = document.getElementById('judge');
judge.addEventListener('change', () => localStorage.setItem('judge', judge.value));

const modeButtons = {
  synthesis: document.getElementById('mode-synthesis'),
  chain: document.getElementById('mode-chain'),
};
for (const [value, button] of Object.entries(modeButtons)) {
  button.addEventListener('click', () => {
    mode = value;
    localStorage.setItem('mode', mode);
    applySettings();
  });
}

// 방식과 AI 선택을 화면에 반영한다. 설정이 바뀌면 진행 중이던 교차검증은 멈춘다.
function applySettings() {
  chain = null;
  document.body.dataset.mode = mode;
  for (const [value, button] of Object.entries(modeButtons)) button.setAttribute('aria-pressed', value === mode);

  for (const [hostname, { iframe, column, step, chip }] of Object.entries(columns)) {
    const index = selected.indexOf(hostname);
    const isLast = index === selected.length - 1;
    chip.setAttribute('aria-pressed', index !== -1);
    chip.querySelector('.order').textContent = index === -1 ? '' : index + 1;
    // 칸과 사이트 화면은 선택된 것만, 선택한 순서대로 보여준다.
    for (const element of [chip, column, iframe]) element.style.order = index === -1 ? SITES.length : index;
    column.hidden = iframe.hidden = index === -1;
    column.classList.toggle('final', isLast && selected.length > 1);
    step.textContent = isLast && selected.length > 1 ? '최종' : `${index + 1}단계`;
  }

  // 종합 담당은 선택된 AI 중에서 고른다. 기본값은 Gemini.
  judge.replaceChildren(...selected.map((hostname) => new Option(columns[hostname].name, hostname)));
  const preferred = localStorage.getItem('judge') ?? 'gemini.google.com';
  judge.value = selected.includes(preferred) ? preferred : selected[0];
}
applySettings();

const answeredColumns = () => selected.map((hostname) => columns[hostname]).filter(({ column }) => column.dataset.state === 'answer');

const synthesis = document.getElementById('synthesis');
const synthesisBody = synthesis.querySelector('.answer');
const synthesize = document.getElementById('synthesize');
enableCopy(synthesis.querySelector('.copy'), synthesisBody);

// content.js가 보내오는 것: 준비 신호(ready), 질문을 보낼 수 있는지(usable), 전송 실패(failed),
// 스트리밍 중인 답변(html), 답변 완료 신호(done). slot이 'synthesis'면 종합 칸에 표시한다.
chrome.runtime.onMessage.addListener(({ site, ready, usable, failed, done, html, slot }, sender) => {
  if (sender.tab?.id !== tab.id) return;
  if (usable !== undefined) {
    const { column, body } = columns[site];
    if (!usable && column.dataset.state !== 'answer') showBlocked(body, site);
    if (usable && column.dataset.state === 'blocked') {
      body.replaceChildren();
      column.dataset.state = 'empty';
    }
    return;
  }
  if (failed) {
    showBlocked(slot === 'synthesis' ? synthesisBody : columns[site].body, site);
    return;
  }
  if (ready) {
    if (pendingPrompts[site]) sendTo([site], pendingPrompts[site], 'answer');
    delete pendingPrompts[site];
    return;
  }
  if (done) {
    // 교차검증: 지금 단계의 답변이 끝나면 다음 AI에게 넘긴다.
    if (chain && slot === 'answer' && site === selected[chain.step]) advanceChain();
    return;
  }
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

// 질문마다 새 대화로 시작할지. 꺼져 있으면 각 사이트의 같은 대화에 이어서 묻는다.
const newSession = document.getElementById('new-session');
newSession.checked = localStorage.getItem('newSession') === 'true';
newSession.addEventListener('change', () => localStorage.setItem('newSession', newSession.checked));
// 이 화면에서 이미 질문을 보냈는지. 첫 질문은 사이트가 이미 새 대화 상태라 다시 불러올 필요가 없다.
let hasConversation = false;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  question.textContent = prompt;
  document.getElementById('question-bar').hidden = false;
  synthesis.hidden = true;
  synthesize.disabled = true;

  // 종합은 선택한 AI 모두에게, 교차검증은 첫 번째 AI에게만 먼저 보낸다.
  chain = mode === 'chain' ? { step: 0 } : null;
  const targets = chain ? [selected[0]] : selected;
  for (const hostname of selected) {
    columns[hostname].body.replaceChildren();
    columns[hostname].column.dataset.state = targets.includes(hostname) ? 'waiting' : 'queued';
  }

  for (const hostname of Object.keys(pendingPrompts)) delete pendingPrompts[hostname];
  if (newSession.checked && hasConversation) {
    // 각 사이트를 처음 주소로 다시 불러와 새 대화에서 시작한다.
    for (const hostname of selected) columns[hostname].iframe.src = columns[hostname].url;
    for (const hostname of targets) pendingPrompts[hostname] = prompt;
  } else {
    sendTo(targets, prompt, 'answer');
  }
  hasConversation = true;
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

function advanceChain() {
  const previous = columns[selected[chain.step]];
  chain.step += 1;
  const hostname = selected[chain.step];
  if (!hostname) {
    chain = null;
    return;
  }
  columns[hostname].column.dataset.state = 'waiting';
  sendTo([hostname], chainPrompt(previous, chain.step === selected.length - 1), 'answer');
}

function chainPrompt(previous, isLast) {
  return [
    `아래는 같은 질문에 대한 ${previous.name}의 답변이다. 이 답변을 검증하고 보완해줘.`,
    `[질문]\n${question.textContent}`,
    `[${previous.name}의 답변]\n${previous.body.innerText.trim()}`,
    [
      '아래 형식 그대로, 군더더기 없이 한국어로 답해줘.',
      `## ${isLast ? '최종 답변' : '보완한 답변'}`,
      '아래의 검증을 반영해, 질문에 대한 완성된 답변을 처음부터 다시 작성.',
      '## 바로잡은 점',
      `${previous.name}의 답변에서 틀렸거나 근거가 약하거나 빠져서 고친 부분을 불릿으로. 없으면 "없음".`,
    ].join('\n'),
  ].join('\n\n');
}

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
  sendTo([judge.value], synthesisPrompt(sources), 'synthesis');
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

document.getElementById('login').addEventListener('click', () => openForLogin(SITES.map(({ url }) => url)));
