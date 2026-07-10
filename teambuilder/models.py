"""핵심 데이터 모델 (v2 — 최종 트래킹 폼 기준).

수강생 마스터: 역량 5차원(리더십·관리·기획·작업·소통) + 성향 6종(주/부)
               + MBTI + 이슈 강도/비고 + 단원별 점수(역량 평준화용, 보조).
관계: 방향성 있는 POS/NEG 평가 + 가중치 W(1~3) + 노트.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# MBTI 4개 축.
MBTI_AXES = (("E", "I"), ("N", "S"), ("T", "F"), ("J", "P"))

# 성향 6종 (주/부 성향). 폼의 드롭다운 값과 일치.
DISP_WORKER = "작업자"
DISP_MANAGER = "매니저"
DISP_MOOD = "분위기메이커"
DISP_OWNER = "책임자"
DISP_RESEARCHER = "연구자"
DISP_SUPPORTER = "서포터"
DISPOSITIONS = (DISP_WORKER, DISP_MANAGER, DISP_MOOD,
                DISP_OWNER, DISP_RESEARCHER, DISP_SUPPORTER)

# 리더 후보로 보는 성향 (팀장 확보용).
LEADER_DISPS = (DISP_OWNER, DISP_MANAGER)

# 강한 역량으로 보는 기준(1~5 척도) — 역량 커버리지 계산용.
STRONG_THRESHOLD = 4.0
# 리더십 후보 기준(1~3 척도).
LEADERSHIP_THRESHOLD = 2.0
# 이슈 강도가 이 값 이상이면 '고이슈'로 보고 격리 대상.
HIGH_ISSUE_LEVEL = 2

DISP_ALIASES = {
    "작업자": DISP_WORKER, "worker": DISP_WORKER, "실무자": DISP_WORKER,
    "매니저": DISP_MANAGER, "manager": DISP_MANAGER, "관리자": DISP_MANAGER,
    "분위기메이커": DISP_MOOD, "분위기": DISP_MOOD, "mood": DISP_MOOD,
    "moodmaker": DISP_MOOD, "윤활유": DISP_MOOD,
    "책임자": DISP_OWNER, "owner": DISP_OWNER, "리더": DISP_OWNER, "leader": DISP_OWNER,
    "연구자": DISP_RESEARCHER, "researcher": DISP_RESEARCHER, "분석가": DISP_RESEARCHER,
    "서포터": DISP_SUPPORTER, "supporter": DISP_SUPPORTER, "조력자": DISP_SUPPORTER,
}


def normalize_disp(raw: Optional[str]) -> Optional[str]:
    """성향 문자열을 표준 6종으로 정규화. 실패 시 원본 유지."""
    if not raw:
        return None
    key = raw.strip().lower().replace(" ", "")
    return DISP_ALIASES.get(key, raw.strip())


@dataclass
class Student:
    """수강생 1명."""

    id: str
    name: str
    leadership: Optional[float] = None      # 리더십 (1~3)
    management: Optional[float] = None      # 관리 능력 (1~3)
    planning: Optional[float] = None        # 기획 역량 (1~5)
    execution: Optional[float] = None       # 작업 역량 (1~5)
    communication: Optional[float] = None   # 소통 능력 (1~5)
    primary_disp: Optional[str] = None      # 주 성향
    secondary_disp: Optional[str] = None    # 부 성향
    mbti: str = ""
    issue_level: float = 0.0                # 이슈 강도 (0~3, 0=없음)
    issue_note: str = ""                    # 이슈 비고
    special: bool = False                   # 특수 관리 태그 — 한 팀에 2명 이상 금지(하드)
    units: dict[str, float] = field(default_factory=dict)  # 단원별 점수

    def mbti_letter(self, axis_index: int) -> Optional[str]:
        if not self.mbti or len(self.mbti) < 4:
            return None
        return self.mbti[axis_index].upper()

    def comp_value(self) -> Optional[float]:
        """평준화에 쓸 단일 역량 값 = 단원별 평가 점수 평균 (없으면 None)."""
        if self.units:
            vals = [v for v in self.units.values() if v is not None]
            if vals:
                return sum(vals) / len(vals)
        return None

    def is_leader_candidate(self) -> bool:
        """리더십 점수가 높거나 책임자·매니저 성향이면 리더 후보."""
        if self.leadership is not None and self.leadership >= LEADERSHIP_THRESHOLD:
            return True
        return self.primary_disp in LEADER_DISPS or self.secondary_disp in LEADER_DISPS

    def is_high_issue(self) -> bool:
        return self.issue_level >= HIGH_ISSUE_LEVEL


@dataclass
class Relation:
    """관계 평가 1건 (from → to)."""

    src: str          # FROM (id/name)
    dst: str          # TO
    positive: bool    # True=POS, False=NEG
    weight: float = 1.0   # W (1~3)
    note: str = ""
    date: str = ""


@dataclass
class Team:
    index: int
    members: list[Student] = field(default_factory=list)

    @property
    def ids(self) -> set[str]:
        return {m.id for m in self.members}

    def avg_competency(self) -> Optional[float]:
        vals = [m.comp_value() for m in self.members if m.comp_value() is not None]
        return sum(vals) / len(vals) if vals else None
