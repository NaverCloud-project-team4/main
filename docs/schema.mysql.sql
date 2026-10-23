CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 947f5a336531

CREATE TABLE items (
    id VARCHAR(40) NOT NULL,
    name VARCHAR(80) NOT NULL,
    price INTEGER NOT NULL,
    slot VARCHAR(30) NOT NULL,
    icon VARCHAR(20) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_item_price CHECK (price >= 0)
);

CREATE TABLE seasons (
    id VARCHAR(20) NOT NULL,
    name VARCHAR(80) NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE users (
    id VARCHAR(36) NOT NULL,
    email VARCHAR(254) NOT NULL,
    nickname VARCHAR(30) NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    points INTEGER NOT NULL,
    last_report_at DATETIME,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_user_points CHECK (points >= 0),
    UNIQUE (email)
);

CREATE TABLE zones (
    id VARCHAR(40) NOT NULL,
    name VARCHAR(80) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    radius_m INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE reports (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    zone_id VARCHAR(40) NOT NULL,
    season_id VARCHAR(20) NOT NULL,
    status VARCHAR(24) NOT NULL,
    stage VARCHAR(16) NOT NULL,
    species VARCHAR(16) NOT NULL,
    description VARCHAR(1000) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    object_key VARCHAR(255) NOT NULL,
    photo_hash VARCHAR(64) NOT NULL,
    request_key VARCHAR(100) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    demo_outcome VARCHAR(16),
    reason VARCHAR(500),
    like_count INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    approved_at DATETIME,
    PRIMARY KEY (id),
    CONSTRAINT ck_report_status CHECK (status IN ('PENDING_UPLOAD','PENDING_AI','APPROVED','REVIEW','REJECTED','UPLOAD_FAILED')),
    CONSTRAINT ck_report_likes CHECK (like_count >= 0),
    FOREIGN KEY(season_id) REFERENCES seasons (id),
    FOREIGN KEY(user_id) REFERENCES users (id),
    FOREIGN KEY(zone_id) REFERENCES zones (id),
    UNIQUE (object_key),
    CONSTRAINT uq_report_request UNIQUE (user_id, request_key)
);

CREATE INDEX ix_report_feed ON reports (status, created_at, id);

CREATE INDEX ix_report_popular ON reports (status, like_count, id);

CREATE INDEX ix_report_user ON reports (user_id, created_at);

CREATE INDEX ix_report_zone ON reports (zone_id, status, created_at);

CREATE TABLE tree_equipment (
    user_id VARCHAR(36) NOT NULL,
    slot VARCHAR(30) NOT NULL,
    item_id VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, slot),
    FOREIGN KEY(item_id) REFERENCES items (id),
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE user_items (
    user_id VARCHAR(36) NOT NULL,
    item_id VARCHAR(40) NOT NULL,
    purchased_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY(item_id) REFERENCES items (id),
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE zone_activity (
    zone_id VARCHAR(40) NOT NULL,
    report_count INTEGER NOT NULL,
    reporter_count INTEGER NOT NULL,
    like_count INTEGER NOT NULL,
    score INTEGER NOT NULL,
    tree_level INTEGER NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (zone_id),
    FOREIGN KEY(zone_id) REFERENCES zones (id)
);

CREATE TABLE point_ledger (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    report_id VARCHAR(36),
    dedupe_key VARCHAR(140) NOT NULL,
    amount INTEGER NOT NULL,
    reason VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(report_id) REFERENCES reports (id),
    FOREIGN KEY(user_id) REFERENCES users (id),
    UNIQUE (dedupe_key)
);

CREATE INDEX ix_point_ledger_user_id ON point_ledger (user_id);

CREATE TABLE report_likes (
    report_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (report_id, user_id),
    FOREIGN KEY(report_id) REFERENCES reports (id),
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE report_verifications (
    report_id VARCHAR(36) NOT NULL,
    model VARCHAR(60) NOT NULL,
    prompt_version VARCHAR(30) NOT NULL,
    decision VARCHAR(16) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    verified_at DATETIME NOT NULL,
    reviewer_id VARCHAR(36),
    reviewed_at DATETIME,
    review_reason VARCHAR(500),
    PRIMARY KEY (report_id),
    FOREIGN KEY(report_id) REFERENCES reports (id),
    FOREIGN KEY(reviewer_id) REFERENCES users (id)
);

CREATE TABLE verification_jobs (
    report_id VARCHAR(36) NOT NULL,
    state VARCHAR(20) NOT NULL,
    attempts INTEGER NOT NULL,
    lease_token VARCHAR(36),
    lease_until DATETIME,
    next_attempt_at DATETIME NOT NULL,
    last_error VARCHAR(500),
    PRIMARY KEY (report_id),
    FOREIGN KEY(report_id) REFERENCES reports (id)
);

CREATE INDEX ix_job_due ON verification_jobs (state, next_attempt_at);

CREATE TABLE zone_status (
    zone_id VARCHAR(40) NOT NULL,
    stage VARCHAR(16) NOT NULL,
    latest_report_id VARCHAR(36),
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (zone_id),
    FOREIGN KEY(latest_report_id) REFERENCES reports (id),
    FOREIGN KEY(zone_id) REFERENCES zones (id)
);

INSERT INTO alembic_version (version_num) VALUES ('947f5a336531');

-- Running upgrade 947f5a336531 -> 2b8c341f902a

ALTER TABLE zones ADD COLUMN district_code VARCHAR(5);

ALTER TABLE zones ADD COLUMN boundary JSON;

ALTER TABLE zones ADD COLUMN active BOOL NOT NULL DEFAULT true;

CREATE UNIQUE INDEX uq_zone_district_code ON zones (district_code);

UPDATE alembic_version SET version_num='2b8c341f902a' WHERE alembic_version.version_num = '947f5a336531';

-- Running upgrade 2b8c341f902a -> 4a7d1c6e8f02

ALTER TABLE reports ADD COLUMN photo_source VARCHAR(16) NOT NULL DEFAULT 'legacy';

ALTER TABLE reports ADD COLUMN location_source VARCHAR(16) NOT NULL DEFAULT 'legacy';

UPDATE alembic_version SET version_num='4a7d1c6e8f02' WHERE alembic_version.version_num = '2b8c341f902a';
