"""추천안 Markdown/CSV 리포트 (v2)."""

from __future__ import annotations

import csv

from .builder import Recommendation
from .models import DISPOSITIONS, MBTI_AXES, Team
from .relationship import RelationshipGraph

PART_LABELS = {
    "force_together": "강제 결합",
    "force_separate": "강제 분리",
    "conflict": "갈등 분리",
    "positive": "긍정 유지",
    "special_stack": "특수관리 격리",
    "flag_same": "동일태그 격리",
    "flag_cross": "교차태그 회피",
    "role_required": "필수역할",
    "role_supporter": "서포터 보너스",
    "issue_stack": "고이슈 격리",
    "issue_balance": "이슈 분산",
    "disp_diversity": "성향 다양성",
    "leader": "리더 확보",
    "mbti_balance": "MBTI 균형",
    "competency_coverage": "역량 커버리지",
    "competency_balance": "역량 평준화(보조)",
}


def _mbti_dist(team: Team) -> str:
    known = [m for m in team.members if len(m.mbti) >= 4]
    if not known:
        return "MBTI 없음"
    out = []
    for ai, (p, q) in enumerate(MBTI_AXES):
        cp = sum(1 for m in known if m.mbti_letter(ai) == p)
        out.append(f"{p}{cp}/{q}{len(known) - cp}")
    return " · ".join(out)


def _disps_in(team: Team) -> str:
    counts = {d: 0 for d in DISPOSITIONS}
    for m in team.members:
        if m.primary_disp in counts:
            counts[m.primary_disp] += 1
    shown = [f"{d}{c}" for d, c in counts.items() if c]
    return " ".join(shown) if shown else "성향 데이터 없음"


def _leaders_in(team: Team) -> str:
    ls = [m.name for m in team.members if m.is_leader_candidate()]
    return ", ".join(ls) if ls else "없음"


def render_recommendation(idx: int, rec: Recommendation, graph: RelationshipGraph) -> str:
    lines: list[str] = [f"## 추천안 {idx}  (종합점수 {rec.score.total:.1f})", ""]
    lines.append("**점수 분해**")
    for key, label in PART_LABELS.items():
        if key in rec.score.parts:
            lines.append(f"- {label}: {rec.score.parts[key]:+.1f}")
    lines.append(f"- → 같은 팀 갈등쌍 **{len(rec.score.intra_conflicts)}개**, "
                 f"유지된 긍정쌍 {len(rec.score.kept_positives)}개, "
                 f"고이슈 겹침 {rec.score.issue_stacks}건")
    bt, vs = len(rec.score.broken_together), len(rec.score.violated_separate)
    if bt or vs:
        lines.append(f"- → ⚠️ 강제 제약 위반: 결합 {bt}쌍, 분리 {vs}쌍")
    lines.append("")

    for team in rec.teams:
        names = ", ".join(f"{m.name}({m.mbti or '-'})" for m in team.members)
        comp = team.avg_competency()
        issue = sum(m.issue_level for m in team.members)
        lines.append(f"### 팀 {team.index + 1}  ({len(team.members)}명)")
        lines.append(f"- 멤버: {names}")
        lines.append(f"- 성향: {_disps_in(team)}")
        lines.append(f"- 리더 후보: {_leaders_in(team)}")
        lines.append(f"- MBTI: {_mbti_dist(team)}")
        lines.append(f"- 평균 역량(보조): {comp:.2f}" if comp is not None
                     else "- 평균 역량(보조): N/A")
        lines.append(f"- 이슈 총량: {issue:.0f}")
        lines.append("")

    if rec.score.intra_conflicts:
        lines.append("> ⚠️ 분리하지 못한 갈등쌍: "
                     + ", ".join(f"{a}-{b}" for a, b in rec.score.intra_conflicts))
        lines.append("")
    return "\n".join(lines)


def render_report(recs, graph: RelationshipGraph, *, n_students: int) -> str:
    head = [
        "# 수강생 팀빌딩 추천 리포트",
        "",
        f"- 대상 인원: {n_students}명",
        f"- 관계 분석: 관계쌍 {graph.n_pairs}개 "
        f"(갈등 {len(graph.conflicts)} · 긍정 {len(graph.positives)})",
        f"- 추천안 수: {len(recs)}개",
        "",
        "> 우선순위: ①갈등 분리 ②긍정 유지 ③이슈 관리 ④성향/리더 ⑤역량(보조)",
        "", "---", "",
    ]
    body = "\n---\n\n".join(
        render_recommendation(i + 1, rec, graph) for i, rec in enumerate(recs))
    return "\n".join(head) + body


def write_csv(path: str, recs) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["option", "team", "id", "name", "mbti",
                    "primary_disp", "secondary_disp", "leadership",
                    "comp_avg", "issue_level", "issue_note", "special",
                    "mental", "health", "sunk", "leader_candidate"])
        for oi, rec in enumerate(recs, start=1):
            for team in rec.teams:
                for m in team.members:
                    cv = m.comp_value()
                    w.writerow([
                        oi, team.index + 1, m.id, m.name, m.mbti,
                        m.primary_disp or "", m.secondary_disp or "",
                        "" if m.leadership is None else m.leadership,
                        "" if cv is None else round(cv, 2),
                        m.issue_level, m.issue_note,
                        "Y" if m.special else "",
                        "Y" if m.mental else "", "Y" if m.health else "",
                        "Y" if m.sunk else "",
                        "Y" if m.is_leader_candidate() else "",
                    ])
