"""나만의 나무: 성장 계산, 장착 상태 조회·저장, 아이템 시드. 기존 테이블만 쓴다."""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Item, PointLedger, TreeEquipment, User, UserItem
from .tree_catalog import (
    BY_ID,
    CATALOG,
    DEFAULT_SPECIES,
    LEGACY_SLOTS,
    SLOTS,
    SPECIES,
    SPECIES_ITEM,
    fits,
    free,
    growth,
    slot_group,
    slot_unlocked,
)


def earned_points(db: Session, user_id: str) -> int:
    """누적 적립 = 원장의 + 항목 합. 구매(−)는 빼지 않으므로 나무는 작아지지 않는다."""
    return int(
        db.scalar(select(func.coalesce(func.sum(PointLedger.amount), 0)).where(PointLedger.user_id == user_id, PointLedger.amount > 0))
        or 0
    )


def owned_ids(db: Session, user_id: str) -> set[str]:
    bought = set(db.scalars(select(UserItem.item_id).where(UserItem.user_id == user_id)))
    return bought | set(db.scalars(select(Item.id).where(Item.price == 0)))


def equipment(db: Session, user_id: str) -> dict[str, str]:
    return dict(db.execute(select(TreeEquipment.slot, TreeEquipment.item_id).where(TreeEquipment.user_id == user_id)).all())


def current_species(equipped: dict[str, str]) -> str:
    item = BY_ID.get(equipped.get("species", ""))
    return item.species if item and item.species else DEFAULT_SPECIES


def tree_state(db: Session, user: User) -> dict:
    equipped = equipment(db, user.id)
    species = current_species(equipped)
    grow = growth(earned_points(db, user.id))
    slots = []
    for slot, (group, unlock_stage) in SLOTS.items():
        if slot == "species":
            continue
        item_id = equipped.get(slot)
        slots.append({
            "slot": slot,
            "group": group,
            "unlocked": slot_unlocked(slot, grow["stage"]),
            "unlock_stage": unlock_stage,
            "item_id": item_id,
            # 이 종류에 안 어울리는 장착은 숨기기만 하고 기록은 남긴다.
            "visible": bool(item_id) and fits(item_id, species),
        })
    return {"species": species, "balance": user.points, "growth": grow, "slots": slots}


def check_equip(db: Session, user_id: str, slot: str, item_id: str, owned: set[str] | None = None, stage: str | None = None) -> Item:
    """한 슬롯 장착 검사: 슬롯 그룹·해금·보유. 기존 /equipment 엔드포인트와 저장이 같이 쓴다."""
    item = db.get(Item, item_id)
    # A group that spans several slots ("branch") is not itself a slot: use branch-1..4.
    if slot not in SLOTS and slot in {group for group, _ in SLOTS.values()}:
        raise HTTPException(422, "아이템 장착 위치가 올바르지 않습니다.")
    if item is None or item.slot != slot_group(slot):
        raise HTTPException(422, "아이템 장착 위치가 올바르지 않습니다.")
    if slot in SLOTS:
        stage = stage or growth(earned_points(db, user_id))["stage"]
        if not slot_unlocked(slot, stage):
            raise HTTPException(422, "나무가 더 자라야 열리는 자리입니다.")
    owned = owned if owned is not None else owned_ids(db, user_id)
    if item.id not in owned and not free(item.price):
        raise HTTPException(403, "보유한 아이템만 장착할 수 있습니다.")
    return item


def save_tree(db: Session, user: User, species: str | None, slots: dict[str, str | None]) -> dict:
    """종류와 슬롯을 한 번에 저장한다. 하나라도 틀리면 아무것도 바꾸지 않는다(호출자가 commit)."""
    unknown = [slot for slot in slots if slot not in SLOTS or slot == "species"]
    if unknown:
        raise HTTPException(422, f"알 수 없는 장착 자리입니다: {', '.join(unknown)}")
    if species is not None and species not in SPECIES:
        raise HTTPException(422, "알 수 없는 나무 종류입니다.")
    equipped = equipment(db, user.id)
    owned = owned_ids(db, user.id)
    stage = growth(earned_points(db, user.id))["stage"]
    changes: dict[str, str | None] = {}
    if species is not None:
        species_item = SPECIES_ITEM[species]
        check_equip(db, user.id, "species", species_item, owned, stage)
        changes["species"] = species_item
    after_species = species or current_species(equipped)
    for slot, item_id in slots.items():
        if not item_id:
            changes[slot] = None
            continue
        check_equip(db, user.id, slot, item_id, owned, stage)
        # 새로 다는 아이템만 종류를 검사한다. 이미 달려 있던(숨겨진) 장착은 그대로 보존.
        if item_id != equipped.get(slot) and not fits(item_id, after_species):
            raise HTTPException(422, f"{BY_ID[item_id].name}은(는) 이 나무에 어울리지 않아요.")
        changes[slot] = item_id
    for slot, item_id in changes.items():
        row = db.get(TreeEquipment, (user.id, slot))
        if item_id is None:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(TreeEquipment(user_id=user.id, slot=slot, item_id=item_id))
        else:
            row.item_id = item_id
    db.flush()
    return tree_state(db, user)


def item_extras(item_id: str) -> dict:
    """/api/items에 덧붙일 카탈로그 정보(그룹·어울리는 종류·효과)."""
    item = BY_ID.get(item_id)
    if item is None:
        return {"tags": list(SPECIES), "effect": None, "species": None}
    return {"tags": list(item.tags) if item.group != "species" else [], "effect": item.effect, "species": item.species}


def seed_tree_items(db: Session) -> None:
    """카탈로그를 items에 id 기준으로 맞춘다(여러 번 실행해도 중복 없음).
    예전 decoration 장착은 비어 있는 새 슬롯으로 옮긴다."""
    for entry in CATALOG:
        row = db.get(Item, entry.id)
        values = {"name": entry.name, "price": entry.price, "slot": entry.group, "icon": entry.icon}
        if row is None:
            db.add(Item(id=entry.id, **values))
        else:
            for key, value in values.items():
                setattr(row, key, value)
    db.flush()
    for old, new in LEGACY_SLOTS.items():
        for row in db.scalars(select(TreeEquipment).where(TreeEquipment.slot == old)).all():
            # Only move when the new slot is free and the item now belongs there; otherwise keep the row as is.
            if db.get(TreeEquipment, (row.user_id, new)) is None and slot_group(new) == db.get(Item, row.item_id).slot:
                db.add(TreeEquipment(user_id=row.user_id, slot=new, item_id=row.item_id))
                db.delete(row)
    db.flush()
