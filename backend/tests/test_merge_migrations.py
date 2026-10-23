"""Upgrade both deployed heads without losing reports, likes or point balances."""
from pathlib import Path
from datetime import datetime
import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from app.db import Base, engine


@pytest.mark.parametrize('start', ['4a7d1c6e8f02', 'b7c1d4e92a10'])
def test_both_deployed_heads_upgrade_with_history(start):
    Base.metadata.drop_all(engine)
    with engine.begin() as connection:
        connection.execute(sa.text('DROP TABLE IF EXISTS alembic_version'))
    cfg = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    command.upgrade(cfg, start)
    metadata = sa.MetaData()
    metadata.reflect(bind=engine)
    tables = metadata.tables
    at = datetime(2026, 10, 23, 0, 0)
    zone_id = 'seoul-11230' if start.startswith('4a') else 'dongdaemun'
    with engine.begin() as connection:
        zone_values = dict(id=zone_id, name='동대문구', latitude=37.5964, longitude=127.0525, radius_m=0)
        if 'revision' in tables['zones'].c:
            zone_values['revision'] = 0
        if not connection.scalar(sa.select(tables['zones'].c.id).where(tables['zones'].c.id == zone_id)):
            connection.execute(tables['zones'].insert().values(**zone_values))
        connection.execute(tables['users'].insert().values(id='merge-user', email='merge@example.com', nickname='보존',
            password_hash='unused', role='user', points=20, created_at=at))
        connection.execute(tables['seasons'].insert().values(id='2026', name='가을', starts_at=datetime(2026,1,1), ends_at=datetime(2027,1,1)))
        connection.execute(tables['reports'].insert().values(id='merge-report', user_id='merge-user', zone_id=zone_id,
            season_id='2026', status='APPROVED', stage='PEAK', species='GINKGO', description='보존할 제보',
            latitude=37.5964, longitude=127.0525, object_key='reports/merge.jpg', photo_hash='h',
            request_key='existing-key', request_fingerprint='existing-fingerprint', like_count=1, created_at=at, approved_at=at))
        connection.execute(tables['report_likes'].insert().values(report_id='merge-report',user_id='merge-user',created_at=at))
        connection.execute(tables['point_ledger'].insert().values(id='merge-points',user_id='merge-user',report_id='merge-report',
            dedupe_key='report:merge-report:approved',amount=20,reason='제보 승인',created_at=at))
        if 'forecast_spots' in tables:
            connection.execute(tables['forecast_spots'].insert().values(season_id='2026',zone_id=zone_id,name='보존 지점',
                kind='GINKGO',latitude=37.5964,longitude=127.0525,peak_date=datetime(2026,10,31).date(),source='test'))
    command.upgrade(cfg, 'head')
    with engine.connect() as connection:
        assert connection.scalar(sa.text('SELECT version_num FROM alembic_version')) == '8d5e29c410b7'
        assert connection.execute(sa.text('SELECT zone_id,description,request_fingerprint,like_count,photo_source FROM reports')).one() == (
            'dongdaemun','보존할 제보','existing-fingerprint',1,'legacy')
        assert connection.scalar(sa.text('SELECT points FROM users')) == 20
        assert connection.scalar(sa.text('SELECT count(*) FROM point_ledger')) == 1
        assert connection.scalar(sa.text('SELECT count(*) FROM report_likes')) == 1
        assert connection.scalar(sa.text('SELECT count(*) FROM zones WHERE active=1')) == 25
        assert connection.execute(sa.text('PRAGMA foreign_key_check')).all() == []
    command.upgrade(cfg, 'head')  # No repeated data conversion or rewards.
