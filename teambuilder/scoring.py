"""팀 구성안(partition) 점수화.

우선순위(요구사항):
  1) 갈등 분리          → conflict (압도적 가중치, 사실상 hard 제약)
  2) 긍정 관계 일부 유지 → positive
  3) 성향 균형 + 이전 팀 섞기 → mbti_balance, prev_mix
  4) 역할 배분          → role_coverage
  5) 역량 수준(보조)    → competency_balance
모든 항목은 "높을수록 좋음"으로 정규화한 뒤 가중합한다.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from .models import MBTI_AXES, ROLE_LEADER, STANDARD_ROLES, Student
from .relationship import RelationshipGraph, _key


@dataclass
class Weights:
    conflict: float = 100.0          # 같은 팀 내 갈등쌍 1개당 페널티
    positive: float = 8.0            # 같은 팀에 유지된 긍정쌍 1개당 보너스
    prev_mix: float = 6.0            # 같은 팀 내 '이전 동일팀' 쌍 1개당 페널티
    mbti_balance: float = 16.0       # 성향 균형(0~1) 스케일
    role_coverage: float = 14.0      # 역할 배분(0~1) 스케일
    leader_balance: float = 12.0     # 팀별 리더 보유 균형(0~1) 스케일
    competency_balance: float = 6.0  # 역량 평준화(보조). std 페널티 스케일


@dataclass
class ScoreBreakdown:
    total: float
    parts: dict[str, float] = field(default_factory=dict)
    # 진단용 원자료
    intra_conflicts: list[tuple[str, str]] = field(default_factory=list)
    kept_positives: list[tuple[str, str]] = field(default_factory=list)


def _mbti_balance(teams: list[list[Student]]) -> float:
    """팀 내부 MBTI 4축 분포의 균형도 평균 (0~1, 높을수록 골고루)."""
    team_scores = []
    for team in teams:
        known = [m for m in team if len(m.mbti) >= 4]
        if len(known) < 2:
            continue
        axis_vals = []
        for ai, (p, q) in enumerate(MBTI_AXES):
            cp = sum(1 for m in known if m.mbti_letter(ai) == p)
            cq = len(known) - cp
            # |cp-cq|/n : 0이면 완벽 분할, 1이면 한쪽으로 쏠림
            axis_vals.append(1.0 - abs(cp - cq) / len(known))
        team_scores.append(sum(axis_vals) / len(axis_vals))
    return sum(team_scores) / len(team_scores) if team_scores else 0.0


def _role_coverage(teams: list[list[Student]]) -> float:
    """팀별 역할 다양성 평균 (0~1). 주/부 역할 모두 반영."""
    scores = []
    target = len(STANDARD_ROLES)
    for team in teams:
        roles: set[str] = set()
        for m in team:
            for r in (m.primary_role, m.secondary_role):
                if r in STANDARD_ROLES:
                    roles.add(r)
        cap = min(target, len(team))
        if cap == 0:
            continue
        scores.append(min(len(roles), cap) / cap)
    return sum(scores) / len(scores) if scores else 0.0


def _leader_balance(teams: list[list[Student]]) -> float:
    """모든 팀이 최소 1명의 리더(주/부)를 보유할수록 1에 가까움 (0~1)."""
    if not teams:
        return 0.0
    have = 0
    for team in teams:
        if any(ROLE_LEADER in (m.primary_role, m.secondary_role) for m in team):
            have += 1
    return have / len(teams)


def _competency_balance(teams: list[list[Student]]) -> float:
    """팀 평균 역량의 표준편차 (낮을수록 평준화). 보조 지표."""
    avgs = []
    for team in teams:
        vals = [m.instructor_score for m in team if m.instructor_score is not None]
        if vals:
            avgs.append(sum(vals) / len(vals))
    if len(avgs) < 2:
        return 0.0
    return statistics.pstdev(avgs)


def score_partition(
    teams: list[list[Student]],
    graph: RelationshipGraph,
    weights: Weights,
) -> ScoreBreakdown:
    """팀 구성안을 점수화. total이 높을수록 좋은 구성."""
    intra_conflicts: list[tuple[str, str]] = []
    kept_positives: list[tuple[str, str]] = []
    prev_mix_pairs = 0

    for team in teams:
        n = len(team)
        for i in range(n):
            for j in range(i + 1, n):
                a, b = team[i].id, team[j].id
                k = _key(a, b)
                if k in graph.conflicts:
                    intra_conflicts.append(k)
                elif k in graph.positives:
                    kept_positives.append(k)
                if (team[i].prev_team and team[j].prev_team
                        and team[i].prev_team == team[j].prev_team):
                    prev_mix_pairs += 1

    mbti = _mbti_balance(teams)
    role = _role_coverage(teams)
    leader = _leader_balance(teams)
    comp_std = _competency_balance(teams)

    parts = {
        "conflict": -weights.conflict * len(intra_conflicts),
        "positive": +weights.positive * len(kept_positives),
        "prev_mix": -weights.prev_mix * prev_mix_pairs,
        "mbti_balance": +weights.mbti_balance * mbti,
        "role_coverage": +weights.role_coverage * role,
        "leader_balance": +weights.leader_balance * leader,
        "competency_balance": -weights.competency_balance * comp_std,
    }
    total = sum(parts.values())
    return ScoreBreakdown(
        total=total,
        parts=parts,
        intra_conflicts=intra_conflicts,
        kept_positives=kept_positives,
    )
