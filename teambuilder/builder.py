"""팀 구성 최적화기.

전략: 무작위 초기해 → 지역 탐색(두 학생 교환) → 다중 재시작.
서로 다른 우수해 여러 개를 모아 '추천안'으로 제시한다.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

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


def _partition_from_assignment(
    students: list[Student], assign: list[int], n_teams: int
) -> list[list[Student]]:
    teams: list[list[Student]] = [[] for _ in range(n_teams)]
    for stu, t in zip(students, assign):
        teams[t].append(stu)
    return teams


def _signature(teams: list[list[Student]]) -> tuple:
    return tuple(sorted(tuple(sorted(m.id for m in t)) for t in teams))


def _initial_assignment(n: int, sizes: list[int], rng: random.Random) -> list[int]:
    """팀 크기를 지키는 무작위 초기 배정."""
    slots: list[int] = []
    for ti, sz in enumerate(sizes):
        slots.extend([ti] * sz)
    rng.shuffle(slots)
    return slots  # slots[i] = i번째(셔플된) 학생의 팀. 아래서 인덱스 매칭.


def _local_search(
    students: list[Student],
    assign: list[int],
    sizes: list[int],
    graph: RelationshipGraph,
    weights: Weights,
    rng: random.Random,
    max_iter: int,
) -> tuple[list[int], ScoreBreakdown]:
    """두 학생의 팀을 맞교환하며 점수를 개선하는 first-improvement 지역탐색."""
    n_teams = len(sizes)
    teams = _partition_from_assignment(students, assign, n_teams)
    best = score_partition(teams, graph, weights)
    n = len(students)

    for _ in range(max_iter):
        improved = False
        # 무작위 순서로 쌍을 탐색해 국소최적 탈출 가능성을 높인다.
        order = list(range(n))
        rng.shuffle(order)
        for ii in range(n):
            i = order[ii]
            for jj in range(ii + 1, n):
                j = order[jj]
                if assign[i] == assign[j]:
                    continue
                assign[i], assign[j] = assign[j], assign[i]
                teams = _partition_from_assignment(students, assign, n_teams)
                cand = score_partition(teams, graph, weights)
                if cand.total > best.total + 1e-9:
                    best = cand
                    improved = True
                else:
                    assign[i], assign[j] = assign[j], assign[i]  # 되돌림
            if improved:
                break  # first-improvement: 처음부터 다시 스캔
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
    n_options: int = 3,
    restarts: int = 60,
    max_iter: int = 40,
    seed: int = 42,
) -> list[Recommendation]:
    """서로 다른 상위 추천안 n_options개를 생성."""
    weights = weights or Weights()
    size_list = sizes_for(len(students), teams=teams, sizes=sizes)
    n_teams = len(size_list)
    rng = random.Random(seed)

    found: dict[tuple, Recommendation] = {}
    for _ in range(restarts):
        assign = _initial_assignment(len(students), size_list, rng)
        assign, sb = _local_search(
            students, assign, size_list, graph, weights, rng, max_iter)
        partition = _partition_from_assignment(students, assign, n_teams)
        sig = _signature(partition)
        team_objs = [Team(index=i, members=partition[i]) for i in range(n_teams)]
        rec = Recommendation(teams=team_objs, score=sb, signature=sig)
        # 동일 구성은 더 높은 점수만 유지
        if sig not in found or sb.total > found[sig].score.total:
            found[sig] = rec

    ranked = sorted(found.values(), key=lambda r: r.score.total, reverse=True)
    return ranked[:n_options]
