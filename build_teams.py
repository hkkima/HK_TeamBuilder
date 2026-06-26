#!/usr/bin/env python3
"""수강생 팀빌더 CLI.

사용 예:
  # 4개 팀으로 추천안 3개 생성 (샘플 데이터)
  python build_teams.py --students data/sample/students.csv \\
      --evals data/sample/peer_evaluations.csv --teams 4

  # 팀 크기를 직접 지정
  python build_teams.py --students ... --evals ... --sizes 6,6,6,5 --options 5
"""

from __future__ import annotations

import argparse
import os
import sys

from teambuilder.builder import build_recommendations
from teambuilder.loader import load_constraints, load_peer_evals, load_students
from teambuilder.relationship import build_relationship_graph
from teambuilder.report import render_report, write_csv
from teambuilder.scoring import Weights


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="관계도+성향 우선 수강생 팀빌더 (역량은 보조)")
    p.add_argument("--students", required=True, help="students.csv 경로")
    p.add_argument("--evals", help="peer_evaluations.csv 경로 (선택)")
    p.add_argument("--constraints",
                   help="운영진 강제 제약 CSV (id_a,id_b,type=together|apart)")

    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--teams", type=int, help="팀 개수 (자동 균등 분배)")
    grp.add_argument("--sizes", help="팀 크기 직접 지정, 쉼표구분 예: 6,6,6,5")

    p.add_argument("--options", type=int, default=3, help="추천안 개수 (기본 3)")
    p.add_argument("--restarts", type=int, default=60, help="최적화 재시작 횟수")
    p.add_argument("--seed", type=int, default=42, help="난수 시드(재현성)")
    p.add_argument("--out-md", default="output/recommendations.md")
    p.add_argument("--out-csv", default="output/recommendations.csv")

    # 가중치 튜닝 (관계/성향 우선, 역량 보조가 기본값)
    p.add_argument("--w-conflict", type=float)
    p.add_argument("--w-positive", type=float)
    p.add_argument("--w-prev-mix", type=float)
    p.add_argument("--w-mbti", type=float)
    p.add_argument("--w-role", type=float)
    p.add_argument("--w-leader", type=float)
    p.add_argument("--w-competency", type=float)
    p.add_argument("--w-force-together", type=float, help="강제 결합 가중치")
    p.add_argument("--w-force-separate", type=float, help="강제 분리 가중치")

    # 강도/형태 파라미터
    p.add_argument("--conflict-intensity", type=float,
                   help="갈등 강도 반영(0=균일, 클수록 심한 갈등 가중)")
    p.add_argument("--positive-intensity", type=float,
                   help="긍정 강도 반영(0=균일, 클수록 강한 긍정 우선)")
    p.add_argument("--competency-metric", choices=["stdev", "range"],
                   help="역량 평준화 지표 (기본 stdev)")

    # 관계 임계값
    p.add_argument("--conflict-threshold", type=float, default=2.0)
    p.add_argument("--positive-threshold", type=float, default=4.0)
    return p.parse_args(argv)


def build_weights(a: argparse.Namespace) -> Weights:
    w = Weights()
    if a.w_conflict is not None:
        w.conflict = a.w_conflict
    if a.w_positive is not None:
        w.positive = a.w_positive
    if a.w_prev_mix is not None:
        w.prev_mix = a.w_prev_mix
    if a.w_mbti is not None:
        w.mbti_balance = a.w_mbti
    if a.w_role is not None:
        w.role_coverage = a.w_role
    if a.w_leader is not None:
        w.leader_balance = a.w_leader
    if a.w_competency is not None:
        w.competency_balance = a.w_competency
    if a.w_force_together is not None:
        w.force_together = a.w_force_together
    if a.w_force_separate is not None:
        w.force_separate = a.w_force_separate
    if a.conflict_intensity is not None:
        w.conflict_intensity = a.conflict_intensity
    if a.positive_intensity is not None:
        w.positive_intensity = a.positive_intensity
    if a.competency_metric is not None:
        w.competency_metric = a.competency_metric
    return w


def main(argv: list[str]) -> int:
    a = parse_args(argv)
    students = load_students(a.students)
    ids = {s.id for s in students}
    evals = []
    if a.evals:
        evals = load_peer_evals(a.evals, ids)

    force_together, force_separate = set(), set()
    if a.constraints:
        force_together, force_separate = load_constraints(a.constraints, ids)

    graph = build_relationship_graph(
        students, evals,
        conflict_threshold=a.conflict_threshold,
        positive_threshold=a.positive_threshold,
    )

    sizes = None
    if a.sizes:
        sizes = [int(x) for x in a.sizes.split(",") if x.strip()]

    recs = build_recommendations(
        students, graph,
        teams=a.teams, sizes=sizes,
        weights=build_weights(a),
        force_together=force_together, force_separate=force_separate,
        n_options=a.options, restarts=a.restarts, seed=a.seed,
    )

    report = render_report(recs, graph, n_students=len(students))

    for path in (a.out_md, a.out_csv):
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
    with open(a.out_md, "w", encoding="utf-8") as fh:
        fh.write(report)
    write_csv(a.out_csv, recs)

    print(report)
    print(f"\n[저장] 리포트: {a.out_md}")
    print(f"[저장] CSV: {a.out_csv}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, FileNotFoundError) as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        sys.exit(1)
