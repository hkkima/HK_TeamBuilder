#!/usr/bin/env python3
"""Python CLI E2E 테스트 (10·25·60명).

브라우저 테스트(e2e.mjs)와 동일한 보장 사항을 파이썬 파이프라인에서도 검증한다.
실제 generator → relationship → builder 를 그대로 거쳐 구성안을 점검한다.

실행: python tests/e2e/run_cli.py
"""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

from data.make_sample import generate  # noqa: E402
from teambuilder.builder import build_recommendations  # noqa: E402
from teambuilder.relationship import build_relationship_graph  # noqa: E402

CASES = [(10, 2), (25, 5), (60, 10)]

passed = failed = 0
fails = []


def check(cond, label):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {label}")
    else:
        failed += 1
        fails.append(label)
        print(f"  ❌ {label}")


def to_students(raw):
    """generate()의 dict 리스트를 teambuilder.Student로 변환."""
    from teambuilder.models import Student, normalize_role
    out = []
    for r in raw:
        out.append(Student(
            id=r["id"], name=r["name"], mbti=r["mbti"],
            personality=r["personality_summary"],
            instructor_score=r["instructor_score"],
            primary_role=normalize_role(r["primary_role"]),
            secondary_role=normalize_role(r["secondary_role"]),
            prev_team=r["prev_team"],
        ))
    return out


def to_evals(raw):
    from teambuilder.models import PeerEval
    return [PeerEval(
        rater_id=e["rater_id"], ratee_id=e["ratee_id"],
        collaboration=e["collaboration"], contribution=e["contribution"],
        communication=e["communication"], again=e["again"],
    ) for e in raw]


def main():
    for n, teams in CASES:
        print(f"\n[N={n}명 · {teams}팀]")
        raw_s, raw_e, meta = generate(n, seed=7)
        students = to_students(raw_s)
        evals = to_evals(raw_e)
        graph = build_relationship_graph(students, evals)

        check(len(graph.conflicts) == len(meta["conflict_pairs"]),
              f"주입한 갈등쌍 {len(meta['conflict_pairs'])}개 모두 탐지")

        recs = build_recommendations(students, graph, teams=teams,
                                     n_options=3, restarts=40, seed=42)
        check(len(recs) >= 1, f"추천안 {len(recs)}개 생성")

        top = recs[0]
        ids = [m.id for t in top.teams for m in t.members]
        check(len(ids) == n and len(set(ids)) == n,
              f"전원 {n}명 정확히 1회 배정")
        sizes = sorted(len(t.members) for t in top.teams)
        check(len(sizes) == teams, f"팀 개수 {teams}개")
        check(sum(sizes) == n, "팀 크기 합 = 인원수")
        check(sizes[-1] - sizes[0] <= 1, "팀 크기 균형(차이 ≤1)")
        check(len(top.score.intra_conflicts) == 0,
              "최상위 추천안: 같은 팀 내 갈등쌍 0개")
        if len(recs) >= 2:
            check(recs[0].signature != recs[1].signature,
                  "추천안 1 ≠ 추천안 2")

    print(f"\n{'=' * 48}")
    print(f"CLI E2E 결과: {passed} 통과 / {failed} 실패")
    if failed:
        for f in fails:
            print("  - " + f)
    print("=" * 48)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
