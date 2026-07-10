# 수강생 팀빌더 (HK TeamBuilder)

수강생을 **개인간 관계도 + 성향 + 이슈 관리** 위주로 분석해 팀을 짜고,
서로 다른 추천안 여러 개를 제시하는 도구입니다. 역량 수준은 **보조 지표**로만 사용합니다.

> **v2** — 최종 트래킹 폼 기준으로 데이터 모델을 재설계했습니다.
> 성향 6종(작업자·매니저·분위기메이커·책임자·연구자·서포터), 역량 5차원(리더십·관리·기획·작업·소통)
> **이슈 강도(1–3)**, 단원별 점수(역량 보조), 그리고 방향성 **관계 평가(POS/NEG + 가중치 W)**.

- **웹 프론트(GitHub Pages)** + **Python CLI** 두 가지 사용 방식 제공
- 설치 불필요: Python 3.9+ 표준 라이브러리만 사용 (pandas 등 의존성 없음)
- 입력 CSV 2개(**수강생 마스터** / **관계 평가**) + 선택(강제 규칙), 출력은 리포트 + CSV

## 웹 프론트 — 팀빌딩 스튜디오 (운영진 공유용)

`docs/` 폴더가 정적 웹 앱입니다(GitHub Pages, 백엔드·의존성 0, 바닐라 JS).
**팀빌딩 작업을 엑셀·피그마보다 간편하게** 하는 것을 목표로 한 3-탭 워크스페이스이며,
모든 계산·저장이 **브라우저 안에서만** 일어납니다(데이터 미전송).

- **자동 저장 + 프로젝트**: 작업이 `localStorage`에 **자동 저장**되어 새로고침해도 유지됩니다.
  여러 기수를 프로젝트로 관리하고 **`.json`으로 내보내기/가져오기**(공유·백업). Ctrl/⌘+Z **되돌리기/다시하기**.
- **① 데이터 탭 (엑셀 대체)**: 표에서 학생을 **인라인 추가/수정/삭제**(성향 드롭다운·역량·이슈·MBTI),
  관계는 `FROM 👍/👎 TO · W` 행으로 편집, 강제 규칙도 선택 UI. **CSV 파일 끌어놓기** 임포트 + CSV 내보내기.
- **② 편성 탭 (피그마 대체 + 자동화)**:
  - **드래그&드롭**(터치·마우스·키보드) 으로 블럭을 팀 사이 이동 — 옮길 때마다 점수/문제 즉시 갱신.
  - **핀/락**: 블럭 📌 또는 팀 🔒로 고정 → **자동 편성**이 고정은 유지하고 나머지만 재배치(부분 재편성).
  - **문제 패널**: 갈등쌍·고이슈 겹침·리더 없는 팀을 목록화하고 **[자동 해결]** 원클릭 수정.
  - 추천안은 **조합 목록**에서 골라 하나만 표시, 손으로 고친 편성을 **저장**. 팀장(👑)·팀 이름·메모 지원.
- **③ 비교 탭**: 조합들을 나란히 두고 **점수 항목 델타 표**로 선택 근거 확인.
- **CSV 내보내기**: 목록의 모든 조합을 `composition,team,team_name,team_leader,team_note,id,name,mbti,primary_disp,…,issue_level,…,pinned` 형식으로 저장.

> 로그인 게이트는 `docs/js/auth.js`의 `ENABLE_AUTH`로 끌 수 있습니다(기본 on).

### GitHub Pages 배포 (1회 설정)

1. 이 브랜치(`claude/student-team-builder-i5lx81`)를 main에 병합하거나 그대로 둡니다.
2. GitHub 저장소 → **Settings → Pages**
3. **Source: Deploy from a branch** 선택
4. **Branch**: 배포할 브랜치 + **`/docs`** 폴더 선택 → Save
5. 1~2분 후 `https://<계정>.github.io/<레포>/` 로 접속

### 로그인 자격증명 (기본값 → 반드시 변경)

- 기본 **ID: `hkadmin` / PW: `teambuilder2026`**
- 변경 방법: `docs/setup.html`(배포 후 `.../setup.html`)에서 새 ID/PW의 해시를 생성 →
  `docs/js/auth.js`의 `CREDENTIAL_HASH` 값을 교체 후 커밋
- ⚠️ **보안 주의**: 정적 페이지의 클라이언트 로그인은 *난독화 수준*입니다.
  소스를 분석하면 우회할 수 있습니다. 강한 보호가 필요하면 **저장소를 private**으로 두세요
  (실제 학생 데이터는 어차피 브라우저에서만 처리되어 저장소엔 올라가지 않습니다).

### 로컬에서 미리보기

```bash
cd docs && python3 -m http.server 8000   # http://localhost:8000 접속
```

---

## Python CLI

## 우선순위 (알고리즘 목표)

1. **갈등 분리** — NEG 관계(가중치 W 강도 반영)를 다른 팀으로 (사실상 하드)
2. **긍정 유지** — POS 관계(W 강도 반영)를 일부 같은 팀에
3. **이슈 관리** — 고이슈(강도 ≥2) 학생끼리 같은 팀 회피 + 팀 간 이슈 총량 균등 분산
4. **성향 다양성 + 리더 확보** — 성향 6종이 팀마다 고루, 리더 후보(리더십↑ 또는 책임자·매니저) 최소 1명
5. **역량(보조)** — 팀 평균 평준화 + 핵심역량(기획·작업·소통) 커버리지

각 항목 가중치는 CLI 플래그/웹 고급설정으로 조정할 수 있습니다(아래 참조).

## 빠른 시작

```bash
# 1) 샘플 데이터 생성 (23명: 마스터 + 관계 + 이슈)
python data/make_sample.py

# 2) 4개 팀으로 추천안 3개 생성
python build_teams.py \
    --students data/sample/students.csv \
    --relations data/sample/relations.csv \
    --teams 4 --options 3
```

결과는 화면 출력 + `output/recommendations.md` + `output/recommendations.csv`에 저장됩니다.

## 실제 데이터 넣는 법 (템플릿)

`data/templates/`의 두 파일을 복사해 값을 채우면 됩니다.

### `students_template.csv` — 수강생 마스터
| 컬럼 | 필수 | 설명 |
|---|---|---|
| `name`(이름) | ✅ | 이름. **관계 파일의 join 키** (중복 시 `id`로 구분) |
| `id` |  | 고유 식별자(예: S01). 없으면 이름을 id로 사용 |
| `leadership`(리더십) |  | 1~3 |
| `management`(관리 능력) |  | 1~3 |
| `planning`(기획 역량) |  | 1~5 |
| `execution`(작업 역량) |  | 1~5 |
| `communication`(소통 능력) |  | 1~5 |
| `primary_disp`(주 성향) |  | 작업자·매니저·분위기메이커·책임자·연구자·서포터 |
| `secondary_disp`(부 성향) |  | 위 6종 |
| `mbti` |  | 예: INTP |
| `issue_level`(이슈 강도) |  | 0~3 (0/빈칸=없음). ≥2면 격리·분산 대상 |
| `issue_note`(이슈 비고) |  | 자유 텍스트 |
| `단원*` / `unit*` |  | 단원별 점수(자동 감지). **역량(보조) 평준화의 유일한 기준** |

### `relations_template.csv` — 관계 평가 (방향성)
| 컬럼 | 필수 | 설명 |
|---|---|---|
| `FROM` | ✅ | 평가자 (이름 또는 id) |
| `TO` | ✅ | 대상 (이름 또는 id) |
| `TYPE` | ✅ | `POS`(긍정) 또는 `NEG`(부정) |
| `W` |  | 가중치/강도 1~3 (기본 1). **그대로 severity/strength에 반영** |
| `NOTE` |  | 자유 텍스트 |
| `DATE` |  | 날짜(선택) |

한 쌍에 여러 행(시점별)이 있어도 됩니다 — POS/NEG 가중치를 합산해 판단합니다.
`negW>0` 이고 `net(=posW−negW)≤0` 이면 갈등쌍, 순수 긍정이면 긍정쌍.

### `constraints.csv` — 운영진 강제 규칙 (선택)
운영진이 데이터와 무관하게 특정 쌍을 **강제로 같은 팀** 또는 **강제로 다른 팀**에
두고 싶을 때 사용합니다. 데이터 기반 갈등/긍정보다 **우선**합니다.

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `id_a` | ✅ | 학생 id |
| `id_b` | ✅ | 학생 id |
| `type` | ✅ | `together`(강제 결합) 또는 `apart`(강제 분리) |

> 별칭 허용: `together`=강제결합/결합/같이/must, `apart`=강제분리/분리/따로/cannot.
> CLI: `--constraints constraints.csv`. 웹: 좌측 "운영진 강제 규칙"에 한 줄에 한 쌍씩.
>
> 실현 불가능한 경우(같은 쌍을 결합+분리, 결합 그룹이 최대 팀 크기 초과 등)는
> 사람이 읽을 수 있는 오류 메시지로 즉시 알려줍니다.

## 관계도가 만들어지는 방식

- 방향성 관계를 무방향 쌍으로 합산: `posW`(POS 가중치 합), `negW`(NEG 합), `net = posW − negW`
- **갈등쌍**: `negW>0` 이고 `net≤0` → severity = `negW/(2·maxW)`
- **긍정쌍**: `posW>0` 이고 `negW==0` → strength = `posW/(2·maxW)`
- W(1~3)가 곧 강도이므로 severity/strength에 직접 반영 (혼재 & net>0 은 중립)

## 최적화 방식

무작위 초기 배정 → 두 학생을 맞교환하며 점수를 올리는 지역탐색 →
여러 번 재시작(`--restarts`)해 **서로 다른 우수 구성**을 모아 상위 N개를 추천합니다.
`--seed`로 재현 가능합니다.

## 추가 고려 사항 파라미터 (강도 · 평준화 · 강제)

세 부류로 설계되어 있습니다.

**① 균형 항목 가중치** — 각 목표를 얼마나 중시할지
| 파라미터 | 기본 | 의미 |
|---|---|---|
| `--w-conflict` | 100 | 갈등 분리(사실상 하드) |
| `--w-positive` | 8 | 긍정 유지 |
| `--w-issue-stack` | 40 | 고이슈(≥2) 2명↑ 같은 팀 격리 |
| `--w-issue-balance` | 10 | 팀 간 이슈 총량 균등 분산 |
| `--w-disp-diversity` | 16 | 성향 6종 다양성 |
| `--w-leader` | 14 | 팀별 리더 후보 확보 |
| `--w-mbti-balance` | 8 | MBTI 균형 |
| `--w-competency-coverage` | 8 | 핵심역량(기획·작업·소통) 커버리지 |
| `--w-competency-balance` | 6 | 역량 평준화(보조) |

**② 강도(intensity) · 형태**
| 파라미터 | 기본 | 의미 |
|---|---|---|
| `--conflict-intensity` | 1.0 | 0=모든 갈등 동일, 클수록 **강한(W↑) 갈등에 더 큰 페널티**. 실효가중 = base·(1+intensity·severity) |
| `--positive-intensity` | 0.5 | 강한 긍정(W↑)을 더 우선 유지 |
| `--competency-metric` | stdev | 역량 **평준화 방식**: `stdev`(전반) 또는 `range`(최악격차 억제) |
| `--max-weight` | 3.0 | W 척도 상한(severity/strength 정규화 기준) |

**③ 운영진 강제 제약(하드)** — `constraints.csv`로 입력
| 파라미터 | 기본 | 의미 |
|---|---|---|
| `--w-force-together` | 1000 | 강제 결합 위반 페널티 |
| `--w-force-separate` | 1000 | 강제 분리 위반 페널티 |

**기타 실행 옵션**
```
--teams N            팀 개수 (자동 균등 분배). 23명, 4팀 → 6/6/6/5
--sizes 6,6,6,5      팀 크기 직접 지정
--constraints f.csv  운영진 강제 규칙 파일
--pins S01:0,S02:2   학생을 특정 팀에 고정(부분 재편성)
--options 3          추천안 개수
--restarts 60        최적화 재시작 횟수
--seed 42            난수 시드(재현성)
```

예시:
```bash
python build_teams.py --students s.csv --relations r.csv --constraints c.csv \
    --teams 4 --conflict-intensity 1.5 --competency-metric range
```

## 출력 리포트 읽는 법

각 추천안마다:
- **점수 분해**: 항목별 기여(+/-)와 같은 팀 내 갈등쌍/긍정쌍 개수
- **팀별**: 멤버(MBTI), 성향 분포(6종), 리더 후보, 이슈 총량, 평균 역량(보조)
- 분리하지 못한 갈등쌍이 있으면 ⚠️로 표시
- 운영진 강제 규칙 위반이 있으면 ⚠️로 표시 (정상이면 ✅)

## 테스트

```bash
python3 tests/test_builder.py   # 단위 테스트(강제 제약·갈등 강도 포함)
bash   tests/e2e/run.sh         # 10·25·60명 E2E (CLI + 브라우저)
```

## 프로젝트 구조

```
docs/                     GitHub Pages 정적 웹 앱 (팀빌딩 스튜디오)
  index.html              앱 셸 — 상단바(프로젝트·탭·undo/redo) + 3개 탭 + 게이트
  setup.html              로그인 해시 생성기
  css/styles.css          스타일(디자인 토큰·반응형·터치)
  js/teambuilder.js       알고리즘 엔진(파이썬 포팅, 강제 제약·강도·핀)
  js/store.js             상태 스토어(프로젝트 모델·undo/redo·자동저장·import/export)
  js/dnd.js               Pointer Events 드래그(터치+마우스+키보드)
  js/problems.js          문제 진단 + 원클릭 자동수정
  js/view-data.js         ① 데이터 편집 그리드 + 관계/강제규칙 + CSV 임포트
  js/view-board.js        ② 편성 보드 + 핀/락 + 문제 패널 + 자동 편성
  js/view-compare.js      ③ 조합 비교(점수 델타)
  js/app.js               셸 컨트롤러(탭·프로젝트·단축키·토스트)
  js/auth.js              공유 ID/PW 게이트 (ENABLE_AUTH)
  js/sample.js            내장 샘플 데이터
build_teams.py            CLI 진입점 (--pins 지원)
teambuilder/
  models.py               데이터 모델(학생·관계·팀), 성향 정규화
  loader.py               CSV 로딩·검증 (students/relations/constraints, 이름 해석)
  relationship.py         관계(POS/NEG·W) → 그래프(갈등/긍정 + 강도)
  scoring.py              점수화(갈등·긍정·이슈·성향·리더·역량 + 강제)
  builder.py              제약·핀 검증·초기배치 + 지역탐색 + 다중 추천안
  report.py               Markdown/CSV 리포트
data/
  templates/              입력 템플릿 CSV (students/relations/constraints)
  sample/                 샘플 데이터(make_sample.py로 생성)
  make_sample.py          재현 가능한 샘플 생성기(파라미터화)
tests/
  test_builder.py         파이썬 단위 테스트
  e2e/                    10·25·60명 E2E (Playwright + CLI)
output/                   생성된 리포트(gitignore)
```
