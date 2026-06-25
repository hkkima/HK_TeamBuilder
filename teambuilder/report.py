"""추천안을 사람이 읽기 좋은 리포트(Markdown)와 CSV로 출력."""

from __future__ import annotations

import csv

from .builder import Recommendation
from .models import MBTI_AXES, STANDARD_ROLES, Team
from .relationship import RelationshipGraph

PART_LABELS = {
    "conflict": "갈등 분리",
    "positive": "긍정 관계 유지",
    "prev_mix": "이전 팀 섞기",
    "mbti_balance": "성향(MBTI) 균형",
    "role_coverage": "역할 배분",
    "leader_balance": "리더 분포",
    "competency_balance": "역량 평준화(보조)",
}


def _mbti_dist(team: Team) -> str:
    known = [m for m in team.members if len(m.mbti) >= 4]
    if not known:
        return "MBTI 데이터 없음"
    out = []
    for ai, (p, q) in enumerate(MBTI_AXES):
        cp = sum(1 for m in known if m.mbti_letter(ai) == p)
        out.append(f"{p}{cp}/{q}{len(known) - cp}")
    return " · ".join(out)


def _roles_in(team: Team) -> str:
    roles: dict[str, list[str]] = {r: [] for r in STANDARD_ROLES}
    for m in team.members:
        if m.primary_role in roles:
            roles[m.primary_role].append(m.name)
        elif m.secondary_role in roles:
            roles[m.secondary_role].append(f"{m.name}(부)")
    shown = [f"{r}: {', '.join(v)}" for r, v in roles.items() if v]
    return " | ".join(shown) if shown else "역할 데이터 없음"


def render_recommendation(
    idx: int, rec: Recommendation, graph: RelationshipGraph
) -> str:
    lines: list[str] = []
    lines.append(f"## 추천안 {idx}  (종합점수 {rec.score.total:.1f})")
    lines.append("")
    # 점수 분해
    lines.append("**점수 분해**")
    for key, label in PART_LABELS.items():
        if key in rec.score.parts:
            lines.append(f"- {label}: {rec.score.parts[key]:+.1f}")
    n_conf = len(rec.score.intra_conflicts)
    n_pos = len(rec.score.kept_positives)
    lines.append(f"- → 같은 팀 내 갈등쌍 **{n_conf}개**, 유지된 긍정쌍 {n_pos}개")
    lines.append("")

    for team in rec.teams:
        names = ", ".join(f"{m.name}({m.mbti or '-'})" for m in team.members)
        comp = team.avg_competency()
        comp_s = f"{comp:.2f}" if comp is not None else "N/A"
        lines.append(f"### 팀 {team.index + 1}  ({len(team.members)}명)")
        lines.append(f"- 멤버: {names}")
        lines.append(f"- 성향분포: {_mbti_dist(team)}")
        lines.append(f"- 역할: {_roles_in(team)}")
        lines.append(f"- 평균 역량(보조): {comp_s}")
        lines.append("")

    if rec.score.intra_conflicts:
        pairs = ", ".join(f"{a}-{b}" for a, b in rec.score.intra_conflicts)
        lines.append(f"> ⚠️ 분리하지 못한 갈등쌍: {pairs}")
        lines.append("")
    return "\n".join(lines)


def render_report(
    recs: list[Recommendation],
    graph: RelationshipGraph,
    *,
    n_students: int,
) -> str:
    head = [
        "# 수강생 팀빌딩 추천 리포트",
        "",
        f"- 대상 인원: {n_students}명",
        f"- 관계 분석: 평가된 쌍 {graph.n_pairs}개 "
        f"(갈등 {len(graph.conflicts)} · 긍정 {len(graph.positives)})",
        f"- 추천안 수: {len(recs)}개",
        "",
        "> 우선순위: ①갈등 분리 ②긍정 관계 일부 유지 "
        "③성향 균형/이전 팀 섞기 ④역할 배분 ⑤역량(보조)",
        "",
        "---",
        "",
    ]
    body = "\n---\n\n".join(
        render_recommendation(i + 1, rec, graph) for i, rec in enumerate(recs)
    )
    return "\n".join(head) + body


def write_csv(path: str, recs: list[Recommendation]) -> None:
    """모든 추천안을 한 CSV로 저장 (option, team, id, name, mbti, roles...)."""
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["option", "team", "id", "name", "mbti",
                    "primary_role", "secondary_role",
                    "instructor_score", "prev_team"])
        for oi, rec in enumerate(recs, start=1):
            for team in rec.teams:
                for m in team.members:
                    w.writerow([
                        oi, team.index + 1, m.id, m.name, m.mbti,
                        m.primary_role or "", m.secondary_role or "",
                        "" if m.instructor_score is None else m.instructor_score,
                        m.prev_team or "",
                    ])
