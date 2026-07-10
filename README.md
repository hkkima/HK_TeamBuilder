# 수강생 팀빌더 (HK TeamBuilder)

수강생을 **개인간 관계도 + 성향 + 이슈 관리** 위주로 분석해 팀을 짜고,
서로 다른 추천안 여러 개를 제시하는 도구입니다. 역량 수준은 **보조 지표**로만 사용합니다.

> **v2** — 최종 트래킹 폼 기준으로 데이터 모델을 재설계했습니다.
> 성향 6종(작업자·매니저·분위기메이커·책임자·연구자·서포터), 역량 5차원(리더십·관리·기획·작업·소통)
> + 종합역량, **이슈 강도(1–3)**, 그리고 방향성 **관계 평가(POS/NEG + 가중치 W)**.

- **웹 프론트(GitHub Pages)** + **Python CLI** 두 가지 사용 방식 제공
- 설치 불필요: Python 3.9+ 표준 라이브러리만 사용 (pandas 등 의존성 없음)
- 입력 CSV 2개(**수강생 마스터** / **관계 평가**) + 선택(강제 규칙), 출력은 리포트 + CSV

## 웹 프론트 (운영진 공유용)

`docs/` 폴더가 정적 웹 앱입니다. 로그인(공유 ID/PW) 후 브라우저에서 바로 사용합니다.
파이썬 알고리즘을 JavaScript로 포팅해 **모든 계산이 브라우저 안에서만** 일어나며,
업로드한 학생 데이터는 서버나 저장소로 전송되지 않습니다.

### 편성 보드 (드래그&드롭)

로직은 **초안**을 만들고, 최종 조정은 운영진이 손으로 합니다.

- **수강생 = 블럭**: 이름·MBTI·성향·역량·리더후보(★)·이슈배지(⚠)를 담은 블럭을 **드래그해 팀 사이로 이동**
  (모바일/트랙패드는 블럭 클릭 → 대상 팀 클릭). 옮길 때마다 **점수·갈등·강제규칙이 즉시 갱신**됩니다.
- **화면엔 조합 하나만**: 추천안 3개는 상단 **조합 목록**에서 골라 보드에 표시합니다.
- **내가 조립한 조합 저장**: 손으로 고친 편성을 **현재 조합 저장**으로 목록에 추가.
  (미배정 인원이 있으면 저장이 막힙니다.) **빈 편성 시작**으로 전원 미배정에서 처음부터 조립도 가능.
- **팀장 설정**: 블럭 우측 👑 버튼으로 팀당 1명 팀장 지정/해제. 팀장을 다른 팀으로 옮기면 자동 해제됩니다.
- **팀 메모**: 각 팀 헤더의 입력칸에 운영자 메모/주석을 적을 수 있습니다.
  팀장·메모는 조합별로 저장·불러오기되고 CSV에도 포함됩니다.
- 같은 팀 갈등쌍은 블럭이 빨갛게, 강제 결합이 깨지면 노랗게 표시됩니다.
- **CSV 내보내기**는 목록의 모든 조합을
  `composition,team,team_leader,team_note,id,name,mbti,primary_disp,…,issue_level,…` 형식으로 저장합니다.

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
| `overall`(종합 역량) |  | 종합 역량 값. **보조 지표** (평준화용) |
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
| `단원*` / `unit*` |  | 단원별 점수(자동 감지). 종합역량 없으면 평균으로 대체 |

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
docs/                     GitHub Pages 정적 웹 앱
  index.html              로그인 게이트 + 팀빌더 UI (강제 규칙·고급 파라미터 포함)
  setup.html              로그인 해시 생성기
  css/styles.css          스타일
  js/auth.js              공유 ID/PW 로그인 게이트
  js/teambuilder.js       알고리즘(파이썬 포팅, 강제 제약·강도 포함)
  js/app.js               UI 연결·렌더링·CSV 내보내기
  js/sample.js            내장 샘플 데이터
build_teams.py            CLI 진입점
teambuilder/
  models.py               데이터 모델(학생·관계·팀), 성향 정규화
  loader.py               CSV 로딩·검증 (students/relations/constraints, 이름 해석)
  relationship.py         관계(POS/NEG·W) → 그래프(갈등/긍정 + 강도)
  scoring.py              점수화(갈등·긍정·이슈·성향·리더·역량 + 강제)
  builder.py              제약 검증·초기배치 + 지역탐색 + 다중 추천안
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
