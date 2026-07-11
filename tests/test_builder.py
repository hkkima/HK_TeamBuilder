"""핵심 보장 검증 v2 (의존성 없이: python tests/test_builder.py)."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data.make_sample import generate, write  # noqa: E402
from teambuilder.builder import build_recommendations, sizes_for  # noqa: E402
from teambuilder.loader import (build_resolver, load_grades,  # noqa: E402
                                load_relations, load_students)
from teambuilder.relationship import build_relationship_graph  # noqa: E402


def _load(n=23, seed=7):
    d = tempfile.mkdtemp()
    s, r, gr, meta = generate(n, seed)
    write(d, s, r, gr, meta)
    students = load_students(os.path.join(d, "students.csv"))
    load_grades(os.path.join(d, "grades.csv"), students)
    relations = load_relations(os.path.join(d, "relations.csv"), students)
    graph = build_relationship_graph(students, relations)
    return students, graph, meta


def test_sizes_for():
    assert sizes_for(23, teams=4, sizes=None) == [6, 6, 6, 5]
    assert sizes_for(23, teams=5, sizes=None) == [5, 5, 5, 4, 4]
    print("ok: sizes_for")


def _team_of(rec, sid):
    for t in rec.teams:
        if any(m.id == sid for m in t.members):
            return t.index
    return None


def test_core_guarantees():
    students, graph, meta = _load()
    assert len(graph.conflicts) == len(meta["conflict_pairs"]), \
        (len(graph.conflicts), len(meta["conflict_pairs"]))
    recs = build_recommendations(students, graph, teams=4, n_options=3, restarts=40)
    top = recs[0]
    ids = [m.id for t in top.teams for m in t.members]
    assert len(ids) == len(set(ids)) == len(students)
    assert sorted(len(t.members) for t in top.teams) == [5, 6, 6, 6]
    assert len(top.score.intra_conflicts) == 0, top.score.intra_conflicts
    print("ok: core (전원배정·크기·갈등0)")


def test_issue_and_leader():
    students, graph, meta = _load()
    recs = build_recommendations(students, graph, teams=4, n_options=1, restarts=60)
    top = recs[0]
    # 고이슈 겹침 0
    assert top.score.issue_stacks == 0, top.score.issue_stacks
    # 모든 팀에 리더 후보 1명 이상
    for t in top.teams:
        assert any(m.is_leader_candidate() for m in t.members), \
            f"팀 {t.index} 리더 없음"
    print("ok: 고이슈 격리 + 팀별 리더 확보")


def test_forced_constraints():
    students, graph, _ = _load()
    ids = [s.id for s in students]
    ft = {tuple(sorted((ids[0], ids[5])))}
    fs = {tuple(sorted((ids[1], ids[2])))}
    recs = build_recommendations(students, graph, teams=4,
                                 force_together=ft, force_separate=fs,
                                 n_options=1, restarts=40)
    top = recs[0]
    assert top.score.broken_together == []
    assert top.score.violated_separate == []
    assert _team_of(top, ids[0]) == _team_of(top, ids[5])
    assert _team_of(top, ids[1]) != _team_of(top, ids[2])
    print("ok: 강제 결합/분리 충족")


def test_name_resolution():
    # 관계 파일이 이름으로 참조돼도 정상 로딩
    students, graph, _ = _load()
    assert graph.n_pairs > 0
    print("ok: 관계 이름 참조 해석")


def test_special_tag():
    students, graph, meta = _load()
    assert len(meta["special"]) >= 2, "샘플에 특수 태그가 있어야 함"
    # 특수 태그 학생은 어떤 팀에도 2명 이상 없어야 함 (모든 추천안)
    recs = build_recommendations(students, graph, teams=4, n_options=3, restarts=40)
    for rec in recs:
        for t in rec.teams:
            assert sum(1 for m in t.members if m.special) <= 1, "특수 태그 겹침!"
        assert rec.score.special_stacks == 0
    # 태그가 팀 수보다 많으면 예외
    for s in students:
        s.special = True
    try:
        build_recommendations(students, graph, teams=4, restarts=3)
        assert False, "태그>팀수는 예외여야 함"
    except ValueError:
        pass
    print("ok: 특수 태그 팀당 최대 1명 + 초과 예외")


def test_flags_and_roles():
    students, graph, _ = _load()
    n_teams = 4
    recs = build_recommendations(students, graph, teams=n_teams, n_options=1, restarts=60)
    top = recs[0]
    # 같은 카테고리 태그는 한 팀에 2명 이상 없어야 (샘플은 태그 수 ≤ 팀수라 가능)
    for f in ("mental", "sunk"):
        for t in top.teams:
            assert sum(1 for m in t.members if getattr(m, f)) <= 1, f"{f} 겹침"
    assert top.score.flag_same_stacks == 0
    # 필수 역할(분위기메이커·매니저·책임자) 미충족이 최소화되어야
    assert top.score.role_missing == 0, f"필수 역할 미충족 {top.score.role_missing}"
    print("ok: 카테고리 격리 + 필수 역할 커버")


def test_pins():
    students, graph, _ = _load()
    ids = [s.id for s in students]
    # ids[0]→팀0, ids[1]→팀2 고정
    pins = {ids[0]: 0, ids[1]: 2}
    recs = build_recommendations(students, graph, teams=4, pins=pins,
                                 n_options=1, restarts=40)
    top = recs[0]
    assert _team_of(top, ids[0]) == 0, "핀 미준수"
    assert _team_of(top, ids[1]) == 2, "핀 미준수"
    # 저장 teams와 점수 일치 (회귀 방지)
    from teambuilder.scoring import score_partition
    teams = [[m for m in t.members] for t in top.teams]
    resc = score_partition(teams, graph, __import__("teambuilder.scoring",
                           fromlist=["Weights"]).Weights())
    assert abs(resc.total - top.score.total) < 1e-6, (resc.total, top.score.total)
    # 모순 핀: 팀 인덱스 범위 초과 → 예외
    try:
        build_recommendations(students, graph, teams=4, pins={ids[0]: 9}, restarts=3)
        assert False
    except ValueError:
        pass
    print("ok: 핀 고정 + 점수 일치 + 범위 예외")


def test_options_distinct():
    students, graph, _ = _load()
    recs = build_recommendations(students, graph, teams=4, n_options=3, restarts=40)
    sigs = {r.signature for r in recs}
    assert len(sigs) == len(recs)
    print("ok: 추천안 상이성")


if __name__ == "__main__":
    test_sizes_for()
    test_core_guarantees()
    test_issue_and_leader()
    test_forced_constraints()
    test_name_resolution()
    test_special_tag()
    test_flags_and_roles()
    test_pins()
    test_options_distinct()
    print("\n전체 통과 ✅")
