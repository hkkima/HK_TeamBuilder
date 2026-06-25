# 수강생 팀빌더 (HK TeamBuilder)

23명 규모 수강생을 **개인간 관계도 + 성향** 위주로 분석해 팀을 짜고,
서로 다른 추천안 여러 개를 제시하는 도구입니다. 역량 수준은 **보조 지표**로만 사용합니다.

- 설치 불필요: Python 3.9+ 표준 라이브러리만 사용 (pandas 등 의존성 없음)
- 입력은 CSV 2개(수강생 정보 / 이전 팀플 상호평가), 출력은 Markdown 리포트 + CSV

## 우선순위 (알고리즘 목표)

1. **갈등 분리** — 상호평가가 나빴던 쌍을 다른 팀으로 (가장 강한 제약)
2. **긍정 관계 일부 유지** — 서로 높게 평가한 쌍 일부는 같은 팀에
3. **성향 균형 + 이전 팀 섞기** — MBTI 4축이 골고루, 이전 6인 팀은 분산
4. **역할 배분** — 리더 · 서포터 · 분위기메이커 · 연구자가 팀마다 고루
5. **역량(보조)** — 강사 평가 평균이 팀 간 비슷하게 평준화

각 항목 가중치는 CLI 플래그로 조정할 수 있습니다(아래 참조).

## 빠른 시작

```bash
# 1) 샘플 데이터 생성 (23명, 이전 6인 1팀 상호평가 포함)
python data/make_sample.py

# 2) 4개 팀으로 추천안 3개 생성
python build_teams.py \
    --students data/sample/students.csv \
    --evals data/sample/peer_evaluations.csv \
    --teams 4 --options 3
```

결과는 화면 출력 + `output/recommendations.md` + `output/recommendations.csv`에 저장됩니다.

## 실제 데이터 넣는 법 (템플릿)

`data/templates/`의 두 파일을 복사해 값을 채우면 됩니다.

### `students_template.csv` — 수강생 정보
| 컬럼 | 필수 | 설명 |
|---|---|---|
| `id` | ✅ | 고유 식별자 (예: S01) |
| `name` | ✅ | 이름(익명 가능) |
| `mbti` |  | 예: ENFP (성향 균형 계산에 사용) |
| `personality_summary` |  | 성향 요약 텍스트 |
| `instructor_score` |  | 강사진 평가(역량). 숫자. **보조 지표** |
| `primary_role` |  | 주 역할: 리더/서포터/분위기메이커/연구자 |
| `secondary_role` |  | 부 역할 |
| `prev_team` |  | 이전 팀플 팀 식별자(섞기에 사용) |

> 역할 데이터는 나중에 추가되어도 됩니다. 비어 있으면 역할 배분 항목만 자동으로 빠집니다.

### `peer_evaluations.csv` — 이전 팀플 상호평가 (양방향, rater→ratee)
| 컬럼 | 필수 | 설명 |
|---|---|---|
| `rater_id` | ✅ | 평가자 id |
| `ratee_id` | ✅ | 피평가자 id |
| `collaboration` |  | 협업/태도 (0~5 권장) |
| `contribution` |  | 기여도 |
| `communication` |  | 소통 |
| `again` |  | 다시 같은 팀? (0~5). **갈등 신호로 2배 가중** |
| `comment` |  | 자유 코멘트 |

6인 1팀이었다면 같은 팀 안에서 서로를 평가한 행들을 그대로 넣으면 됩니다.
모든 쌍이 평가될 필요는 없습니다.

## 관계도가 만들어지는 방식

- 두 사람의 양방향 점수를 평균해 **상호 점수(0~5)** 산출
- 상호 점수가 낮거나 한쪽이라도 강하게 부정 → **갈등쌍**
  (기본 임계: `--conflict-threshold 2.0`)
- 상호 점수가 높음 → **긍정쌍** (기본 `--positive-threshold 4.0`)
- `again`(다시 같은 팀 하고 싶은가)은 갈등/선호의 가장 강한 신호로 2배 가중

## 최적화 방식

무작위 초기 배정 → 두 학생을 맞교환하며 점수를 올리는 지역탐색 →
여러 번 재시작(`--restarts`)해 **서로 다른 우수 구성**을 모아 상위 N개를 추천합니다.
`--seed`로 재현 가능합니다.

## 주요 옵션

```
--teams N            팀 개수 (자동 균등 분배). 23명, 4팀 → 6/6/6/5
--sizes 6,6,6,5      팀 크기 직접 지정 (합이 인원수와 같아야 함)
--options 3          추천안 개수
--restarts 60        최적화 재시작 횟수 (많을수록 품질↑, 느려짐)
--seed 42            난수 시드(재현성)

# 가중치 조정 (기본값은 관계/성향 우선, 역량 보조)
--w-conflict 100  --w-positive 8  --w-prev-mix 6
--w-mbti 16  --w-role 14  --w-leader 12  --w-competency 6

# 관계 임계값
--conflict-threshold 2.0   --positive-threshold 4.0
```

## 출력 리포트 읽는 법

각 추천안마다:
- **점수 분해**: 항목별 기여(+/-)와 같은 팀 내 갈등쌍/긍정쌍 개수
- **팀별**: 멤버(MBTI), 성향분포(4축), 역할 구성, 평균 역량(보조)
- 분리하지 못한 갈등쌍이 있으면 ⚠️로 표시

## 프로젝트 구조

```
build_teams.py            CLI 진입점
teambuilder/
  models.py               데이터 모델(학생/평가/팀), 역할 정규화
  loader.py               CSV 로딩·검증
  relationship.py         상호평가 → 관계 그래프(갈등/긍정)
  scoring.py              구성안 점수화(우선순위별 가중합)
  builder.py              지역탐색 최적화 + 다중 추천안
  report.py               Markdown/CSV 리포트
data/
  templates/              입력 템플릿 CSV
  sample/                 샘플 데이터(make_sample.py로 생성)
  make_sample.py          재현 가능한 샘플 생성기
output/                   생성된 리포트(gitignore)
```
