"""상호 평가지로부터 개인간 관계도를 구축한다.

핵심 산출물:
  - pair_score[(a,b)] : 두 사람 사이의 상호 관계 점수 (양방향 평균, 0~5)
  - conflicts         : 갈등으로 분리해야 할 쌍 {(a,b), ...}
  - positives         : 가급적 유지하면 좋은 긍정 쌍 {(a,b), ...}

설계 의도
  - 상호 평가는 6인 1팀에서 수집됐으므로 모든 쌍이 평가되는 건 아니다.
  - 'again'(다시 같은 팀 하고 싶은가)은 갈등/선호의 가장 강한 신호로 가중한다.
  - 한쪽이라도 매우 낮게 평가하면(비대칭 갈등) 갈등으로 본다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .models import PeerEval, Student


def _clamp01(x: float) -> float:
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


def _key(a: str, b: str) -> tuple[str, str]:
    """방향 무관 정렬된 쌍 키."""
    return (a, b) if a <= b else (b, a)


@dataclass
class RelationshipGraph:
    pair_score: dict[tuple[str, str], float]      # 상호 평균 (0~5)
    min_directed: dict[tuple[str, str], float]    # 두 방향 중 최저 점수
    conflicts: set[tuple[str, str]]
    positives: set[tuple[str, str]]
    n_pairs: int
    # 강도(intensity) 0~1: 갈등이 얼마나 심한가 / 긍정이 얼마나 강한가.
    # 임계 바로 옆이면 0에 가깝고, 극단으로 갈수록 1에 가깝다.
    severity: dict[tuple[str, str], float] = field(default_factory=dict)
    strength: dict[tuple[str, str], float] = field(default_factory=dict)

    def relation(self, a: str, b: str) -> str:
        k = _key(a, b)
        if k in self.conflicts:
            return "conflict"
        if k in self.positives:
            return "positive"
        return "neutral"


def build_relationship_graph(
    students: list[Student],
    evals: list[PeerEval],
    *,
    conflict_threshold: float = 2.0,
    positive_threshold: float = 4.0,
    again_weight: float = 2.0,
) -> RelationshipGraph:
    """평가 데이터로 관계 그래프 생성.

    Args:
        conflict_threshold: 상호 점수가 이 값 이하이면 갈등 후보.
        positive_threshold: 상호 점수가 이 값 이상이면 긍정 후보.
        again_weight: 'again' 항목 가중치 (다른 항목 대비). 갈등 신호 강조.
    """
    # 방향별 가중 점수 수집: directed[(rater, ratee)] = 가중 평균
    directed: dict[tuple[str, str], float] = {}
    for ev in evals:
        parts: list[tuple[float, float]] = []  # (값, 가중치)
        for v in (ev.collaboration, ev.contribution, ev.communication):
            if v is not None:
                parts.append((v, 1.0))
        if ev.again is not None:
            parts.append((ev.again, again_weight))
        if not parts:
            continue
        num = sum(v * w for v, w in parts)
        den = sum(w for _, w in parts)
        directed[(ev.rater_id, ev.ratee_id)] = num / den

    # 양방향 통합
    pair_score: dict[tuple[str, str], float] = {}
    min_directed: dict[tuple[str, str], float] = {}
    seen_keys: set[tuple[str, str]] = set()
    for (a, b) in directed:
        k = _key(a, b)
        if k in seen_keys:
            continue
        seen_keys.add(k)
        ab = directed.get((a, b))
        ba = directed.get((b, a))
        vals = [v for v in (ab, ba) if v is not None]
        pair_score[k] = sum(vals) / len(vals)
        min_directed[k] = min(vals)

    conflicts: set[tuple[str, str]] = set()
    positives: set[tuple[str, str]] = set()
    severity: dict[tuple[str, str], float] = {}
    strength: dict[tuple[str, str], float] = {}
    for k, avg in pair_score.items():
        # 비대칭 갈등: 한쪽이라도 임계 이하로 강하게 부정하면 갈등.
        if avg <= conflict_threshold or min_directed[k] <= conflict_threshold - 0.5:
            conflicts.add(k)
            # 강도: 평균과 최저점 중 더 나쁜 값을 기준으로 임계 아래로
            # 얼마나 떨어졌는지 0~1로 정규화. 임계 옆이면 0, 바닥이면 1.
            worst = min(avg, min_directed[k])
            severity[k] = _clamp01((conflict_threshold - worst) / conflict_threshold)
        elif avg >= positive_threshold:
            positives.add(k)
            # 강도: 임계와 만점(5) 사이에서 얼마나 높은지 0~1.
            denom = max(1e-9, 5.0 - positive_threshold)
            strength[k] = _clamp01((avg - positive_threshold) / denom)

    return RelationshipGraph(
        pair_score=pair_score,
        min_directed=min_directed,
        conflicts=conflicts,
        positives=positives,
        n_pairs=len(pair_score),
        severity=severity,
        strength=strength,
    )
