"""핵심 보장 사항 검증 (의존성 없이 실행: python tests/test_builder.py)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from teambuilder.builder import build_recommendations, sizes_for
from teambuilder.loader import load_peer_evals, load_students
from teambuilder.relationship import build_relationship_graph
from teambuilder.scoring import score_partition, Weights


def test_sizes_for():
    assert sizes_for(23, teams=4, sizes=None) == [6, 6, 6, 5]
    assert sizes_for(23, teams=5, sizes=None) == [5, 5, 5, 4, 4]
    assert sizes_for(23, teams=None, sizes=[6, 6, 6, 5]) == [6, 6, 6, 5]
    for bad in (lambda: sizes_for(23, teams=None, sizes=[6, 6, 6]),):
        try:
            bad()
            assert False, "합 불일치는 예외여야 함"
        except ValueError:
            pass
    print("ok: sizes_for")


def _load():
    base = os.path.join(os.path.dirname(__file__), "..", "data", "sample")
    students = load_students(os.path.join(base, "students.csv"))
    evals = load_peer_evals(os.path.join(base, "peer_evaluations.csv"),
                            {s.id for s in students})
    graph = build_relationship_graph(students, evals)
    return students, graph


def test_conflicts_separated():
    students, graph = _load()
    assert len(graph.conflicts) > 0, "샘플엔 갈등쌍이 있어야 함"
    recs = build_recommendations(students, graph, teams=4, n_options=3,
                                 restarts=40)
    assert recs, "추천안이 생성돼야 함"
    top = recs[0]
    # 최고 추천안은 갈등쌍을 전부 분리해야 한다.
    assert len(top.score.intra_conflicts) == 0, top.score.intra_conflicts
    # 팀 크기 보존
    assert sorted(len(t.members) for t in top.teams) == [5, 6, 6, 6]
    # 전원 정확히 한 번씩 배정
    ids = [m.id for t in top.teams for m in t.members]
    assert len(ids) == len(set(ids)) == len(students)
    print("ok: conflicts_separated, sizes, coverage")


def test_options_distinct():
    students, graph = _load()
    recs = build_recommendations(students, graph, teams=4, n_options=3,
                                 restarts=40)
    sigs = {r.signature for r in recs}
    assert len(sigs) == len(recs), "추천안들은 서로 달라야 함"
    print("ok: options_distinct")


if __name__ == "__main__":
    test_sizes_for()
    test_conflicts_separated()
    test_options_distinct()
    print("\n전체 통과 ✅")
