#!/usr/bin/env python3
"""수강생 팀빌더 CLI (v2).

사용 예:
  python build_teams.py --students data/sample/students.csv \\
      --relations data/sample/relations.csv --teams 4 --options 3
"""

from __future__ import annotations

import argparse
import os
import sys

from teambuilder.builder import build_recommendations
from teambuilder.loader import load_constraints, load_relations, load_students
from teambuilder.relationship import build_relationship_graph
from teambuilder.report import render_report, write_csv
from teambuilder.scoring import Weights


def parse_args(argv):
    p = argparse.ArgumentParser(description="관계+성향+이슈 기반 수강생 팀빌더 (역량 보조)")
    p.add_argument("--students", required=True)
    p.add_argument("--relations", help="관계 평가 CSV (from,to,type=POS/NEG,weight,note)")
    p.add_argument("--constraints", help="강제 제약 CSV (id_a,id_b,type=together|apart)")
    p.add_argument("--pins", help="핀 고정 (예: S01:0,S02:2 — 학생을 팀인덱스에 고정)")

    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--teams", type=int)
    grp.add_argument("--sizes")

    p.add_argument("--options", type=int, default=3)
    p.add_argument("--restarts", type=int, default=60)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out-md", default="output/recommendations.md")
    p.add_argument("--out-csv", default="output/recommendations.csv")

    # 가중치
    for name in ("conflict", "positive", "special-stack", "issue-stack", "issue-balance",
                 "disp-diversity", "leader", "mbti-balance",
                 "competency-coverage", "competency-balance",
                 "force-together", "force-separate"):
        p.add_argument(f"--w-{name}", type=float)
    p.add_argument("--conflict-intensity", type=float)
    p.add_argument("--positive-intensity", type=float)
    p.add_argument("--competency-metric", choices=["stdev", "range"])
    p.add_argument("--max-weight", type=float, default=3.0)
    return p.parse_args(argv)


def build_weights(a) -> Weights:
    w = Weights()
    mapping = {
        "w_conflict": "conflict", "w_positive": "positive",
        "w_special_stack": "special_stack",
        "w_issue_stack": "issue_stack", "w_issue_balance": "issue_balance",
        "w_disp_diversity": "disp_diversity", "w_leader": "leader",
        "w_mbti_balance": "mbti_balance",
        "w_competency_coverage": "competency_coverage",
        "w_competency_balance": "competency_balance",
        "w_force_together": "force_together", "w_force_separate": "force_separate",
        "conflict_intensity": "conflict_intensity",
        "positive_intensity": "positive_intensity",
        "competency_metric": "competency_metric",
    }
    for arg, field in mapping.items():
        v = getattr(a, arg, None)
        if v is not None:
            setattr(w, field, v)
    return w


def main(argv):
    a = parse_args(argv)
    students = load_students(a.students)
    relations = load_relations(a.relations, students) if a.relations else []
    force_together, force_separate = (set(), set())
    if a.constraints:
        force_together, force_separate = load_constraints(a.constraints, students)

    graph = build_relationship_graph(students, relations, max_weight=a.max_weight)

    sizes = [int(x) for x in a.sizes.split(",") if x.strip()] if a.sizes else None
    pins = {}
    if a.pins:
        for tok in a.pins.split(","):
            if ":" in tok:
                pid, ti = tok.split(":", 1)
                pins[pid.strip()] = int(ti)
    recs = build_recommendations(
        students, graph, teams=a.teams, sizes=sizes,
        weights=build_weights(a),
        force_together=force_together, force_separate=force_separate,
        pins=pins,
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
    print(f"\n[저장] {a.out_md}\n[저장] {a.out_csv}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, FileNotFoundError) as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        sys.exit(1)
