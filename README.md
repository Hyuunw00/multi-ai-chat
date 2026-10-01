# Multi AI Chat

프롬프트 하나를 ChatGPT, Gemini, Claude 웹 화면에 동시에 보내고, 세 답변을 한 화면에서 비교·종합하는 개인용 크롬 확장.
API 키 없이 크롬에 로그인된 계정(무료 플랜 포함)을 그대로 쓴다.

## 설치

1. 저장소를 받는다: `git clone https://github.com/Hyuunw00/multi-ai-chat.git`
2. 크롬에서 ChatGPT, Gemini, Claude에 로그인해 둔다.
3. `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기 → **압축해제된 확장 프로그램을 로드합니다** → 받은 폴더 선택.
4. 툴바의 Multi AI Chat 아이콘을 누른다.

받은 폴더를 지우거나 옮기면 확장이 사라진다.

## 업데이트

폴더에서 `git pull` 한 뒤 Multi AI Chat 탭을 새로고침한다. 코드가 바뀌었으면 확장이 스스로 다시 로드되고 탭이 다시 열린다.

## 사이트 화면이 바뀌어 동작하지 않을 때

전송이나 답변 표시가 안 되면 `content.js` 맨 위 `SITES`의 선택자(입력창, 전송 버튼, 답변 영역)를 고친다.
