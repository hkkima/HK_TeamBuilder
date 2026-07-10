"""관계 평가(POS/NEG + 가중치 W)로부터 개인간 관계도를 구축한다 (v2).

방향성 있는 관계를 무방향 쌍으로 합산:
  posW = 그 쌍에 대한 POS 가중치 합, negW = NEG 가중치 합, net = posW - negW.
  - 갈등쌍: negW>0 이고 net<=0
  - 긍정쌍: posW>0 이고 negW==0 (순수 긍정)
  - 그 외(혼재+net>0)는 중립
W(1~3)가 곧 강도이므로 severity/strength에 직접 반영한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .models import Relation, Student


def _key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a <= b else (b, a)


def _clamp01(x: float) -> float:
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


@dataclass
class RelationshipGraph:
    conflicts: set[tuple[str, str]]
    positives: set[tuple[str, str]]
    severity: dict[tuple[str, str], float] = field(default_factory=dict)
    strength: dict[tuple[str, str], float] = field(default_factory=dict)
    net: dict[tuple[str, str], float] = field(default_factory=dict)
    notes: dict[tuple[str, str], list[str]] = field(default_factory=dict)
    n_pairs: int = 0

    def relation(self, a: str, b: str) -> str:
        k = _key(a, b)
        if k in self.conflicts:
            return "conflict"
        if k in self.positives:
            return "positive"
        return "neutral"


def build_relationship_graph(
    students: list[Student],
    relations: list[Relation],
    *,
    max_weight: float = 3.0,
) -> RelationshipGraph:
    posW: dict[tuple[str, str], float] = {}
    negW: dict[tuple[str, str], float] = {}
    notes: dict[tuple[str, str], list[str]] = {}

    for r in relations:
        k = _key(r.src, r.dst)
        if r.positive:
            posW[k] = posW.get(k, 0.0) + r.weight
        else:
            negW[k] = negW.get(k, 0.0) + r.weight
        if r.note:
            notes.setdefault(k, []).append(r.note)

    conflicts: set[tuple[str, str]] = set()
    positives: set[tuple[str, str]] = set()
    severity: dict[tuple[str, str], float] = {}
    strength: dict[tuple[str, str], float] = {}
    net: dict[tuple[str, str], float] = {}

    all_pairs = set(posW) | set(negW)
    denom = max(1e-9, 2.0 * max_weight)
    for k in all_pairs:
        p = posW.get(k, 0.0)
        n = negW.get(k, 0.0)
        net[k] = p - n
        if n > 0 and (p - n) <= 0:
            conflicts.add(k)
            severity[k] = _clamp01(n / denom)
        elif p > 0 and n == 0:
            positives.add(k)
            strength[k] = _clamp01(p / denom)

    return RelationshipGraph(
        conflicts=conflicts, positives=positives,
        severity=severity, strength=strength, net=net,
        notes=notes, n_pairs=len(all_pairs),
    )
