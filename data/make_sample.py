#!/usr/bin/env python3
"""재현 가능한 샘플 데이터 생성기 (파라미터화).

이전 팀플은 6인 1팀 구조라고 가정하고 N명을 prev_team으로 묶은 뒤,
같은 이전 팀 안에서 양방향 상호평가를 생성한다. 일부 쌍에 의도적으로
'갈등'/'긍정'을 주입해 빌더가 갈등을 분리하고 긍정을 유지하는지 검증할 수 있다.

기본 실행(23명):  python data/make_sample.py
임의 규모:        python data/make_sample.py --n 60 --seed 7 --out-dir data/n60

갈등쌍은 항상 '매칭'(각 사람이 최대 1개의 갈등쌍에만 속함)으로 주입하므로
팀이 2개 이상이면 언제나 갈등을 0개로 분리할 수 있다.
산출물: <out-dir>/students.csv, peer_evaluations.csv, meta.json
"""

import argparse
import csv
import json
import os
import random

MBTIS = ["ENFP", "INTJ", "ISTJ", "ESFJ", "INFP", "ENTP", "ISFP", "ESTJ",
         "INFJ", "ENTJ", "ISFJ", "ESTP", "ENFJ", "INTP", "ESFP", "ISTP"]
ROLES = ["리더", "서포터", "분위기메이커", "연구자"]
PERSONA = {
    "리더": "주도적이고 추진력 있음. 의견을 잘 모음.",
    "서포터": "성실하고 협조적. 팀을 안정적으로 받쳐줌.",
    "분위기메이커": "친화력이 좋고 팀 분위기를 띄움.",
    "연구자": "분석적이고 깊게 파고듦. 자료조사에 강함.",
}


def generate(n, seed=7, prev_size=6):
    rng = random.Random(seed)

    # 이전 팀(prev_team) 구성: 6인씩 묶고 마지막 팀은 나머지.
    students = []
    id_by_prev = {}
    for i in range(n):
        sidx = f"S{i + 1:02d}"
        tname = chr(ord("A") + (i // prev_size))
        role = rng.choice(ROLES)
        sec = rng.choice([r for r in ROLES if r != role])
        students.append({
            "id": sidx,
            "name": f"수강생{i + 1:02d}",
            "mbti": rng.choice(MBTIS),
            "personality_summary": PERSONA[role],
            "instructor_score": round(rng.uniform(2.8, 4.8), 1),
            "primary_role": role,
            "secondary_role": sec,
            "prev_team": tname,
        })
        id_by_prev.setdefault(tname, []).append(sidx)

    # 갈등/긍정 쌍 주입 — 같은 이전 팀 안에서, 갈등은 매칭으로.
    conflict_pairs, positive_pairs = [], []
    used_in_conflict = set()
    n_conflict_target = max(1, n // 12)
    n_positive_target = max(2, n // 6)

    for tname, ids in id_by_prev.items():
        if len(ids) < 2:
            continue
        # 갈등: 팀당 최대 1쌍, 전역 매칭 유지
        if len(conflict_pairs) < n_conflict_target:
            cand = [x for x in ids if x not in used_in_conflict]
            if len(cand) >= 2:
                a, b = rng.sample(cand, 2)
                conflict_pairs.append(tuple(sorted((a, b))))
                used_in_conflict.update((a, b))
        # 긍정: 팀당 1쌍 정도
        if len(positive_pairs) < n_positive_target and len(ids) >= 2:
            a, b = rng.sample(ids, 2)
            key = tuple(sorted((a, b)))
            if key not in conflict_pairs:
                positive_pairs.append(key)

    conflict_set = set(conflict_pairs)
    positive_set = set(positive_pairs)

    def directed(a, b):
        key = tuple(sorted((a, b)))
        if key in conflict_set:
            return (rng.choice([1, 2]), rng.choice([1, 2]),
                    rng.choice([1, 2]), 1)
        if key in positive_set:
            return (5, rng.choice([4, 5]), 5, 5)
        base = rng.choice([3, 3, 4, 4, 5])

        def jit():
            return max(1, min(5, base + rng.choice([-1, 0, 0, 1])))
        return (jit(), jit(), jit(), rng.choice([3, 4, 4, 5]))

    evals = []
    for ids in id_by_prev.values():
        for a in ids:
            for b in ids:
                if a == b:
                    continue
                col, con, com, ag = directed(a, b)
                evals.append({
                    "rater_id": a, "ratee_id": b,
                    "collaboration": col, "contribution": con,
                    "communication": com, "again": ag, "comment": "",
                })

    meta = {
        "n": n,
        "seed": seed,
        "prev_size": prev_size,
        "conflict_pairs": ["|".join(p) for p in conflict_pairs],
        "positive_pairs": ["|".join(p) for p in positive_pairs],
    }
    return students, evals, meta


def write(out_dir, students, evals, meta):
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "students.csv"), "w", newline="",
              encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(students[0].keys()))
        w.writeheader()
        w.writerows(students)
    with open(os.path.join(out_dir, "peer_evaluations.csv"), "w", newline="",
              encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(evals[0].keys()))
        w.writeheader()
        w.writerows(evals)
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)


def main():
    p = argparse.ArgumentParser(description="샘플 데이터 생성기")
    p.add_argument("--n", type=int, default=23, help="수강생 수 (기본 23)")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--prev-size", type=int, default=6, help="이전 팀 크기")
    p.add_argument("--out-dir", default=os.path.join(
        os.path.dirname(__file__), "sample"))
    a = p.parse_args()
    students, evals, meta = generate(a.n, a.seed, a.prev_size)
    write(a.out_dir, students, evals, meta)
    print(f"생성 완료: {len(students)}명, 평가 {len(evals)}건 "
          f"(갈등 {len(meta['conflict_pairs'])} · 긍정 {len(meta['positive_pairs'])})")
    print(f"  -> {a.out_dir}")


if __name__ == "__main__":
    main()
