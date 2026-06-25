#!/usr/bin/env python3
"""재현 가능한 샘플 데이터 생성기 (23명, 이전 6인 1팀 상호평가 포함).

실행: python data/make_sample.py
산출: data/sample/students.csv, data/sample/peer_evaluations.csv

의도적으로 몇 쌍의 '갈등'과 '긍정' 관계를 심어 두어, 빌더가
갈등을 분리하고 긍정을 일부 유지하는지 확인할 수 있게 한다.
"""

import csv
import os
import random

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "sample")
os.makedirs(OUT, exist_ok=True)

rng = random.Random(7)

MBTIS = ["ENFP", "INTJ", "ISTJ", "ESFJ", "INFP", "ENTP", "ISFP", "ESTJ",
         "INFJ", "ENTJ", "ISFJ", "ESTP", "ENFJ", "INTP", "ESFP", "ISTP"]
ROLES = ["리더", "서포터", "분위기메이커", "연구자"]
PERSONA = {
    "리더": "주도적이고 추진력 있음. 의견을 잘 모음.",
    "서포터": "성실하고 협조적. 팀을 안정적으로 받쳐줌.",
    "분위기메이커": "친화력이 좋고 팀 분위기를 띄움.",
    "연구자": "분석적이고 깊게 파고듦. 자료조사에 강함.",
}

# 이전 팀플 구성: 6/6/6/5 = 23명
prev_teams = {"A": 6, "B": 6, "C": 6, "D": 5}

students = []
sid = 0
id_by_prev = {}
for tname, size in prev_teams.items():
    id_by_prev[tname] = []
    for _ in range(size):
        sid += 1
        sidx = f"S{sid:02d}"
        role = rng.choice(ROLES)
        sec = rng.choice([r for r in ROLES if r != role])
        students.append({
            "id": sidx,
            "name": f"수강생{sid:02d}",
            "mbti": rng.choice(MBTIS),
            "personality_summary": PERSONA[role],
            "instructor_score": round(rng.uniform(2.8, 4.8), 1),
            "primary_role": role,
            "secondary_role": sec,
            "prev_team": tname,
        })
        id_by_prev[tname].append(sidx)

with open(os.path.join(OUT, "students.csv"), "w", newline="",
          encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=list(students[0].keys()))
    w.writeheader()
    w.writerows(students)

# 상호 평가: 같은 이전 팀 내에서 모든 쌍이 양방향 평가.
# 기본은 보통(3~4), 일부 쌍에 갈등/긍정을 주입.
conflict_pairs = {("S01", "S04"), ("S08", "S11"), ("S14", "S17")}
positive_pairs = {("S02", "S05"), ("S07", "S09"), ("S19", "S21")}


def directed_scores(a, b):
    pair = tuple(sorted((a, b)))
    if pair in conflict_pairs:
        # 강한 부정 (양방향 낮게, 약간 비대칭)
        return (rng.choice([1, 2]), rng.choice([1, 2]),
                rng.choice([1, 2]), 1)
    if pair in positive_pairs:
        return (5, rng.choice([4, 5]), 5, 5)
    base = rng.choice([3, 3, 4, 4, 5])
    jit = lambda: max(1, min(5, base + rng.choice([-1, 0, 0, 1])))
    return (jit(), jit(), jit(), rng.choice([3, 4, 4, 5]))


rows = []
for tname, ids in id_by_prev.items():
    for a in ids:
        for b in ids:
            if a == b:
                continue
            collab, contrib, comm, again = directed_scores(a, b)
            rows.append({
                "rater_id": a, "ratee_id": b,
                "collaboration": collab, "contribution": contrib,
                "communication": comm, "again": again, "comment": "",
            })

with open(os.path.join(OUT, "peer_evaluations.csv"), "w", newline="",
          encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

print(f"생성 완료: {len(students)}명, 평가 {len(rows)}건")
print(f"  -> {os.path.join(OUT, 'students.csv')}")
print(f"  -> {os.path.join(OUT, 'peer_evaluations.csv')}")
