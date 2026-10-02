# Chrome 웹 스토어 제출 자료

개발자 대시보드(https://chrome.google.com/webstore/devconsole)의 각 입력란에 붙여 넣을 내용.

## 패키지

제출용 압축 파일 만들기 (저장소 루트에서):

```bash
mkdir -p dist && rm -f dist/multi-ai-chat.zip && zip -r dist/multi-ai-chat.zip manifest.json background.js content.js index.html loaded-code.js page.js icons
```

업데이트를 올릴 때는 `manifest.json`의 `version`을 먼저 올린다. 같은 버전은 다시 올릴 수 없다.

## 스토어 등록정보

- **이름**: Multi AI Chat (manifest에서 자동 입력)
- **요약**: manifest의 description에서 자동 입력
- **카테고리**: 도구 (Tools)
- **언어**: 한국어
- **스토어 아이콘**: `icons/icon128.png`
- **스크린샷**: 1280x800, 최소 1장. 실제 사용 화면을 직접 캡처해야 한다.
- **작은 프로모션 타일**: `store/promo-440x280.png`

### 설명

```
프롬프트 하나를 ChatGPT, Gemini, Claude에 보내고, 답변을 한 화면에서 비교합니다.

API 키가 필요 없습니다. 크롬에 로그인해 둔 각 서비스의 계정(무료 플랜 포함)을 그대로 사용합니다.

■ 종합
선택한 AI에게 동시에 묻고 답변을 나란히 봅니다. "답변 종합하기"를 누르면 한 AI가 답변들을 비교해 결론, 공통된 내용, 서로 다른 내용, 확인이 필요한 내용으로 정리합니다.

■ 교차검증
첫 번째 AI의 답변을 다음 AI가 차례로 검증하고 보완해 최종 답변을 만듭니다. 순서는 직접 정할 수 있습니다.

■ 그 밖에
· 사용할 AI를 켜고 끌 수 있습니다.
· 질문마다 새 대화로 시작할 수 있습니다.
· 답변을 복사할 수 있고, 각 사이트의 원래 화면으로 전환할 수 있습니다.
· 다크 모드를 지원합니다.

■ 사용 전에
· ChatGPT, Gemini, Claude에 각각 로그인해 두어야 합니다.
· 각 서비스의 사용 한도는 그대로 적용됩니다.
· 각 사이트의 화면 구조가 바뀌면 일시적으로 동작하지 않을 수 있습니다.

이 확장은 OpenAI, Google, Anthropic과 제휴하거나 승인받은 제품이 아닙니다. 데이터를 수집하지 않으며, 프롬프트는 사용자의 브라우저에서 각 사이트로 직접 전달됩니다.
```

## 개인 정보 보호 탭

### 단일 목적 (Single purpose)

```
Send one prompt to the ChatGPT, Gemini and Claude web apps at the same time and show their answers side by side in a single tab so the user can compare, summarize and cross-check them.
```

### 권한 사용 사유

**declarativeNetRequestWithHostAccess**

```
The extension shows chatgpt.com, gemini.google.com and claude.ai inside iframes on its own page. These sites send X-Frame-Options / Content-Security-Policy frame-ancestors headers that block framing. A session rule removes those two response headers only for sub_frame requests to these three hosts, and only in the extension's own tab (the rule is scoped with tabIds). No other requests, tabs or sites are affected.
```

**storage**

```
Stores a copy of the extension's own script files at install time so the extension page can detect that its files changed and reload itself. No user data is stored with this permission.
```

**호스트 권한 (chatgpt.com, gemini.google.com, claude.ai)**

```
A content script runs on these three sites only when they are embedded in the extension's own page. It types the user's prompt into the site's input box, submits it, and reads the answer the site displays so it can be shown side by side. Host access is also required for the header rule described above.
```

### 원격 코드

"아니요, 원격 코드를 사용하지 않습니다"를 선택한다.

### 데이터 사용

- 수집하는 데이터 항목: 아무것도 선택하지 않는다. 프롬프트와 답변은 브라우저 안에서만 처리하고 개발자에게 전송하지 않는다.
- 아래 세 가지 확인란은 모두 체크한다 (데이터를 판매하지 않음, 목적 외 사용 안 함, 신용도 판단에 사용 안 함).

### 개인정보처리방침 URL

`PRIVACY.md`의 내용을 공개 주소로 올린 뒤 그 주소를 넣는다.

## 배포 탭

- **공개 범위**: 미등록 (Unlisted). 링크를 아는 사람만 설치할 수 있고 검색에 나오지 않는다.
- **지역**: 모든 지역
