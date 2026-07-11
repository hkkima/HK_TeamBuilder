#!/usr/bin/env python3
"""재현 가능한 샘플 데이터 생성기 (v2 — 최종 트래킹 폼 기준).

산출: <out-dir>/students.csv, relations.csv, meta.json
  - students: 역량5차원 + 성향(주/부) + MBTI + 이슈강도/비고 + 단원별 점수
  - relations: FROM,TO,TYPE(POS/NEG),W,NOTE,DATE (이름으로 참조)

갈등쌍은 '매칭'(각자 최대 1쌍)으로 주입 → 팀 2개 이상이면 항상 분리 가능.
고이슈(≥2) 인원은 팀 수 이하로 두어 서로 다른 팀에 배치 가능.
실행: python data/make_sample.py            (기본 23명)
      python data/make_sample.py --n 60
"""

import argparse
import csv
import json
import os
import random

DISPS = ["작업자", "매니저", "분위기메이커", "책임자", "연구자", "서포터"]
MBTIS = ["ENFP", "INTJ", "ISTJ", "ESFJ", "INFP", "ENTP", "ISFP", "ESTJ",
         "INFJ", "ENTJ", "ISFJ", "ESTP", "ENFJ", "INTP", "ESFP", "ISTP"]
NEG_NOTES = ["소통이 잘 되지 않음", "작업 방식에서 마찰", "역할 분배로 불만", "협업 태도 아쉬움"]
POS_NOTES = ["함께하고 싶은 팀원 (추진력)", "소통이 잘 됨", "작업 합이 좋음"]
ISSUE_NOTES = ["극도의 수동형", "불안형 / 에고 강함", "소통 부족 / 역량 미진", "GPT 의존도 높음"]


def generate(n, seed=7):
    rng = random.Random(seed)
    students = []
    for i in range(n):
        role = rng.choice(DISPS)
        sec = rng.choice([d for d in DISPS if d != role])
        students.append({
            "id": f"S{i + 1:02d}",
            "name": f"수강생{i + 1:02d}",
            "leadership": rng.randint(1, 3),
            "management": rng.randint(1, 3),
            "planning": rng.randint(1, 5),
            "execution": rng.randint(1, 5),
            "communication": rng.randint(1, 5),
            "primary_disp": role,
            "secondary_disp": sec,
            "mbti": rng.choice(MBTIS),
            "issue_level": 0,
            "issue_note": "",
            "special": "",
            "mental": "",
            "health": "",
            "sunk": "",
            "단원1": rng.randint(1, 5),
            "단원2": rng.randint(1, 5),
            "단원3": rng.randint(1, 5),
        })

    # 고이슈 주입 (팀 수보다 적게 → 분산 가능). 대략 n//8명.
    n_high = max(1, n // 8)
    hi_idx = rng.sample(range(n), n_high)
    for i in hi_idx:
        students[i]["issue_level"] = rng.choice([2, 3])
        students[i]["issue_note"] = rng.choice(ISSUE_NOTES)

    # 특수 관리 태그 주입 (팀 수보다 적게 → 분리 가능). 대략 n//12명.
    n_special = max(2, n // 12)
    sp_idx = rng.sample(range(n), min(n_special, n))
    for i in sp_idx:
        students[i]["special"] = "Y"

    # 소프트 카테고리 태그 주입 (각 팀 수보다 적게)
    cats = {"mental": max(2, n // 10), "health": max(2, n // 12), "sunk": max(2, n // 12)}
    for col, cnt in cats.items():
        for i in rng.sample(range(n), min(cnt, n)):
            students[i][col] = "Y"

    names = [s["name"] for s in students]

    # 갈등쌍(매칭) + 긍정쌍 주입
    pool = list(range(n))
    rng.shuffle(pool)
    conflict_pairs, positive_pairs = [], []
    used = set()
    n_conf = max(1, n // 10)
    it = iter(pool)
    for a in it:
        if len(conflict_pairs) >= n_conf:
            break
        if a in used:
            continue
        b = next((x for x in pool if x != a and x not in used), None)
        if b is None:
            break
        used.update((a, b))
        conflict_pairs.append((a, b))
    # 긍정쌍
    for _ in range(max(2, n // 6)):
        a, b = rng.sample(range(n), 2)
        if (a, b) not in conflict_pairs and (b, a) not in conflict_pairs:
            positive_pairs.append((a, b))

    relations = []

    def rel(a, b, typ, w, note):
        relations.append({"DATE": "2026-07-09", "FROM": names[a], "TO": names[b],
                          "TYPE": typ, "W": w, "NOTE": note})

    for a, b in conflict_pairs:
        rel(a, b, "NEG", rng.choice([2, 3]), rng.choice(NEG_NOTES))
        rel(b, a, "NEG", rng.choice([2, 3]), rng.choice(NEG_NOTES))
    for a, b in positive_pairs:
        rel(a, b, "POS", rng.choice([2, 3]), rng.choice(POS_NOTES))
        if rng.random() < 0.6:
            rel(b, a, "POS", rng.choice([1, 2, 3]), rng.choice(POS_NOTES))
    # 약한 노이즈 관계 몇 개(순수 긍정 위주)
    for _ in range(n // 3):
        a, b = rng.sample(range(n), 2)
        if a != b:
            rel(a, b, "POS", 1, "")

    meta = {
        "n": n, "seed": seed,
        "conflict_pairs": [f"{names[a]}|{names[b]}" for a, b in conflict_pairs],
        "positive_pairs": [f"{names[a]}|{names[b]}" for a, b in positive_pairs],
        "high_issue": [names[i] for i in hi_idx],
        "special": [names[i] for i in sp_idx],
    }
    return students, relations, meta


def write(out_dir, students, relations, meta):
    os.makedirs(out_dir, exist_ok=True)
    scols = ["id", "name", "leadership", "management", "planning",
             "execution", "communication", "primary_disp", "secondary_disp",
             "mbti", "issue_level", "issue_note", "special", "mental", "health",
             "sunk", "단원1", "단원2", "단원3"]
    with open(os.path.join(out_dir, "students.csv"), "w", newline="",
              encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=scols)
        w.writeheader()
        w.writerows(students)
    with open(os.path.join(out_dir, "relations.csv"), "w", newline="",
              encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["DATE", "FROM", "TO", "TYPE", "W", "NOTE"])
        w.writeheader()
        w.writerows(relations)
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=23)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out-dir", default=os.path.join(os.path.dirname(__file__), "sample"))
    a = p.parse_args()
    students, relations, meta = generate(a.n, a.seed)
    write(a.out_dir, students, relations, meta)
    print(f"생성 완료: {len(students)}명, 관계 {len(relations)}건 "
          f"(갈등 {len(meta['conflict_pairs'])} · 긍정 {len(meta['positive_pairs'])} "
          f"· 고이슈 {len(meta['high_issue'])})")
    print(f"  -> {a.out_dir}")


if __name__ == "__main__":
    main()
