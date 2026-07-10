"""팀 구성안 점수화 (v2).

우선순위
  1) 갈등 분리 (NEG 관계, W 강도 반영) — 사실상 하드
  2) 긍정 유지 (POS 관계, W 강도 반영)
  3) 이슈 관리: 고이슈 학생 격리 + 팀 간 이슈 총량 균등 분산
  4) 성향(6종) 다양성 + 리더(리더십/책임자·매니저) 확보
  5) 역량(보조): 팀 평균 평준화 + 핵심역량(기획·작업·소통) 커버리지
  + MBTI 균형, 운영진 강제 제약(하드)
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

from .models import (DISPOSITIONS, MBTI_AXES, STRONG_THRESHOLD, Student)
from .relationship import RelationshipGraph, _key


@dataclass
class Weights:
    conflict: float = 100.0
    positive: float = 8.0
    issue_stack: float = 40.0        # 같은 팀 고이슈 2명↑ 1명당 페널티
    issue_balance: float = 10.0      # 팀 간 이슈 총량 표준편차 스케일
    disp_diversity: float = 16.0     # 성향 다양성(0~1)
    leader: float = 14.0             # 팀별 리더 확보(0~1)
    mbti_balance: float = 8.0        # MBTI 균형(0~1)
    competency_coverage: float = 8.0  # 핵심역량 커버리지(0~1)
    competency_balance: float = 6.0  # 역량 평준화(보조)

    conflict_intensity: float = 1.0
    positive_intensity: float = 0.5
    competency_metric: str = "stdev"  # "stdev" | "range"

    force_together: float = 1000.0
    force_separate: float = 1000.0


@dataclass
class ScoreBreakdown:
    total: float
    parts: dict[str, float] = field(default_factory=dict)
    intra_conflicts: list[tuple[str, str]] = field(default_factory=list)
    kept_positives: list[tuple[str, str]] = field(default_factory=list)
    broken_together: list[tuple[str, str]] = field(default_factory=list)
    violated_separate: list[tuple[str, str]] = field(default_factory=list)
    issue_stacks: int = 0


def _mbti_balance(teams: list[list[Student]]) -> float:
    scores = []
    for team in teams:
        known = [m for m in team if len(m.mbti) >= 4]
        if len(known) < 2:
            continue
        acc = 0.0
        for ai, (p, q) in enumerate(MBTI_AXES):
            cp = sum(1 for m in known if m.mbti_letter(ai) == p)
            acc += 1.0 - abs(cp - (len(known) - cp)) / len(known)
        scores.append(acc / len(MBTI_AXES))
    return sum(scores) / len(scores) if scores else 0.0


def _disp_diversity(teams: list[list[Student]]) -> float:
    scores = []
    target = len(DISPOSITIONS)
    for team in teams:
        s: set[str] = set()
        for m in team:
            for d in (m.primary_disp, m.secondary_disp):
                if d in DISPOSITIONS:
                    s.add(d)
        cap = min(target, len(team))
        if cap:
            scores.append(min(len(s), cap) / cap)
    return sum(scores) / len(scores) if scores else 0.0


def _leader_balance(teams: list[list[Student]]) -> float:
    if not teams:
        return 0.0
    have = sum(1 for t in teams if any(m.is_leader_candidate() for m in t))
    return have / len(teams)


def _competency_coverage(teams: list[list[Student]]) -> float:
    """각 팀이 기획·작업·소통에서 강한(≥4) 멤버를 얼마나 보유하는지 (0~1)."""
    scores = []
    for team in teams:
        if not team:
            continue
        covered = 0
        for attr in ("planning", "execution", "communication"):
            if any(getattr(m, attr) is not None and getattr(m, attr) >= STRONG_THRESHOLD
                   for m in team):
                covered += 1
        scores.append(covered / 3.0)
    return sum(scores) / len(scores) if scores else 0.0


def _competency_balance(teams: list[list[Student]], metric: str) -> float:
    avgs = []
    for team in teams:
        vals = [m.comp_value() for m in team if m.comp_value() is not None]
        if vals:
            avgs.append(sum(vals) / len(vals))
    if len(avgs) < 2:
        return 0.0
    return (max(avgs) - min(avgs)) if metric == "range" else statistics.pstdev(avgs)


def _issue_balance(teams: list[list[Student]]) -> float:
    totals = [sum(m.issue_level for m in t) for t in teams]
    return statistics.pstdev(totals) if len(totals) >= 2 else 0.0


def _issue_stacks(teams: list[list[Student]]) -> int:
    """같은 팀 고이슈(≥2) 인원이 2명 이상일 때 초과분 합계."""
    extra = 0
    for team in teams:
        hi = sum(1 for m in team if m.is_high_issue())
        if hi > 1:
            extra += hi - 1
    return extra


def score_partition(
    teams: list[list[Student]],
    graph: RelationshipGraph,
    weights: Weights,
    *,
    force_together: Optional[set[tuple[str, str]]] = None,
    force_separate: Optional[set[tuple[str, str]]] = None,
) -> ScoreBreakdown:
    force_together = force_together or set()
    force_separate = force_separate or set()

    intra_conflicts: list[tuple[str, str]] = []
    kept_positives: list[tuple[str, str]] = []
    conflict_penalty = 0.0
    positive_bonus = 0.0
    violated_separate: list[tuple[str, str]] = []
    same_team: set[tuple[str, str]] = set()

    for team in teams:
        n = len(team)
        for i in range(n):
            for j in range(i + 1, n):
                k = _key(team[i].id, team[j].id)
                same_team.add(k)
                if k in graph.conflicts:
                    intra_conflicts.append(k)
                    conflict_penalty += weights.conflict * (
                        1.0 + weights.conflict_intensity * graph.severity.get(k, 0.0))
                elif k in graph.positives:
                    kept_positives.append(k)
                    positive_bonus += weights.positive * (
                        1.0 + weights.positive_intensity * graph.strength.get(k, 0.0))
                if k in force_separate:
                    violated_separate.append(k)

    broken_together = [k for k in force_together if k not in same_team]
    stacks = _issue_stacks(teams)

    parts = {
        "conflict": -conflict_penalty,
        "positive": +positive_bonus,
        "issue_stack": -weights.issue_stack * stacks,
        "issue_balance": -weights.issue_balance * _issue_balance(teams),
        "disp_diversity": +weights.disp_diversity * _disp_diversity(teams),
        "leader": +weights.leader * _leader_balance(teams),
        "mbti_balance": +weights.mbti_balance * _mbti_balance(teams),
        "competency_coverage": +weights.competency_coverage * _competency_coverage(teams),
        "competency_balance": -weights.competency_balance
        * _competency_balance(teams, weights.competency_metric),
        "force_together": -weights.force_together * len(broken_together),
        "force_separate": -weights.force_separate * len(violated_separate),
    }
    return ScoreBreakdown(
        total=sum(parts.values()), parts=parts,
        intra_conflicts=intra_conflicts, kept_positives=kept_positives,
        broken_together=broken_together, violated_separate=violated_separate,
        issue_stacks=stacks,
    )
