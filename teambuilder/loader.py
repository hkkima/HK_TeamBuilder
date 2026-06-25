"""CSV 입력 로딩 및 검증."""

from __future__ import annotations

import csv
from typing import Optional

from .models import PeerEval, Student, normalize_role


def _f(row: dict, *keys: str) -> Optional[float]:
    """행에서 첫 번째로 값이 있는 컬럼을 float로 파싱. 없으면 None."""
    for k in keys:
        if k in row and row[k] is not None and str(row[k]).strip() != "":
            try:
                return float(str(row[k]).strip())
            except ValueError:
                return None
    return None


def _s(row: dict, *keys: str) -> str:
    for k in keys:
        if k in row and row[k] is not None and str(row[k]).strip() != "":
            return str(row[k]).strip()
    return ""


def load_students(path: str) -> list[Student]:
    """students.csv 로딩.

    필수 컬럼: id, name
    선택 컬럼: mbti, personality_summary, instructor_score,
              primary_role, secondary_role, prev_team
    """
    students: list[Student] = []
    seen: set[str] = set()
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for ln, row in enumerate(reader, start=2):
            sid = _s(row, "id", "학번", "student_id")
            if not sid:
                continue  # 빈 줄 skip
            if sid in seen:
                raise ValueError(f"중복된 학생 id '{sid}' (line {ln})")
            seen.add(sid)
            students.append(
                Student(
                    id=sid,
                    name=_s(row, "name", "이름") or sid,
                    mbti=_s(row, "mbti", "MBTI").upper(),
                    personality=_s(row, "personality_summary",
                                   "personality", "성향요약", "성향"),
                    instructor_score=_f(row, "instructor_score",
                                        "강사평가", "competency"),
                    primary_role=normalize_role(
                        _s(row, "primary_role", "주역할", "role")),
                    secondary_role=normalize_role(
                        _s(row, "secondary_role", "부역할")),
                    prev_team=_s(row, "prev_team", "이전팀", "previous_team")
                    or None,
                )
            )
    if not students:
        raise ValueError(f"{path}: 학생 데이터가 비어 있습니다.")
    return students


def load_peer_evals(path: str, valid_ids: set[str]) -> list[PeerEval]:
    """peer_evaluations.csv 로딩.

    필수 컬럼: rater_id, ratee_id
    선택 점수 컬럼(0~5): collaboration, contribution, communication, again
    """
    evals: list[PeerEval] = []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for ln, row in enumerate(reader, start=2):
            rater = _s(row, "rater_id", "평가자", "from")
            ratee = _s(row, "ratee_id", "피평가자", "to")
            if not rater or not ratee:
                continue
            if rater == ratee:
                continue  # 자기 평가 무시
            if rater not in valid_ids or ratee not in valid_ids:
                raise ValueError(
                    f"평가 데이터에 등록되지 않은 id 사용 "
                    f"(rater={rater}, ratee={ratee}, line {ln})"
                )
            evals.append(
                PeerEval(
                    rater_id=rater,
                    ratee_id=ratee,
                    collaboration=_f(row, "collaboration", "협업"),
                    contribution=_f(row, "contribution", "기여도"),
                    communication=_f(row, "communication", "소통"),
                    again=_f(row, "again", "다시같이", "want_again"),
                    comment=_s(row, "comment", "코멘트"),
                )
            )
    return evals
