"""CSV 입력 로딩 및 검증 (v2)."""

from __future__ import annotations

import csv
from typing import Optional

from .models import Relation, Student, normalize_disp


def _f(row: dict, *keys: str) -> Optional[float]:
    for k in keys:
        if k in row and row[k] is not None and str(row[k]).strip() != "":
            try:
                return float(str(row[k]).strip())
            except ValueError:
                return None
    return None


_TRUTHY = {"y", "yes", "1", "true", "t", "o", "특별", "특수", "√", "v", "x"}


def _truthy(v: str) -> bool:
    return str(v).strip().lower() in _TRUTHY


def _s(row: dict, *keys: str) -> str:
    for k in keys:
        if k in row and row[k] is not None and str(row[k]).strip() != "":
            return str(row[k]).strip()
    return ""


def _unit_columns(fieldnames) -> list[str]:
    """단원별 점수 컬럼 자동 감지 ('단원'/'unit' 포함)."""
    out = []
    for h in (fieldnames or []):
        if not h:
            continue
        low = h.strip().lower()
        if "단원" in h or low.startswith("unit") or low.startswith("chapter"):
            out.append(h)
    return out


def load_students(path: str) -> list[Student]:
    """수강생 마스터 CSV 로딩.

    필수: name(이름). 나머지는 선택.
    식별자(id)는 있으면 사용, 없으면 이름을 id로 사용.
    """
    students: list[Student] = []
    seen: set[str] = set()
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        units_cols = _unit_columns(reader.fieldnames)
        for ln, row in enumerate(reader, start=2):
            name = _s(row, "name", "이름")
            if not name:
                continue
            sid = _s(row, "id", "student_id") or name
            if sid in seen:
                raise ValueError(f"중복된 식별자 '{sid}' (line {ln})")
            seen.add(sid)
            units = {}
            for c in units_cols:
                v = _f(row, c)
                if v is not None:
                    units[c] = v
            students.append(Student(
                id=sid,
                name=name,
                leadership=_f(row, "leadership", "리더십"),
                management=_f(row, "management", "관리능력", "관리 능력", "관리"),
                planning=_f(row, "planning", "기획역량", "기획 역량", "기획"),
                execution=_f(row, "execution", "작업역량", "작업 역량", "작업"),
                communication=_f(row, "communication", "소통능력", "소통 능력", "소통"),
                primary_disp=normalize_disp(_s(row, "primary_disp", "주성향", "주 성향", "성향")),
                secondary_disp=normalize_disp(_s(row, "secondary_disp", "부성향", "부 성향")),
                mbti=_s(row, "mbti", "MBTI").upper(),
                issue_level=_f(row, "issue_level", "이슈강도", "이슈 강도") or 0.0,
                issue_note=_s(row, "issue_note", "이슈비고", "이슈 비고", "비고"),
                special=_truthy(_s(row, "special", "특수관리", "특수 관리", "특별관리", "특별", "tag")),
                mental=_truthy(_s(row, "mental", "멘탈이슈", "멘탈 이슈", "멘탈")),
                health=_truthy(_s(row, "health", "건강이슈", "건강 이슈", "건강")),
                sunk=_truthy(_s(row, "sunk", "매몰성향", "매몰 성향", "매몰")),
                units=units,
            ))
    if not students:
        raise ValueError(f"{path}: 학생 데이터가 비어 있습니다.")
    return students


def build_resolver(students: list[Student]):
    """id 또는 이름으로 학생 id를 찾는 resolver 반환."""
    id_set = {s.id for s in students}
    name_to_id: dict[str, list[str]] = {}
    for s in students:
        name_to_id.setdefault(s.name, []).append(s.id)

    def resolve(token: str, where: str = "") -> str:
        token = token.strip()
        if token in id_set:
            return token
        ids = name_to_id.get(token)
        if not ids:
            raise ValueError(f"등록되지 않은 학생 '{token}' {where}".strip())
        if len(ids) > 1:
            raise ValueError(f"이름 '{token}'이 중복이라 식별 불가 {where}. id 컬럼을 사용하세요.".strip())
        return ids[0]

    return resolve


_POS = {"pos", "positive", "긍정", "+", "p"}
_NEG = {"neg", "negative", "부정", "-", "n"}


def load_relations(path: str, students: list[Student]) -> list[Relation]:
    """관계 평가 CSV 로딩 (from, to, type=POS/NEG, weight=W, note, date)."""
    resolve = build_resolver(students)
    rels: list[Relation] = []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for ln, row in enumerate(reader, start=2):
            src = _s(row, "from", "FROM", "src", "평가자")
            dst = _s(row, "to", "TO", "dst", "대상")
            if not src or not dst:
                continue
            typ = _s(row, "type", "TYPE", "유형").lower()
            if typ in _POS:
                positive = True
            elif typ in _NEG:
                positive = False
            else:
                raise ValueError(f"알 수 없는 관계 유형 '{typ}' (line {ln})")
            a = resolve(src, f"(line {ln})")
            b = resolve(dst, f"(line {ln})")
            if a == b:
                continue
            rels.append(Relation(
                src=a, dst=b, positive=positive,
                weight=_f(row, "weight", "W", "가중치", "강도") or 1.0,
                note=_s(row, "note", "NOTE", "비고", "메모"),
                date=_s(row, "date", "DATE", "날짜"),
            ))
    return rels


def _ckey(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a <= b else (b, a)


def load_constraints(path: str, students: list[Student]):
    """운영진 강제 제약 CSV 로딩. (id_a,id_b,type=together|apart)

    id_a/id_b는 id 또는 이름 모두 허용.
    반환: (force_together, force_separate) 정렬된 쌍 키 집합.
    """
    resolve = build_resolver(students)
    together: set[tuple[str, str]] = set()
    apart: set[tuple[str, str]] = set()
    alias = {
        "together": "together", "강제결합": "together", "결합": "together",
        "같이": "together", "must": "together", "must-link": "together",
        "apart": "apart", "강제분리": "apart", "분리": "apart",
        "따로": "apart", "cannot": "apart", "cannot-link": "apart",
    }
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for ln, row in enumerate(reader, start=2):
            a = _s(row, "id_a", "a", "id1", "name_a")
            b = _s(row, "id_b", "b", "id2", "name_b")
            if not a or not b:
                continue
            ra, rb = resolve(a, f"(line {ln})"), resolve(b, f"(line {ln})")
            if ra == rb:
                raise ValueError(f"같은 학생끼리의 제약 (line {ln})")
            t = alias.get(_s(row, "type", "kind", "유형").lower())
            if t is None:
                raise ValueError(f"알 수 없는 제약 유형 '{_s(row, 'type')}' (line {ln})")
            (together if t == "together" else apart).add(_ckey(ra, rb))
    return together, apart
