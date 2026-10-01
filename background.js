import { readCode } from './loaded-code.js';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'index.html' });
});

// 확장이 (다시) 로드될 때 실행된다. page.js가 코드 변경을 감지해 스스로 다시 로드한 경우
// (reopen)에는 닫힌 페이지를 다시 열어준다.
chrome.runtime.onInstalled.addListener(async () => {
  const { reopen } = await chrome.storage.local.get('reopen');
  await chrome.storage.local.set({ loadedCode: await readCode(), reopen: false });
  if (reopen) chrome.tabs.create({ url: 'index.html' });
});
