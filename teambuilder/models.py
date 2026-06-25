"""핵심 데이터 모델."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# MBTI 4개 축. 성향 균형 계산에 사용한다.
MBTI_AXES = (("E", "I"), ("N", "S"), ("T", "F"), ("J", "P"))

# 표준 역할 셋. 데이터에는 한글/영문 무엇이든 들어올 수 있으나,
# 분석 시에는 아래 표준 키로 정규화한다.
ROLE_LEADER = "리더"
ROLE_SUPPORTER = "서포터"
ROLE_MOOD = "분위기메이커"
ROLE_RESEARCHER = "연구자"
STANDARD_ROLES = (ROLE_LEADER, ROLE_SUPPORTER, ROLE_MOOD, ROLE_RESEARCHER)

# 입력 표기 → 표준 역할 매핑 (소문자/공백제거 후 비교).
ROLE_ALIASES = {
    "리더": ROLE_LEADER,
    "leader": ROLE_LEADER,
    "lead": ROLE_LEADER,
    "팀장": ROLE_LEADER,
    "서포터": ROLE_SUPPORTER,
    "supporter": ROLE_SUPPORTER,
    "support": ROLE_SUPPORTER,
    "조력자": ROLE_SUPPORTER,
    "분위기메이커": ROLE_MOOD,
    "분위기": ROLE_MOOD,
    "moodmaker": ROLE_MOOD,
    "mood": ROLE_MOOD,
    "윤활유": ROLE_MOOD,
    "연구자": ROLE_RESEARCHER,
    "researcher": ROLE_RESEARCHER,
    "research": ROLE_RESEARCHER,
    "분석가": ROLE_RESEARCHER,
    "탐구자": ROLE_RESEARCHER,
}


def normalize_role(raw: Optional[str]) -> Optional[str]:
    """입력된 역할 문자열을 표준 역할로 정규화. 매칭 실패 시 원본 유지."""
    if not raw:
        return None
    key = raw.strip().lower().replace(" ", "")
    return ROLE_ALIASES.get(key, raw.strip())


@dataclass
class Student:
    """수강생 1명."""

    id: str
    name: str
    mbti: str = ""                       # 예: ENFP (없으면 빈 문자열)
    personality: str = ""                # 성향 요약 텍스트
    instructor_score: Optional[float] = None   # 강사진 평가(역량). 보조 지표.
    primary_role: Optional[str] = None   # 주 역할 (정규화됨)
    secondary_role: Optional[str] = None  # 부 역할 (정규화됨)
    prev_team: Optional[str] = None      # 이전 팀플 팀 식별자

    def mbti_letter(self, axis_index: int) -> Optional[str]:
        """주어진 MBTI 축(0~3)의 글자를 반환. 데이터가 없으면 None."""
        if not self.mbti or len(self.mbti) < 4:
            return None
        return self.mbti[axis_index].upper()


@dataclass
class PeerEval:
    """이전 팀플 상호 평가 1건 (rater -> ratee)."""

    rater_id: str
    ratee_id: str
    # 0~5 척도 권장. 비어 있는 항목은 None.
    collaboration: Optional[float] = None   # 협업/태도
    contribution: Optional[float] = None    # 기여도
    communication: Optional[float] = None   # 소통
    again: Optional[float] = None           # 다시 같은 팀? (갈등 신호로 중요)
    comment: str = ""

    def overall(self) -> Optional[float]:
        """평가 항목들의 평균. 모두 비었으면 None."""
        vals = [
            v
            for v in (self.collaboration, self.contribution,
                      self.communication, self.again)
            if v is not None
        ]
        if not vals:
            return None
        return sum(vals) / len(vals)


@dataclass
class Team:
    """구성된 팀 1개."""

    index: int
    members: list[Student] = field(default_factory=list)

    @property
    def ids(self) -> set[str]:
        return {m.id for m in self.members}

    def avg_competency(self) -> Optional[float]:
        vals = [m.instructor_score for m in self.members
                if m.instructor_score is not None]
        if not vals:
            return None
        return sum(vals) / len(vals)
