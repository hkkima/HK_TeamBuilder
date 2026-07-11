#!/usr/bin/env python3
"""Python CLI E2E (v2) — 10·25·60명.

실제 generator → loader → relationship → builder 를 거쳐 보장 사항을 검증.
실행: python tests/e2e/run_cli.py
"""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

from data.make_sample import generate, write  # noqa: E402
from teambuilder.builder import build_recommendations  # noqa: E402
from teambuilder.loader import (load_grades, load_relations,  # noqa: E402
                                load_students)
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


def main():
    for n, teams in CASES:
        print(f"\n[N={n}명 · {teams}팀]")
        d = tempfile.mkdtemp()
        s, r, gr, meta = generate(n, seed=7)
        write(d, s, r, gr, meta)
        students = load_students(os.path.join(d, "students.csv"))
        load_grades(os.path.join(d, "grades.csv"), students)
        relations = load_relations(os.path.join(d, "relations.csv"), students)
        graph = build_relationship_graph(students, relations)

        check(len(graph.conflicts) == len(meta["conflict_pairs"]),
              f"갈등쌍 {len(meta['conflict_pairs'])}개 탐지")
        recs = build_recommendations(students, graph, teams=teams,
                                     n_options=3, restarts=40, seed=42)
        check(len(recs) >= 1, f"추천안 {len(recs)}개 생성")
        top = recs[0]
        ids = [m.id for t in top.teams for m in t.members]
        check(len(ids) == n and len(set(ids)) == n, f"전원 {n}명 1회 배정")
        sizes = sorted(len(t.members) for t in top.teams)
        check(len(sizes) == teams and sum(sizes) == n, f"팀 {teams}개·합 {n}")
        check(sizes[-1] - sizes[0] <= 1, "팀 크기 균형")
        check(len(top.score.intra_conflicts) == 0, "최상위: 갈등쌍 0")
        check(top.score.issue_stacks == 0, "최상위: 고이슈 겹침 0")
        check(all(any(m.is_leader_candidate() for m in t.members) for t in top.teams),
              "모든 팀 리더 후보 확보")

    print(f"\n{'=' * 48}\nCLI E2E 결과: {passed} 통과 / {failed} 실패\n{'=' * 48}")
    for f in fails:
        print("  - " + f)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
