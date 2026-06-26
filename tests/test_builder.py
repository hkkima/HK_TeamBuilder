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


def _team_of(rec, sid):
    for t in rec.teams:
        if any(m.id == sid for m in t.members):
            return t.index
    return None


def test_forced_constraints():
    students, graph = _load()
    ft = {("S02", "S20")}   # 강제 결합
    fs = {("S05", "S06")}   # 강제 분리
    recs = build_recommendations(students, graph, teams=4,
                                 force_together=ft, force_separate=fs,
                                 n_options=2, restarts=40)
    top = recs[0]
    assert top.score.broken_together == [], top.score.broken_together
    assert top.score.violated_separate == [], top.score.violated_separate
    assert _team_of(top, "S02") == _team_of(top, "S20"), "강제 결합 실패"
    assert _team_of(top, "S05") != _team_of(top, "S06"), "강제 분리 실패"
    # 강제와 동시에 갈등도 0이어야 함
    assert len(top.score.intra_conflicts) == 0
    print("ok: forced_constraints (together/separate 충족)")


def test_constraint_infeasible():
    students, graph = _load()
    # 같은 쌍을 결합+분리 → 모순
    try:
        build_recommendations(students, graph, teams=4,
                              force_together={("S01", "S02")},
                              force_separate={("S01", "S02")}, restarts=5)
        assert False, "모순은 예외여야 함"
    except ValueError:
        pass
    # 그룹 크기가 최대 팀보다 큼 (5명 결합, 팀 크기 4)
    big = {("S01", "S02"), ("S02", "S03"), ("S03", "S04"), ("S04", "S05")}
    try:
        build_recommendations(students, graph, sizes=[4, 4, 4, 4, 4, 3],
                              force_together=big, restarts=5)
        assert False, "그룹 초과는 예외여야 함"
    except ValueError:
        pass
    print("ok: constraint_infeasible (모순/그룹초과 예외)")


def test_conflict_intensity():
    from teambuilder.relationship import RelationshipGraph
    from teambuilder.scoring import Weights, score_partition
    from teambuilder.models import Student
    a = Student(id="A", name="A")
    b = Student(id="B", name="B")
    # 심한 갈등(severity=1.0) vs 약한 갈등(severity=0.0) 비교
    key = ("A", "B")
    severe = RelationshipGraph({key: 0.0}, {key: 0.0}, {key}, set(), 1,
                               severity={key: 1.0})
    mild = RelationshipGraph({key: 2.0}, {key: 2.0}, {key}, set(), 1,
                             severity={key: 0.0})
    w = Weights(conflict_intensity=1.0)
    teams = [[a, b]]
    p_sev = score_partition(teams, severe, w).parts["conflict"]
    p_mild = score_partition(teams, mild, w).parts["conflict"]
    assert p_sev < p_mild, (p_sev, p_mild)  # 더 심하면 더 큰(음의) 페널티
    # intensity=0이면 둘이 같아야 함
    w0 = Weights(conflict_intensity=0.0)
    assert (score_partition(teams, severe, w0).parts["conflict"]
            == score_partition(teams, mild, w0).parts["conflict"])
    print("ok: conflict_intensity (강도 반영/무시)")


if __name__ == "__main__":
    test_sizes_for()
    test_conflicts_separated()
    test_options_distinct()
    test_forced_constraints()
    test_constraint_infeasible()
    test_conflict_intensity()
    print("\n전체 통과 ✅")
