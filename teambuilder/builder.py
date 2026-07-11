"""팀 구성 최적화기.

전략: (제약을 만족하는) 초기해 → 지역 탐색(두 학생 교환) → 다중 재시작.
서로 다른 우수해 여러 개를 모아 '추천안'으로 제시한다.

운영진 강제 제약
  - force_together(강제 결합): union-find로 묶어 '원자 단위'로 한 팀에 배치.
    개별 교환은 결합을 깨면 큰 페널티를 받으므로 묶음이 유지된다.
  - force_separate(강제 분리): 초기 배치에서 가급적 분리하고, 남은 위반은
    지배적 페널티로 탐색이 떼어 놓는다.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Optional

from .models import (DISP_MANAGER, DISP_MOOD, DISP_OWNER, Student, Team)
from .relationship import RelationshipGraph
from .scoring import ScoreBreakdown, Weights, score_partition


@dataclass
class Recommendation:
    teams: list[Team]
    score: ScoreBreakdown
    signature: tuple  # 중복 판별용 (각 팀의 정렬된 id 튜플의 정렬 집합)
    # 팀별 팀장/부팀장 학생 id (없으면 None). teams 인덱스와 정렬 일치.
    leader_by_team: list[Optional[str]] = None
    deputy_by_team: list[Optional[str]] = None


def designate_team(members: list[Student]) -> tuple[Optional[str], Optional[str]]:
    """한 팀의 (팀장, 부팀장) id 지정.

    책임자≥1·매니저≥1 을 만족하는 서로 다른 두 명의 쌍 중 커버리지(그다음 리더십)가
    최대인 쌍을 고르고, 없으면 리더 후보 순으로 대체. 팀장은 책임자 점수(동률 리더십)가
    높은 쪽.
    """
    if not members:
        return (None, None)
    if len(members) == 1:
        return (members[0].id, None)

    def lead(m: Student) -> float:
        return m.leadership or 0.0

    def rank(m: Student) -> float:
        # 팀장 적합도: 책임자+매니저 성향 + 리더십 + 관리 능력, 관리대상(특별)은 감점
        return (m.disp_score(DISP_OWNER) + m.disp_score(DISP_MANAGER)
                + (m.leadership or 0.0) / 3 + (m.management or 0.0) / 3
                - (2.0 if m.special else 0.0))

    best = None  # (cover, ls, i, j)
    n = len(members)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = members[i], members[j]
            os_ = a.disp_score(DISP_OWNER) + b.disp_score(DISP_OWNER)
            ms_ = a.disp_score(DISP_MANAGER) + b.disp_score(DISP_MANAGER)
            if os_ >= 1.0 and ms_ >= 1.0:
                cand = (os_ + ms_, lead(a) + lead(b), i, j)
                if best is None or cand[:2] > best[:2]:
                    best = cand
    if best is not None:
        a, b = members[best[2]], members[best[3]]
    else:
        ranked = sorted(members, key=lambda m: (rank(m), lead(m)), reverse=True)
        a, b = ranked[0], ranked[1]
    # 팀장 = 복합 적합도(책임자·매니저·리더십·관리·관리대상아님) 우선(동률 리더십)
    if (rank(b), lead(b)) > (rank(a), lead(a)):
        a, b = b, a
    return (a.id, b.id)


def designate_leaders(teams: list[list[Student]]) -> tuple[list, list]:
    leaders, deputies = [], []
    for t in teams:
        lid, did = designate_team(t)
        leaders.append(lid)
        deputies.append(did)
    return leaders, deputies


def sizes_for(n_students: int, *, teams: int | None, sizes: list[int] | None) -> list[int]:
    """팀 크기 리스트를 결정.

    - sizes가 주어지면 그대로(합이 인원수와 같아야 함).
    - teams가 주어지면 최대한 균등하게 분배(나머지를 앞 팀부터 +1).
    """
    if sizes:
        if sum(sizes) != n_students:
            raise ValueError(
                f"--sizes 합({sum(sizes)})이 인원수({n_students})와 다릅니다.")
        return list(sizes)
    if not teams or teams < 1:
        raise ValueError("--teams 또는 --sizes 중 하나는 지정해야 합니다.")
    if teams > n_students:
        raise ValueError("팀 수가 인원수보다 많습니다.")
    base, rem = divmod(n_students, teams)
    return [base + 1 if i < rem else base for i in range(teams)]


# ---- union-find (강제 결합 그룹화) --------------------------------------
def _build_groups(
    ids: list[str], force_together: set[tuple[str, str]]
) -> list[list[int]]:
    """force_together 쌍으로 학생 인덱스를 묶은 그룹 목록을 반환."""
    idx = {sid: i for i, sid in enumerate(ids)}
    parent = list(range(len(ids)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, b in force_together:
        union(idx[a], idx[b])

    groups: dict[int, list[int]] = {}
    for i in range(len(ids)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def validate_constraints(
    students: list[Student],
    sizes: list[int],
    force_together: set[tuple[str, str]],
    force_separate: set[tuple[str, str]],
    pins: Optional[dict[str, int]] = None,
) -> list[list[int]]:
    """강제 제약의 실현 가능성을 검증하고 결합 그룹을 반환.

    모순/불가능하면 ValueError로 사람이 읽을 메시지를 던진다.
    pins: {학생id: 팀인덱스} — 특정 팀에 고정.
    """
    pins = pins or {}
    ids = [s.id for s in students]
    id_set = set(ids)
    for grp in (force_together, force_separate):
        for a, b in grp:
            if a not in id_set or b not in id_set:
                raise ValueError(f"제약에 없는 학생 id 사용: {a}, {b}")

    groups = _build_groups(ids, force_together)
    idx = {sid: i for i, sid in enumerate(ids)}
    member_group = {}
    for gi, grp in enumerate(groups):
        for i in grp:
            member_group[i] = gi

    max_team = max(sizes)
    for grp in groups:
        if len(grp) > max_team:
            names = ", ".join(ids[i] for i in grp)
            raise ValueError(
                f"강제 결합 그룹 크기({len(grp)})가 최대 팀 크기({max_team})를 "
                f"초과합니다: {names}")

    # 같은 결합 그룹 안에 강제 분리 쌍이 있으면 모순
    for a, b in force_separate:
        if member_group[idx[a]] == member_group[idx[b]]:
            raise ValueError(
                f"{a}, {b}는 강제 결합으로 묶여 있어 분리할 수 없습니다(모순).")

    # ---- 핀 검증 ----
    n_teams = len(sizes)
    per_team = [0] * n_teams
    group_pin: dict[int, int] = {}
    for pid, t in pins.items():
        if pid not in id_set:
            raise ValueError(f"핀에 없는 학생 id: {pid}")
        if not isinstance(t, int) or t < 0 or t >= n_teams:
            raise ValueError(f"핀 팀 인덱스 범위 오류: {pid}→{t} (팀 {n_teams}개)")
        per_team[t] += 1
        gi = member_group[idx[pid]]
        if gi in group_pin and group_pin[gi] != t:
            raise ValueError(f"강제 결합 그룹이 서로 다른 팀에 핀됨(모순): {pid}")
        group_pin[gi] = t
    for t in range(n_teams):
        if per_team[t] > sizes[t]:
            raise ValueError(f"팀 {t + 1}에 핀 {per_team[t]}명 > 정원 {sizes[t]}")
    # 강제 분리 쌍이 같은 팀에 핀되면 모순
    for a, b in force_separate:
        if a in pins and b in pins and pins[a] == pins[b]:
            raise ValueError(f"{a}, {b}는 분리 대상인데 같은 팀에 핀됨(모순).")

    # ---- 특수 관리 태그 검증 (한 팀에 2명 이상 금지, 하드) ----
    special_idx = [i for i, s in enumerate(students) if s.special]
    if len(special_idx) > n_teams:
        raise ValueError(
            f"특수 관리 태그 {len(special_idx)}명 > 팀 {n_teams}개 — "
            f"태그가 팀 수보다 많아 분리할 수 없습니다. 팀 수를 늘리세요.")
    grp_special: dict[int, int] = {}
    for i in special_idx:
        gi = member_group[i]
        if gi in grp_special:
            raise ValueError(
                f"특수 관리 태그 2명이 강제 결합으로 묶여 분리 불가(모순): "
                f"{ids[grp_special[gi]]}, {ids[i]}")
        grp_special[gi] = i
    pin_special_team: dict[int, int] = {}
    for i in special_idx:
        pid = ids[i]
        if pid in pins:
            t = pins[pid]
            if t in pin_special_team:
                raise ValueError(
                    f"특수 관리 태그 2명이 같은 팀에 핀됨(모순): "
                    f"{ids[pin_special_team[t]]}, {pid}")
            pin_special_team[t] = i
    return groups


def _seed_assignment(
    students: list[Student],
    sizes: list[int],
    groups: list[list[int]],
    force_separate: set[tuple[str, str]],
    rng: random.Random,
    pins: Optional[dict[str, int]] = None,
    special_idx: Optional[set[int]] = None,
) -> Optional[list[int]]:
    """제약을 존중하는 초기 배정.

    핀 그룹 → 특수 태그 그룹(팀당 1명) → 나머지 순으로 배치. 배치 불가하면 None.
    """
    pins = pins or {}
    special_idx = special_idx or set()
    ids = [s.id for s in students]
    n_teams = len(sizes)
    remaining = list(sizes)
    assign = [-1] * len(students)
    members_in_team: list[set[str]] = [set() for _ in range(n_teams)]
    team_has_special = [False] * n_teams
    sep_partners: dict[str, set[str]] = {}
    for a, b in force_separate:
        sep_partners.setdefault(a, set()).add(b)
        sep_partners.setdefault(b, set()).add(a)

    group_special = [any(i in special_idx for i in grp) for grp in groups]

    group_pin: dict[int, int] = {}
    for gi, grp in enumerate(groups):
        for i in grp:
            if ids[i] in pins:
                group_pin[gi] = pins[ids[i]]
                break

    def place(gi: int, t: int) -> bool:
        grp = groups[gi]
        if remaining[t] < len(grp):
            return False
        if group_special[gi] and team_has_special[t]:
            return False
        for i in grp:
            assign[i] = t
            members_in_team[t].add(ids[i])
        remaining[t] -= len(grp)
        if group_special[gi]:
            team_has_special[t] = True
        return True

    def sep_cost_of(gids, t: int) -> int:
        return sum(1 for gid in gids for p in sep_partners.get(gid, ()) if p in members_in_team[t])

    def team_ds(t: int, disp: str) -> float:
        return sum(students[i].disp_score(disp) for i in range(len(students)) if assign[i] == t)

    def grp_ds(gi: int, disp: str) -> float:
        return sum(students[i].disp_score(disp) for i in groups[gi])

    def leader_bias(gi: int, t: int) -> int:
        b = 0
        if grp_ds(gi, DISP_OWNER) > 0 and team_ds(t, DISP_OWNER) < 1:
            b -= 2
        if grp_ds(gi, DISP_MANAGER) > 0 and team_ds(t, DISP_MANAGER) < 1:
            b -= 2
        if team_ds(t, DISP_OWNER) >= 1 and team_ds(t, DISP_MANAGER) >= 1:
            b += 1
        return b

    def mood_bias(gi: int, t: int) -> int:
        return -2 if team_ds(t, DISP_MOOD) < 1 else 1

    def place_free(gi: int, bias=None) -> bool:
        grp = groups[gi]
        gids = [ids[i] for i in grp]
        cand = [t for t in range(n_teams) if remaining[t] >= len(grp)
                and not (group_special[gi] and team_has_special[t])]
        if not cand:
            return False
        rng.shuffle(cand)
        cand.sort(key=lambda t: (sep_cost_of(gids, t), bias(gi, t) if bias else 0))
        return place(gi, cand[0])

    # 1) 핀 고정 그룹
    for gi, t in group_pin.items():
        if not place(gi, t):
            return None
    # 2) 특수 태그 그룹 (팀당 1명 하드), 큰 것부터
    special_order = sorted((gi for gi in range(len(groups))
                            if group_special[gi] and gi not in group_pin),
                           key=lambda gi: (-len(groups[gi]), rng.random()))
    for gi in special_order:
        if not place_free(gi):
            return None
    # 3) 단계별: ① 리더 후보(책임자/매니저) 분산 → ② 분위기메이커 확보 → ③ 나머지
    rest = [gi for gi in range(len(groups))
            if not group_special[gi] and gi not in group_pin]

    def is_leader_g(gi):
        return grp_ds(gi, DISP_OWNER) > 0 or grp_ds(gi, DISP_MANAGER) > 0

    def is_mood_g(gi):
        return grp_ds(gi, DISP_MOOD) > 0

    leader_g = sorted((gi for gi in rest if is_leader_g(gi)),
                      key=lambda gi: (-(grp_ds(gi, DISP_OWNER) + grp_ds(gi, DISP_MANAGER)),
                                      -len(groups[gi]), rng.random()))
    mood_g = sorted((gi for gi in rest if not is_leader_g(gi) and is_mood_g(gi)),
                    key=lambda gi: (-grp_ds(gi, DISP_MOOD), -len(groups[gi]), rng.random()))
    other_g = sorted((gi for gi in rest if not is_leader_g(gi) and not is_mood_g(gi)),
                     key=lambda gi: (-len(groups[gi]), rng.random()))
    for gi in leader_g:
        if not place_free(gi, leader_bias):
            return None
    for gi in mood_g:
        if not place_free(gi, mood_bias):
            return None
    for gi in other_g:
        if not place_free(gi):
            return None
    return assign


def _partition_from_assignment(
    students: list[Student], assign: list[int], n_teams: int
) -> list[list[Student]]:
    teams: list[list[Student]] = [[] for _ in range(n_teams)]
    for stu, t in zip(students, assign):
        teams[t].append(stu)
    return teams


def _signature(teams: list[list[Student]]) -> tuple:
    return tuple(sorted(tuple(sorted(m.id for m in t)) for t in teams))


def _local_search(
    students: list[Student],
    assign: list[int],
    sizes: list[int],
    graph: RelationshipGraph,
    weights: Weights,
    rng: random.Random,
    max_iter: int,
    force_together: set[tuple[str, str]],
    force_separate: set[tuple[str, str]],
    pinned: Optional[set[int]] = None,
    special_idx: Optional[set[int]] = None,
) -> tuple[list[int], ScoreBreakdown]:
    """두 학생의 팀을 맞교환하며 점수를 개선하는 first-improvement 지역탐색.

    pinned: 고정된 학생 인덱스 집합(스왑에서 제외).
    special_idx: 특수 태그 인덱스 — 스왑 후 한 팀에 2명이 되면 거부(하드).
    """
    pinned = pinned or set()
    special_idx = special_idx or set()
    n_teams = len(sizes)

    def special_violation(a) -> bool:
        # 각 팀의 특수 태그 수가 2 이상이면 위반
        cnt = [0] * n_teams
        for i in special_idx:
            cnt[a[i]] += 1
            if cnt[a[i]] > 1:
                return True
        return False

    def score(a):
        return score_partition(
            _partition_from_assignment(students, a, n_teams), graph, weights,
            force_together=force_together, force_separate=force_separate)

    best = score(assign)
    n = len(students)

    for _ in range(max_iter):
        improved = False
        order = list(range(n))
        rng.shuffle(order)
        for ii in range(n):
            i = order[ii]
            if i in pinned:
                continue
            for jj in range(ii + 1, n):
                j = order[jj]
                if j in pinned or assign[i] == assign[j]:
                    continue
                assign[i], assign[j] = assign[j], assign[i]
                if special_idx and (i in special_idx or j in special_idx) \
                        and special_violation(assign):
                    assign[i], assign[j] = assign[j], assign[i]  # 특수 태그 위반 → 거부
                    continue
                cand = score(assign)
                if cand.total > best.total + 1e-9:
                    best = cand
                    improved = True
                else:
                    assign[i], assign[j] = assign[j], assign[i]  # 되돌림
            if improved:
                break
        if not improved:
            break
    return assign, best


def build_recommendations(
    students: list[Student],
    graph: RelationshipGraph,
    *,
    teams: int | None = None,
    sizes: list[int] | None = None,
    weights: Weights | None = None,
    force_together: Optional[set[tuple[str, str]]] = None,
    force_separate: Optional[set[tuple[str, str]]] = None,
    pins: Optional[dict[str, int]] = None,
    n_options: int = 3,
    restarts: int = 60,
    max_iter: int = 40,
    seed: int = 42,
) -> list[Recommendation]:
    """서로 다른 상위 추천안 n_options개를 생성.

    pins: {학생id: 팀인덱스} — 지정 학생을 해당 팀에 고정(부분 재편성).
    """
    weights = weights or Weights()
    force_together = force_together or set()
    force_separate = force_separate or set()
    pins = pins or {}
    size_list = sizes_for(len(students), teams=teams, sizes=sizes)
    n_teams = len(size_list)
    rng = random.Random(seed)

    groups = validate_constraints(students, size_list,
                                  force_together, force_separate, pins)
    idx = {s.id: i for i, s in enumerate(students)}
    pinned_idx = {idx[pid] for pid in pins}
    special_idx = {i for i, s in enumerate(students) if s.special}

    found: dict[tuple, Recommendation] = {}
    for _ in range(restarts):
        assign = _seed_assignment(students, size_list, groups,
                                  force_separate, rng, pins, special_idx)
        if assign is None:
            raise ValueError("강제 제약/핀/특수 태그를 만족하는 초기 배치를 찾지 못했습니다. "
                             "팀 크기나 제약을 조정하세요.")
        assign, sb = _local_search(
            students, assign, size_list, graph, weights, rng, max_iter,
            force_together, force_separate, pinned_idx, special_idx)
        partition = _partition_from_assignment(students, assign, n_teams)
        sig = _signature(partition)
        team_objs = [Team(index=i, members=partition[i]) for i in range(n_teams)]
        leaders, deputies = designate_leaders(partition)
        rec = Recommendation(teams=team_objs, score=sb, signature=sig,
                             leader_by_team=leaders, deputy_by_team=deputies)
        if sig not in found or sb.total > found[sig].score.total:
            found[sig] = rec

    ranked = sorted(found.values(), key=lambda r: r.score.total, reverse=True)
    return ranked[:n_options]
