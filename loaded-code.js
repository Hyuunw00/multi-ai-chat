// 확장을 다시 로드해야만 갱신되는 파일들의 현재(디스크) 내용.
// background.js가 로드 시점의 내용을 저장하고, page.js가 열릴 때마다 비교한다.
export async function readCode() {
  const files = ['manifest.json', 'background.js', 'content.js'];
  const texts = await Promise.all(files.map(async (file) => (await fetch(chrome.runtime.getURL(file))).text()));
  return texts.join('\n');
}
