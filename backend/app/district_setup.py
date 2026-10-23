"""Idempotent Seoul district setup without changing user points/likes/verification."""

import sqlalchemy as sa
from .geography import seoul_boundaries, district_at


def sync_seoul_districts(connection):
    # Core reflection keeps migration writes independent of ORM flush/transaction state.
    metadata = sa.MetaData()
    zones = sa.Table("zones", metadata, autoload_with=connection)
    reports = sa.Table("reports", metadata, autoload_with=connection)
    statuses = sa.Table("zone_status", metadata, autoload_with=connection)
    activities = sa.Table("zone_activity", metadata, autoload_with=connection)
    from .models import now

    timestamp = now()
    features = seoul_boundaries()["features"]
    ids = [f["id"] for f in features]
    # Legacy rows are retained for historical references, but cannot accept reports.
    connection.execute(zones.update().where(zones.c.id.not_in(ids)).values(active=False, district_code=None))
    for feature in features:
        properties = feature["properties"]
        values = dict(
            name=properties["name"],
            latitude=properties["center"][1],
            longitude=properties["center"][0],
            district_code=properties["district_code"],
            boundary=feature["geometry"],
            active=True,
            radius_m=0,
        )
        zid = feature["id"]
        if connection.scalar(sa.select(zones.c.id).where(zones.c.id == zid)):
            connection.execute(zones.update().where(zones.c.id == zid).values(**values))
        else:
            connection.execute(zones.insert().values(id=zid, revision=0, **values))
        if not connection.scalar(sa.select(statuses.c.zone_id).where(statuses.c.zone_id == zid)):
            connection.execute(statuses.insert().values(zone_id=zid, stage="UNKNOWN", updated_at=timestamp))
        if not connection.scalar(sa.select(activities.c.zone_id).where(activities.c.zone_id == zid)):
            connection.execute(
                activities.insert().values(
                    zone_id=zid,
                    report_count=0,
                    reporter_count=0,
                    like_count=0,
                    score=0,
                    tree_level=0,
                    updated_at=timestamp,
                )
            )
    for report in connection.execute(
        sa.select(reports.c.id, reports.c.zone_id, reports.c.latitude, reports.c.longitude)
    ):
        district = district_at(report.latitude, report.longitude)
        if district and report.zone_id != district["id"]:
            connection.execute(reports.update().where(reports.c.id == report.id).values(zone_id=district["id"]))
    # Clear stale pointers/counts for inactive legacy areas. Rebuild active district caches in cli init.
    connection.execute(statuses.update().values(latest_report_id=None, stage="UNKNOWN", updated_at=timestamp))
    connection.execute(
        activities.update().values(
            report_count=0, reporter_count=0, like_count=0, score=0, tree_level=0, updated_at=timestamp
        )
    )
    # Keep this data migration independent of ORM columns added by later revisions.
    # Match refresh_zone's current aggregation rules using reflected stable columns.
    from datetime import timedelta
    from .config import get_settings

    cutoff = timestamp - timedelta(days=get_settings().activity_days)
    for zid in ids:
        where = (reports.c.zone_id == zid, reports.c.status == "APPROVED", reports.c.created_at >= cutoff)
        count, people, likes = map(
            int,
            connection.execute(
                sa.select(
                    sa.func.count(reports.c.id),
                    sa.func.count(sa.func.distinct(reports.c.user_id)),
                    sa.func.coalesce(sa.func.sum(reports.c.like_count), 0),
                ).where(*where)
            ).one(),
        )
        latest = connection.execute(
            sa.select(reports.c.id, reports.c.stage)
            .where(*where)
            .order_by(reports.c.created_at.desc(), reports.c.id.desc())
            .limit(1)
        ).first()
        score = count * 2 + people * 3 + likes
        level = 3 if score >= 40 else 2 if score >= 15 else 1 if score > 0 else 0
        connection.execute(
            activities.update()
            .where(activities.c.zone_id == zid)
            .values(
                report_count=count,
                reporter_count=people,
                like_count=likes,
                score=score,
                tree_level=level,
                updated_at=timestamp,
            )
        )
        connection.execute(
            statuses.update()
            .where(statuses.c.zone_id == zid)
            .values(
                latest_report_id=latest.id if latest else None,
                stage=latest.stage if latest else "UNKNOWN",
                updated_at=timestamp,
            )
        )
