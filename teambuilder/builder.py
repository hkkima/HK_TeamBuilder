"""팀 구성 최적화기.

전략: (제약을 만족하는) 초기해 → 지역 탐색(두 학생 교환) → 다중 재시작.
서로 다른 우수해 여러 개를 모아 '추천안'으로 제시한다.

운영진 강제 제약
  - force_together(강제 결합): union-find로 묶어 '원자 단위'로 한 팀에 배치.
    개별 교환은 결합을 깨면 큰 페널티를 받으므로 묶음이 유지된다.
  - force_separate(강제 분리): 초기 배치에서 가급적 분리하고, 남은 위반은
    지배적 페널티로 탐색이 떼어 놓는다.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Optional

from .models import Student, Team
from .relationship import RelationshipGraph
from .scoring import ScoreBreakdown, Weights, score_partition


@dataclass
class Recommendation:
    teams: list[Team]
    score: ScoreBreakdown
    signature: tuple  # 중복 판별용 (각 팀의 정렬된 id 튜플의 정렬 집합)


def sizes_for(n_students: int, *, teams: int | None, sizes: list[int] | None) -> list[int]:
    """팀 크기 리스트를 결정.

    - sizes가 주어지면 그대로(합이 인원수와 같아야 함).
    - teams가 주어지면 최대한 균등하게 분배(나머지를 앞 팀부터 +1).
    """
    if sizes:
        if sum(sizes) != n_students:
            raise ValueError(
                f"--sizes 합({sum(sizes)})이 인원수({n_students})와 다릅니다.")
        return list(sizes)
    if not teams or teams < 1:
        raise ValueError("--teams 또는 --sizes 중 하나는 지정해야 합니다.")
    if teams > n_students:
        raise ValueError("팀 수가 인원수보다 많습니다.")
    base, rem = divmod(n_students, teams)
    return [base + 1 if i < rem else base for i in range(teams)]


# ---- union-find (강제 결합 그룹화) --------------------------------------
def _build_groups(
    ids: list[str], force_together: set[tuple[str, str]]
) -> list[list[int]]:
    """force_together 쌍으로 학생 인덱스를 묶은 그룹 목록을 반환."""
    idx = {sid: i for i, sid in enumerate(ids)}
    parent = list(range(len(ids)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, b in force_together:
        union(idx[a], idx[b])

    groups: dict[int, list[int]] = {}
    for i in range(len(ids)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def validate_constraints(
    students: list[Student],
    sizes: list[int],
    force_together: set[tuple[str, str]],
    force_separate: set[tuple[str, str]],
) -> list[list[int]]:
    """강제 제약의 실현 가능성을 검증하고 결합 그룹을 반환.

    모순/불가능하면 ValueError로 사람이 읽을 메시지를 던진다.
    """
    ids = [s.id for s in students]
    id_set = set(ids)
    for grp in (force_together, force_separate):
        for a, b in grp:
            if a not in id_set or b not in id_set:
                raise ValueError(f"제약에 없는 학생 id 사용: {a}, {b}")

    groups = _build_groups(ids, force_together)
    idx = {sid: i for i, sid in enumerate(ids)}
    member_group = {}
    for gi, grp in enumerate(groups):
        for i in grp:
            member_group[i] = gi

    max_team = max(sizes)
    for grp in groups:
        if len(grp) > max_team:
            names = ", ".join(ids[i] for i in grp)
            raise ValueError(
                f"강제 결합 그룹 크기({len(grp)})가 최대 팀 크기({max_team})를 "
                f"초과합니다: {names}")

    # 같은 결합 그룹 안에 강제 분리 쌍이 있으면 모순
    for a, b in force_separate:
        if member_group[idx[a]] == member_group[idx[b]]:
            raise ValueError(
                f"{a}, {b}는 강제 결합으로 묶여 있어 분리할 수 없습니다(모순).")
    return groups


def _seed_assignment(
    students: list[Student],
    sizes: list[int],
    groups: list[list[int]],
    force_separate: set[tuple[str, str]],
    rng: random.Random,
) -> Optional[list[int]]:
    """제약을 존중하는 초기 배정.

    결합 그룹을 큰 것부터 용량이 남는 팀에 배치(분리 위반이 적은 팀 우선).
    배치 불가하면 None.
    """
    ids = [s.id for s in students]
    n_teams = len(sizes)
    remaining = list(sizes)
    assign = [-1] * len(students)
    members_in_team: list[set[str]] = [set() for _ in range(n_teams)]
    sep_partners: dict[str, set[str]] = {}
    for a, b in force_separate:
        sep_partners.setdefault(a, set()).add(b)
        sep_partners.setdefault(b, set()).add(a)

    # 큰 그룹부터, 동률은 무작위로
    order = sorted(range(len(groups)),
                   key=lambda gi: (-len(groups[gi]), rng.random()))
    for gi in order:
        grp = groups[gi]
        size = len(grp)
        gids = [ids[i] for i in grp]
        # 용량이 되는 팀 후보
        cand = [t for t in range(n_teams) if remaining[t] >= size]
        if not cand:
            return None
        # 분리 위반 수가 적은 팀 우선, 동률은 무작위
        def sep_cost(t: int) -> int:
            cnt = 0
            for gid in gids:
                for p in sep_partners.get(gid, ()):  # noqa: B023
                    if p in members_in_team[t]:
                        cnt += 1
            return cnt
        rng.shuffle(cand)
        cand.sort(key=sep_cost)
        t = cand[0]
        for i in grp:
            assign[i] = t
            members_in_team[t].add(ids[i])
        remaining[t] -= size
    return assign


def _partition_from_assignment(
    students: list[Student], assign: list[int], n_teams: int
) -> list[list[Student]]:
    teams: list[list[Student]] = [[] for _ in range(n_teams)]
    for stu, t in zip(students, assign):
        teams[t].append(stu)
    return teams


def _signature(teams: list[list[Student]]) -> tuple:
    return tuple(sorted(tuple(sorted(m.id for m in t)) for t in teams))


def _local_search(
    students: list[Student],
    assign: list[int],
    sizes: list[int],
    graph: RelationshipGraph,
    weights: Weights,
    rng: random.Random,
    max_iter: int,
    force_together: set[tuple[str, str]],
    force_separate: set[tuple[str, str]],
) -> tuple[list[int], ScoreBreakdown]:
    """두 학생의 팀을 맞교환하며 점수를 개선하는 first-improvement 지역탐색."""
    n_teams = len(sizes)

    def score(a):
        return score_partition(
            _partition_from_assignment(students, a, n_teams), graph, weights,
            force_together=force_together, force_separate=force_separate)

    best = score(assign)
    n = len(students)

    for _ in range(max_iter):
        improved = False
        order = list(range(n))
        rng.shuffle(order)
        for ii in range(n):
            i = order[ii]
            for jj in range(ii + 1, n):
                j = order[jj]
                if assign[i] == assign[j]:
                    continue
                assign[i], assign[j] = assign[j], assign[i]
                cand = score(assign)
                if cand.total > best.total + 1e-9:
                    best = cand
                    improved = True
                else:
                    assign[i], assign[j] = assign[j], assign[i]  # 되돌림
            if improved:
                break
        if not improved:
            break
    return assign, best


def build_recommendations(
    students: list[Student],
    graph: RelationshipGraph,
    *,
    teams: int | None = None,
    sizes: list[int] | None = None,
    weights: Weights | None = None,
    force_together: Optional[set[tuple[str, str]]] = None,
    force_separate: Optional[set[tuple[str, str]]] = None,
    n_options: int = 3,
    restarts: int = 60,
    max_iter: int = 40,
    seed: int = 42,
) -> list[Recommendation]:
    """서로 다른 상위 추천안 n_options개를 생성."""
    weights = weights or Weights()
    force_together = force_together or set()
    force_separate = force_separate or set()
    size_list = sizes_for(len(students), teams=teams, sizes=sizes)
    n_teams = len(size_list)
    rng = random.Random(seed)

    groups = validate_constraints(students, size_list,
                                  force_together, force_separate)

    found: dict[tuple, Recommendation] = {}
    for _ in range(restarts):
        assign = _seed_assignment(students, size_list, groups,
                                  force_separate, rng)
        if assign is None:
            raise ValueError("강제 제약을 만족하는 초기 배치를 찾지 못했습니다. "
                             "팀 크기나 제약을 조정하세요.")
        assign, sb = _local_search(
            students, assign, size_list, graph, weights, rng, max_iter,
            force_together, force_separate)
        partition = _partition_from_assignment(students, assign, n_teams)
        sig = _signature(partition)
        team_objs = [Team(index=i, members=partition[i]) for i in range(n_teams)]
        rec = Recommendation(teams=team_objs, score=sb, signature=sig)
        if sig not in found or sb.total > found[sig].score.total:
            found[sig] = rec

    ranked = sorted(found.values(), key=lambda r: r.score.total, reverse=True)
    return ranked[:n_options]
