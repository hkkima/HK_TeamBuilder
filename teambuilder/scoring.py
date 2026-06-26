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
from typing import Optional

from .models import MBTI_AXES, ROLE_LEADER, STANDARD_ROLES, Student
from .relationship import RelationshipGraph, _key


@dataclass
class Weights:
    # --- 균형 항목 가중치 ---
    conflict: float = 100.0          # 같은 팀 내 갈등쌍 1개당 페널티(기본)
    positive: float = 8.0            # 같은 팀에 유지된 긍정쌍 1개당 보너스(기본)
    prev_mix: float = 6.0            # 같은 팀 내 '이전 동일팀' 쌍 1개당 페널티
    mbti_balance: float = 16.0       # 성향 균형(0~1) 스케일
    role_coverage: float = 14.0      # 역할 배분(0~1) 스케일
    leader_balance: float = 12.0     # 팀별 리더 보유 균형(0~1) 스케일
    competency_balance: float = 6.0  # 역량 평준화(보조) 스케일

    # --- 강도(intensity) 형태 파라미터 ---
    # 갈등/긍정을 '강도'에 비례해 가중. 0이면 모든 갈등(긍정)을 동일 취급,
    # 값이 클수록 심한 갈등(강한 긍정)에 더 큰 페널티(보너스).
    # 실효 가중 = base * (1 + intensity * 강도(0~1)).
    conflict_intensity: float = 1.0
    positive_intensity: float = 0.5

    # --- 역량 평준화 방식 ---
    # "stdev": 팀 평균 역량의 표준편차(전반적 평준화)
    # "range": 최고팀-최저팀 평균 격차(최악 격차 억제)
    competency_metric: str = "stdev"

    # --- 운영진 강제 제약(하드) ---
    # 데이터 기반 갈등(100)보다 훨씬 큰 가중치로 사실상 강제.
    force_together: float = 1000.0   # 강제 결합 쌍이 다른 팀에 있으면 페널티
    force_separate: float = 1000.0   # 강제 분리 쌍이 같은 팀에 있으면 페널티


@dataclass
class ScoreBreakdown:
    total: float
    parts: dict[str, float] = field(default_factory=dict)
    # 진단용 원자료
    intra_conflicts: list[tuple[str, str]] = field(default_factory=list)
    kept_positives: list[tuple[str, str]] = field(default_factory=list)
    # 운영진 강제 제약 위반 (있으면 안 됨)
    broken_together: list[tuple[str, str]] = field(default_factory=list)
    violated_separate: list[tuple[str, str]] = field(default_factory=list)


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


def _competency_metric(teams: list[list[Student]], metric: str) -> float:
    """팀 평균 역량의 평준화 지표 (낮을수록 평준화). 보조 지표.
    metric="stdev": 표준편차 / "range": 최고팀-최저팀 격차.
    """
    avgs = []
    for team in teams:
        vals = [m.instructor_score for m in team if m.instructor_score is not None]
        if vals:
            avgs.append(sum(vals) / len(vals))
    if len(avgs) < 2:
        return 0.0
    if metric == "range":
        return max(avgs) - min(avgs)
    return statistics.pstdev(avgs)


def score_partition(
    teams: list[list[Student]],
    graph: RelationshipGraph,
    weights: Weights,
    *,
    force_together: Optional[set[tuple[str, str]]] = None,
    force_separate: Optional[set[tuple[str, str]]] = None,
) -> ScoreBreakdown:
    """팀 구성안을 점수화. total이 높을수록 좋은 구성.

    force_together/force_separate: 운영진이 강제한 쌍(정렬된 키 집합).
    """
    force_together = force_together or set()
    force_separate = force_separate or set()

    intra_conflicts: list[tuple[str, str]] = []
    kept_positives: list[tuple[str, str]] = []
    conflict_penalty = 0.0   # 강도 가중 누적
    positive_bonus = 0.0     # 강도 가중 누적
    prev_mix_pairs = 0
    violated_separate: list[tuple[str, str]] = []

    # 같은 팀 안의 쌍들을 검사
    same_team: set[tuple[str, str]] = set()
    for team in teams:
        n = len(team)
        for i in range(n):
            for j in range(i + 1, n):
                a, b = team[i].id, team[j].id
                k = _key(a, b)
                same_team.add(k)
                if k in graph.conflicts:
                    intra_conflicts.append(k)
                    sev = graph.severity.get(k, 0.0)
                    conflict_penalty += weights.conflict * (
                        1.0 + weights.conflict_intensity * sev)
                elif k in graph.positives:
                    kept_positives.append(k)
                    strn = graph.strength.get(k, 0.0)
                    positive_bonus += weights.positive * (
                        1.0 + weights.positive_intensity * strn)
                if k in force_separate:
                    violated_separate.append(k)
                if (team[i].prev_team and team[j].prev_team
                        and team[i].prev_team == team[j].prev_team):
                    prev_mix_pairs += 1

    # 강제 결합인데 같은 팀이 아닌 쌍 = 위반
    broken_together = [k for k in force_together if k not in same_team]

    mbti = _mbti_balance(teams)
    role = _role_coverage(teams)
    leader = _leader_balance(teams)
    comp = _competency_metric(teams, weights.competency_metric)

    parts = {
        "conflict": -conflict_penalty,
        "positive": +positive_bonus,
        "prev_mix": -weights.prev_mix * prev_mix_pairs,
        "mbti_balance": +weights.mbti_balance * mbti,
        "role_coverage": +weights.role_coverage * role,
        "leader_balance": +weights.leader_balance * leader,
        "competency_balance": -weights.competency_balance * comp,
        "force_together": -weights.force_together * len(broken_together),
        "force_separate": -weights.force_separate * len(violated_separate),
    }
    total = sum(parts.values())
    return ScoreBreakdown(
        total=total,
        parts=parts,
        intra_conflicts=intra_conflicts,
        kept_positives=kept_positives,
        broken_together=broken_together,
        violated_separate=violated_separate,
    )
