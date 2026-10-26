from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import func, select
from app.db import SessionLocal
from app.models import Item, PointLedger, TreeEquipment, User, uid
from app.tree import seed_tree_items
from app.tree_catalog import CATALOG, GROWTH_STAGES, growth, slot_group, slot_unlocked


@pytest.fixture
def catalog():
    with SessionLocal.begin() as db:
        seed_tree_items(db)


def earn(amount, email="user@example.com"):
    """Simulate approved reports: a + ledger entry and the matching balance."""
    with SessionLocal.begin() as db:
        user = db.scalar(select(User).where(User.email == email))
        db.add(PointLedger(user_id=user.id, dedupe_key=f"test:{uid()}", amount=amount, reason="제보 승인"))
        user.points += amount


def tree(client, auth):
    response = client.get("/api/me/tree", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


def slots(state):
    return {s["slot"]: s for s in state["slots"]}


def test_growth_thresholds_live_in_one_constant():
    assert [key for key, _, _ in GROWTH_STAGES] == ["sprout", "sapling", "young", "grown"]
    assert growth(0)["stage"] == "sprout"
    assert growth(59)["stage"] == "sprout" and growth(59)["remaining"] == 1
    assert growth(60)["stage"] == "sapling"
    assert growth(499)["stage"] == "young" and growth(499)["next_stage"] == "grown"
    top = growth(10_000)
    assert top["stage"] == "grown" and top["next_stage"] is None and top["remaining"] == 0
    assert slot_group("branch-3") == "branch" and slot_group("decoration") == "decoration"


def test_slots_unlock_by_stage():
    assert [s for s in ("ground", "background", "branch-1", "branch-3", "topper") if slot_unlocked(s, "sprout")] == ["ground", "background"]
    assert slot_unlocked("branch-2", "sapling") and not slot_unlocked("branch-3", "sapling")
    assert slot_unlocked("branch-4", "young") and not slot_unlocked("topper", "young")
    assert slot_unlocked("topper", "grown")


def test_catalog_seed_is_idempotent_and_moves_legacy_items(client, auth):
    with SessionLocal.begin() as db:  # conftest seeds the old 'decoration' ribbon
        user_id = db.scalar(select(User.id).where(User.email == "user@example.com"))
        db.add(TreeEquipment(user_id=user_id, slot="decoration", item_id="ribbon"))
    for _ in range(3):
        with SessionLocal.begin() as db:
            seed_tree_items(db)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Item)) == len(CATALOG)
        assert db.get(Item, "ribbon").slot == "topper"
        assert db.get(TreeEquipment, (user_id, "topper")).item_id == "ribbon"
        assert db.get(TreeEquipment, (user_id, "decoration")) is None
    counts = {}
    for item in CATALOG:
        counts[item.group] = counts.get(item.group, 0) + 1
    assert counts == {"species": 4, "topper": 3, "branch": 6, "ground": 6, "background": 5}


def test_new_user_starts_as_free_maple_sprout(client, auth, catalog):
    state = tree(client, auth)
    assert state["species"] == "maple"
    assert state["growth"]["stage"] == "sprout" and state["growth"]["remaining"] == 60
    s = slots(state)
    assert s["ground"]["unlocked"] and s["background"]["unlocked"]
    assert not s["branch-1"]["unlocked"] and s["branch-1"]["unlock_stage"] == "sapling"
    assert not s["topper"]["unlocked"] and s["topper"]["unlock_stage"] == "grown"
    items = {i["id"]: i for i in client.get("/api/items", headers=auth).json()}
    assert items["tree-maple"]["owned"] and items["tree-ginkgo"]["owned"] and items["bg-hanji"]["owned"]
    assert not items["tree-cherry"]["owned"] and items["tree-cherry"]["price"] == 120
    assert items["snowman"]["tags"] == ["xmas"] and items["bg-snow-night"]["effect"] == "snow"
    assert items["fairy-lights"]["group"] == "branch" and items["fairy-lights"]["slot"] == "branch"


def test_free_items_need_no_purchase_record(client, auth, catalog):
    assert client.put("/api/me/items/tree-ginkgo", headers=auth).json() == {"owned": True, "balance": 0}
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(PointLedger)) == 0
    response = client.put("/api/me/tree", headers=auth, json={"species": "ginkgo", "slots": {"background": "bg-hanji"}})
    assert response.status_code == 200, response.text
    assert response.json()["species"] == "ginkgo"


def test_buying_items_never_shrinks_the_tree(client, auth, catalog):
    earn(220)  # young
    assert tree(client, auth)["growth"]["stage"] == "young"
    for item in ("tree-cherry", "bench", "fairy-lights"):  # 120 + 60 + 40 = 220: balance hits 0
        assert client.put(f"/api/me/items/{item}", headers=auth).status_code == 200
    state = tree(client, auth)
    assert state["balance"] == 0
    assert state["growth"]["earned"] == 220 and state["growth"]["stage"] == "young"


def test_purchase_rules_unchanged(client, auth, catalog):
    earn(100)
    assert client.put("/api/me/items/tree-xmas", headers=auth).status_code == 409  # 180 > 100
    assert client.put("/api/me/items/bench", headers=auth).json()["balance"] == 40
    assert client.put("/api/me/items/bench", headers=auth).json()["balance"] == 40  # no double charge
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(PointLedger).where(PointLedger.amount < 0)) == 1


def test_locked_species_and_slots_are_rejected(client, auth, catalog):
    earn(70)  # sapling
    assert client.put("/api/me/tree", headers=auth, json={"species": "cherry"}).status_code == 403  # not unlocked
    client.put("/api/me/items/fairy-lights", headers=auth)
    assert client.put("/api/me/tree", headers=auth, json={"slots": {"branch-3": "fairy-lights"}}).status_code == 422
    assert client.put("/api/me/tree", headers=auth, json={"slots": {"branch-9": "fairy-lights"}}).status_code == 422
    assert client.put("/api/me/tree", headers=auth, json={"slots": {"ground": "fairy-lights"}}).status_code == 422
    assert client.put("/api/me/tree", headers=auth, json={"species": "oak"}).status_code == 422
    assert client.put("/api/me/tree/equipment/branch-3", headers=auth, json={"item_id": "fairy-lights"}).status_code == 422
    assert client.put("/api/me/tree/equipment/branch", headers=auth, json={"item_id": "fairy-lights"}).status_code == 422


def test_one_branch_item_can_hang_on_several_branches(client, auth, catalog):
    earn(260)  # young: branch 1-4 open
    client.put("/api/me/items/fairy-lights", headers=auth)
    body = {"slots": {f"branch-{n}": "fairy-lights" for n in range(1, 5)}}
    state = client.put("/api/me/tree", headers=auth, json=body).json()
    assert [s["item_id"] for s in state["slots"] if s["group"] == "branch"] == ["fairy-lights"] * 4
    # the classic single-slot endpoint understands numbered branch slots too
    assert client.put("/api/me/tree/equipment/branch-2", headers=auth, json={"item_id": "fairy-lights"}).status_code == 200


def test_switching_species_keeps_but_hides_unfitting_items(client, auth, catalog):
    earn(600)  # grown: everything open, 600P to spend
    for item in ("tree-xmas", "snowman", "bench", "ornament"):
        assert client.put(f"/api/me/items/{item}", headers=auth).status_code == 200
    saved = client.put("/api/me/tree", headers=auth, json={"species": "xmas", "slots": {"ground": "snowman", "branch-1": "ornament"}})
    assert saved.status_code == 200, saved.text
    state = client.put("/api/me/tree", headers=auth, json={"species": "maple"}).json()
    s = slots(state)
    assert s["ground"]["item_id"] == "snowman" and s["ground"]["visible"] is False  # kept, hidden
    assert s["branch-1"]["item_id"] == "ornament" and s["branch-1"]["visible"] is False
    # re-sending the hidden item unchanged is fine; newly adding an unfitting one is not
    assert client.put("/api/me/tree", headers=auth, json={"slots": {"ground": "snowman"}}).status_code == 200
    assert client.put("/api/me/tree", headers=auth, json={"slots": {"branch-2": "ornament"}}).status_code == 422
    back = client.put("/api/me/tree", headers=auth, json={"species": "xmas"}).json()
    assert slots(back)["ground"]["visible"] is True


def test_save_is_all_or_nothing_and_null_unequips(client, auth, catalog):
    earn(100)
    client.put("/api/me/items/bench", headers=auth)
    assert client.put("/api/me/tree", headers=auth, json={"slots": {"ground": "bench"}}).status_code == 200
    bad = client.put("/api/me/tree", headers=auth, json={"species": "ginkgo", "slots": {"ground": None, "background": "bg-snow-night"}})
    assert bad.status_code == 403  # background not owned → nothing changes
    state = tree(client, auth)
    assert state["species"] == "maple" and slots(state)["ground"]["item_id"] == "bench"
    cleared = client.put("/api/me/tree", headers=auth, json={"slots": {"ground": None}}).json()
    assert slots(cleared)["ground"]["item_id"] is None


def test_concurrent_saves_leave_one_consistent_row(client, auth, catalog):
    earn(100)
    for item in ("bench", "mushroom"):
        assert client.put(f"/api/me/items/{item}", headers=auth).status_code == 200
    with ThreadPoolExecutor(4) as pool:
        codes = list(pool.map(lambda item: client.put("/api/me/tree", headers=auth, json={"slots": {"ground": item}}).status_code,
                              ["bench", "mushroom", "bench", "mushroom"]))
    assert set(codes) == {200}
    with SessionLocal() as db:
        rows = db.scalars(select(TreeEquipment).where(TreeEquipment.slot == "ground")).all()
        assert len(rows) == 1 and rows[0].item_id in {"bench", "mushroom"}


def test_tree_requires_login(client, catalog):
    assert client.get("/api/me/tree").status_code == 401
    assert client.put("/api/me/tree", json={}).status_code == 401
