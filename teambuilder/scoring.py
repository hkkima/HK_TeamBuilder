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

from .models import (DISP_MANAGER, DISP_MOOD, DISP_OWNER, DISP_SUPPORTER,
                     DISPOSITIONS, FLAG_CATEGORIES, MBTI_AXES, REQUIRED_DISPS,
                     STRONG_THRESHOLD, Student)
from .relationship import RelationshipGraph, _key


@dataclass
class Weights:
    # 핵심: ①갈등 분리 ②성향 분포. (실사용 피드백 반영)
    conflict: float = 100.0          # 갈등 분리 (사실상 하드) — 핵심 ①
    positive: float = 5.0            # 긍정 유지 (성향 분포보다 낮게)
    special_stack: float = 500.0     # 특수 관리 태그 2명↑ 같은 팀 (사실상 하드)
    flag_same: float = 0.0           # 카테고리(멘탈/매몰) 격리 — 운영자 확인용, 자동 반영 안 함
    flag_cross: float = 0.0          # 카테고리 교차 — 운영자 확인용, 자동 반영 안 함
    role_required: float = 25.0      # 팀마다 분위기메이커·매니저·책임자 각 1명 (강한 소프트)
    role_supporter: float = 5.0      # 팀에 서포터가 있으면 보너스
    leader_pair: float = 35.0        # 팀장+부팀장 쌍이 책임자≥1·매니저≥1 커버 (강한 소프트)
    mood_cover: float = 22.0         # 팀 분위기메이커 점수(주1/부0.5)≥1 (강한 소프트)
    issue_stack: float = 40.0        # 같은 팀 고이슈 2명↑ 1명당 페널티
    issue_balance: float = 6.0       # 팀 간 이슈 총량 표준편차 스케일
    disp_diversity: float = 45.0     # 성향 분포(혼합도, 0~1) — 핵심 ②
    leader: float = 14.0             # 팀별 리더 확보(0~1)
    mbti_balance: float = 5.0        # MBTI 균형(0~1, 보조)
    competency_coverage: float = 6.0  # 핵심역량 커버리지(0~1, 보조)
    competency_balance: float = 3.0  # 역량 평준화(보조)

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
    special_stacks: int = 0
    flag_same_stacks: int = 0
    role_missing: int = 0
    leader_pair_missing: int = 0
    mood_missing: int = 0


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
    """성향 분포(혼합도): 팀별 '서로 다른 주 성향'을 가진 멤버 쌍의 비율 (0~1) 평균.

    팀 안의 모든 멤버 쌍 중 주 성향이 다른 쌍의 비율. 같은 성향이 한 팀에
    많이 몰릴수록(예: 작업자 4명) 같은-성향 쌍이 급증해 점수가 크게 낮아진다
    (볼록 페널티 → 골고루 분산 선호). 부 성향은 세지 않아 변별력을 유지.
    """
    from collections import Counter
    scores = []
    for team in teams:
        n = len(team)
        if n < 2:
            if n == 1:
                scores.append(1.0)
            continue
        total_pairs = n * (n - 1) / 2
        counts = Counter(m.primary_disp for m in team if m.primary_disp in DISPOSITIONS)
        same_pairs = sum(c * (c - 1) / 2 for c in counts.values())
        # 성향 미상 멤버끼리/미상-기타 쌍은 same도 diff도 아님 → total에서 제외
        unknown = n - sum(counts.values())
        same_pairs += unknown * (unknown - 1) / 2  # 미상끼리는 '같은 것 취급'(다양성 아님)
        scores.append(max(0.0, (total_pairs - same_pairs) / total_pairs))
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


def _special_stacks(teams: list[list[Student]]) -> int:
    """특수 관리 태그가 같은 팀에 2명 이상일 때 초과분 합계."""
    extra = 0
    for team in teams:
        sp = sum(1 for m in team if m.special)
        if sp > 1:
            extra += sp - 1
    return extra


_FLAG_FIELDS = [f for f, _ in FLAG_CATEGORIES]


def _flag_same(teams: list[list[Student]]) -> int:
    """같은 카테고리(멘탈/매몰) 태그가 한 팀에 2명 이상일 때 초과분 합계."""
    extra = 0
    for team in teams:
        for f in _FLAG_FIELDS:
            c = sum(1 for m in team if getattr(m, f))
            if c > 1:
                extra += c - 1
    return extra


def _flag_cross(teams: list[list[Student]]) -> int:
    """한 팀 안에서 서로 다른 카테고리에 걸친 '서로 다른 두 학생' 쌍의 수 (약한 회피).
    한 학생이 여러 태그를 가진 경우 자기 자신과의 쌍은 세지 않는다.
    """
    total = 0
    for team in teams:
        flagged = sum(1 for m in team if any(getattr(m, f) for f in _FLAG_FIELDS))
        pairs = flagged * (flagged - 1) // 2
        same = 0
        for f in _FLAG_FIELDS:
            c = sum(1 for m in team if getattr(m, f))
            same += c * (c - 1) // 2
        total += max(0, pairs - same)
    return total


def _role_required_missing(teams: list[list[Student]]) -> int:
    """비어있지 않은 팀에서 필수 성향(분위기메이커·매니저·책임자) 미충족 수 합계."""
    miss = 0
    for team in teams:
        if not team:
            continue
        for role in REQUIRED_DISPS:
            if not any(m.covers_disp(role) for m in team):
                miss += 1
    return miss


def _has_leader_pair(team: list[Student]) -> bool:
    """책임자 점수≥1 · 매니저 점수≥1 을 만족하는 서로 다른 두 명이 있는가."""
    n = len(team)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = team[i], team[j]
            if (a.disp_score(DISP_OWNER) + b.disp_score(DISP_OWNER) >= 1.0
                    and a.disp_score(DISP_MANAGER) + b.disp_score(DISP_MANAGER) >= 1.0):
                return True
    return False


def _leader_pair_missing(teams: list[list[Student]]) -> int:
    """팀장+부팀장 쌍(책임자≥1·매니저≥1)을 구성할 수 없는 팀(2명 이상) 수."""
    miss = 0
    for team in teams:
        if len(team) < 2:
            continue
        if not _has_leader_pair(team):
            miss += 1
    return miss


def _mood_missing(teams: list[list[Student]]) -> int:
    """분위기메이커 점수(주1/부0.5) 합이 1 미만인 비어있지 않은 팀 수."""
    miss = 0
    for team in teams:
        if team and sum(m.disp_score(DISP_MOOD) for m in team) < 1.0:
            miss += 1
    return miss


def _role_supporter_frac(teams: list[list[Student]]) -> float:
    """서포터를 보유한 팀 비율 (0~1)."""
    nonempty = [t for t in teams if t]
    if not nonempty:
        return 0.0
    have = sum(1 for t in nonempty if any(m.covers_disp(DISP_SUPPORTER) for m in t))
    return have / len(nonempty)


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
    sp_stacks = _special_stacks(teams)
    flag_same = _flag_same(teams)
    role_miss = _role_required_missing(teams)
    leader_miss = _leader_pair_missing(teams)
    mood_miss = _mood_missing(teams)

    parts = {
        "conflict": -conflict_penalty,
        "positive": +positive_bonus,
        "special_stack": -weights.special_stack * sp_stacks,
        "flag_same": -weights.flag_same * flag_same,
        "flag_cross": -weights.flag_cross * _flag_cross(teams),
        "leader_pair": -weights.leader_pair * leader_miss,
        "mood_cover": -weights.mood_cover * mood_miss,
        "role_required": -weights.role_required * role_miss,
        "role_supporter": +weights.role_supporter * _role_supporter_frac(teams),
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
        issue_stacks=stacks, special_stacks=sp_stacks,
        flag_same_stacks=flag_same, role_missing=role_miss,
        leader_pair_missing=leader_miss, mood_missing=mood_miss,
    )
