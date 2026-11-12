# 증권왕

1956년 대한증권거래소 개장부터 2026년까지, 원하는 해에 입사해 트레이더로 일하는 웹 게임.

## 실행

빌드 과정이 없다. `index.html`을 브라우저로 열면 된다.

```bash
npx serve .
```

## 구조

| 파일 | 내용 |
| --- | --- |
| `js/data.js` | 지수·비트코인 기준점, 종목, 업종 사이클, 뉴스, 직급 |
| `js/world.js` | 시장 시뮬레이션. (seed, 주차)만으로 같은 세계가 재현된다 |
| `js/game.js` | 플레이어 상태, 매매, 월급, 승진, 저장(localStorage) |
| `js/ui.js` | 화면 |
| `tools/build-single.js` | 전체를 HTML 한 파일로 합친다 (`dist/`) |

## 시세 모델

- 종합지수는 실제 흐름을 참고한 기준점(1980.1.4 = 100)을 따라가고, 그 위에 판마다 다른 잡음이 얹힌다.
- 종목은 20개 업종 81개이고 모두 가상의 회사다. 지수 민감도(beta), 업종 호재·악재, 고유 변동성으로 움직인다.
- 업종 호재·악재(`SECTOR_WAVES`)는 시작될 때 뉴스로 뜨고, 시장 탭의 업종 머리줄과 종목 창에 요약된다.
- 비트코인은 2009년 1월부터 거래된다. 2013년 4월 전까지는 주당 매수 한도가 있다.
- 1962년 6월 화폐개혁 때 가격과 현금이 10환 = 1원으로 바뀐다.

## 앱스토어 / 플레이스토어

정적 웹 앱이라 Capacitor로 감싸면 된다.

```bash
npm init -y
```

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
```

```bash
npx cap init 증권왕 com.example.jeunggwonwang --web-dir .
```

출시 전에 할 일: 웹 폰트를 앱에 내장, PNG 아이콘·스플래시 제작, 저장소를 Capacitor Preferences로 교체.
