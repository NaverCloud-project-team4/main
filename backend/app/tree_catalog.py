"""나만의 나무: 성장 단계·슬롯·아이템 카탈로그. DB 없이 쓰는 상수와 순수 함수만 둔다.

DB의 items 행은 id·이름·가격·슬롯(그룹)·아이콘만 가진다. 어울리는 나무 종류(tags)와
배경 효과(effect)는 스키마를 바꾸지 않도록 여기 카탈로그에서 관리하고 API가 합쳐서 내보낸다.
"""

from dataclasses import dataclass

# 성장 단계는 잔액이 아니라 누적 적립(point_ledger의 + 항목 합) 기준. 기준값은 여기서만 조절한다.
GROWTH_STAGES = (("sprout", "새싹", 0), ("sapling", "묘목", 60), ("young", "어린나무", 200), ("grown", "큰나무", 500))
STAGE_KEYS = tuple(key for key, _, _ in GROWTH_STAGES)

SPECIES = ("maple", "ginkgo", "cherry", "xmas")
DEFAULT_SPECIES = "maple"
ALL = SPECIES

# 장착 슬롯 → (아이템 그룹, 열리는 성장 단계). species는 항상 열려 있다.
SLOTS = {
    "species": ("species", "sprout"),
    "background": ("background", "sprout"),
    "ground": ("ground", "sprout"),
    "branch-1": ("branch", "sapling"),
    "branch-2": ("branch", "sapling"),
    "branch-3": ("branch", "young"),
    "branch-4": ("branch", "young"),
    "topper": ("topper", "grown"),
}
DECOR_SLOTS = tuple(slot for slot in SLOTS if slot != "species")
# 예전 화면의 슬롯. 시드가 기존 장착을 새 슬롯으로 옮긴다.
LEGACY_SLOTS = {"decoration": "topper"}


@dataclass(frozen=True)
class CatalogItem:
    id: str
    name: str
    price: int
    group: str
    icon: str
    tags: tuple[str, ...] = ALL
    effect: str | None = None
    species: str | None = None  # group == "species"일 때 나무 종류 키


# 가격은 시연용 상수. B안: 단풍·은행은 무료, 벚꽃·크리스마스는 포인트로 해금.
CATALOG = (
    CatalogItem("tree-maple", "단풍나무", 0, "species", "🍁", species="maple"),
    CatalogItem("tree-ginkgo", "은행나무", 0, "species", "💛", species="ginkgo"),
    CatalogItem("tree-cherry", "벚나무", 120, "species", "🌸", species="cherry"),
    CatalogItem("tree-xmas", "크리스마스 트리", 180, "species", "🎄", species="xmas"),
    # 꼭대기 (star·ribbon은 예전 decoration 아이템을 옮긴 것)
    CatalogItem("star", "반짝이는 별", 60, "topper", "⭐"),
    CatalogItem("ribbon", "리본 매듭", 40, "topper", "🎀"),
    CatalogItem("bird", "작은 새", 50, "topper", "🐦", ("maple", "ginkgo", "cherry")),
    # 가지 장식 (한 번 사면 여러 가지에 달 수 있다)
    CatalogItem("ornament", "오너먼트 볼", 30, "branch", "🔴", ("xmas",)),
    CatalogItem("fairy-lights", "꼬마전구", 40, "branch", "✨"),
    CatalogItem("cheongsachorong", "청사초롱", 45, "branch", "🏮", ("maple", "ginkgo")),
    CatalogItem("maple-mobile", "단풍잎 모빌", 35, "branch", "🍁", ("maple",)),
    CatalogItem("cherry-ribbon", "벚꽃 리본", 35, "branch", "🌸", ("cherry",)),
    CatalogItem("gotgam", "곶감 줄", 30, "branch", "🟠", ("maple", "ginkgo")),
    # 바닥 소품
    CatalogItem("gift", "선물상자", 40, "ground", "🎁", ("xmas",)),
    CatalogItem("snowman", "눈사람", 50, "ground", "⛄", ("xmas",)),
    CatalogItem("leaf-pile", "낙엽 더미", 20, "ground", "🍂", ("maple", "ginkgo")),
    CatalogItem("bench", "나무 벤치", 60, "ground", "🪑"),
    CatalogItem("squirrel", "다람쥐", 45, "ground", "🐿️", ("maple", "ginkgo", "cherry")),
    CatalogItem("mushroom", "작은 버섯", 20, "ground", "🍄"),
    # 배경 (+효과)
    CatalogItem("bg-hanji", "한지", 0, "background", "📜"),
    CatalogItem("bg-autumn-dusk", "가을 노을", 80, "background", "🌇", ("maple", "ginkgo"), "leaves"),
    CatalogItem("bg-snow-night", "밤하늘 눈", 100, "background", "🌌", effect="snow"),
    CatalogItem("bg-spring-river", "봄 강가", 80, "background", "🌊", ("cherry",), "petals"),
    CatalogItem("bg-summer-night", "여름밤", 90, "background", "🌙", effect="fireflies"),
)
BY_ID = {item.id: item for item in CATALOG}
SPECIES_ITEM = {item.species: item.id for item in CATALOG if item.species}


def slot_group(slot: str) -> str:
    """장착 슬롯의 아이템 그룹. branch-1..4 → branch. 모르는 슬롯(예전 decoration 등)은 자기 이름."""
    return SLOTS[slot][0] if slot in SLOTS else slot


def stage_index(earned: int) -> int:
    index = 0
    for i, (_, _, threshold) in enumerate(GROWTH_STAGES):
        if earned >= threshold:
            index = i
    return index


def growth(earned: int) -> dict:
    """누적 적립 포인트 → 현재 단계와 다음 단계까지 남은 포인트."""
    earned = max(0, int(earned))
    index = stage_index(earned)
    key, label, _ = GROWTH_STAGES[index]
    following = GROWTH_STAGES[index + 1] if index + 1 < len(GROWTH_STAGES) else None
    return {
        "earned": earned,
        "stage": key,
        "stage_label": label,
        "stage_index": index,
        "next_stage": following[0] if following else None,
        "next_at": following[2] if following else None,
        "remaining": following[2] - earned if following else 0,
        "thresholds": {k: threshold for k, _, threshold in GROWTH_STAGES},
    }


def slot_unlocked(slot: str, stage: str) -> bool:
    return slot in SLOTS and STAGE_KEYS.index(stage) >= STAGE_KEYS.index(SLOTS[slot][1])


def fits(item_id: str, species: str) -> bool:
    """이 나무 종류에 어울리는 아이템인가. 카탈로그 밖 아이템은 공용으로 본다."""
    item = BY_ID.get(item_id)
    return item is None or item.group == "species" or species in item.tags


def free(price: int) -> bool:
    """가격 0인 아이템(무료 나무·한지 배경)은 구매 기록 없이 보유한 것으로 본다."""
    return price == 0
