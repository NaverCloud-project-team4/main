-- 05b_forecast_spots_seed.sql
-- 서울 단풍·은행나무 예측 지점 25곳 (구마다 1곳). zone_id는 비워 두고 나중에 자동 매핑.
-- WKT는 POINT(경도 위도), SRID 0. 예상 절정일은 산림청 수종별 예측(2026-09-22 발표, 전국) 기준:
--   GINKGO 2026-10-30, MOUNTAIN 2026-10-31
-- 재실행해도 안전: UNIQUE(season_id, name)에 걸리면 kind/location/peak_date/source만 갱신하고 zone_id는 건드리지 않음.

-- [확인 필요] 활성 시즌 조회식은 가정입니다. seasons 테이블/is_active 컬럼명이 다르면 이 한 줄만 고치세요.
SET @season_id := (SELECT id FROM seasons WHERE is_active = 1 LIMIT 1);

INSERT INTO forecast_spots (season_id, zone_id, name, kind, location, peak_date, source)
VALUES
  (@season_id, NULL, '삼청동길', 'GINKGO', ST_GeomFromText('POINT(126.9819183 37.5837936)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '정동길', 'GINKGO', ST_GeomFromText('POINT(126.9754485 37.5648648)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '소월로', 'GINKGO', ST_GeomFromText('POINT(126.9814272 37.5530394)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '서울숲 은행나무숲', 'GINKGO', ST_GeomFromText('POINT(127.0374424 37.5443878)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '워커힐로', 'MOUNTAIN', ST_GeomFromText('POINT(127.1007676 37.5518658)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '회기로', 'GINKGO', ST_GeomFromText('POINT(127.057977 37.589756)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '봉수대공원', 'MOUNTAIN', ST_GeomFromText('POINT(127.0920854 37.6075262)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '안감내길', 'GINKGO', ST_GeomFromText('POINT(127.0181027 37.5892014)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '4.19로', 'MOUNTAIN', ST_GeomFromText('POINT(127.0076599 37.6484962)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '노해로', 'GINKGO', ST_GeomFromText('POINT(127.0490745 37.6553392)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '한글비석길', 'GINKGO', ST_GeomFromText('POINT(127.0743468 37.6447492)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '진흥로', 'GINKGO', ST_GeomFromText('POINT(126.9355669 37.6191594)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '연세대 은행나무길', 'GINKGO', ST_GeomFromText('POINT(126.9387066 37.5663937)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '매봉산자락길(마포)', 'MOUNTAIN', ST_GeomFromText('POINT(126.8992272 37.5662557)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '용왕산 둘레길', 'MOUNTAIN', ST_GeomFromText('POINT(126.8775 37.542222)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '등양초교 앞길', 'GINKGO', ST_GeomFromText('POINT(126.8446617 37.5648029)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '매봉산자락길(구로)', 'MOUNTAIN', ST_GeomFromText('POINT(126.8399836 37.5019874)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '호압사길', 'MOUNTAIN', ST_GeomFromText('POINT(126.9255418 37.4525466)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '여의공원로', 'GINKGO', ST_GeomFromText('POINT(126.9228132 37.5262751)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '현충원 은행나무길', 'GINKGO', ST_GeomFromText('POINT(126.9743657 37.5021599)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '관악로', 'GINKGO', ST_GeomFromText('POINT(126.952712 37.48121)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '매헌 시민의숲', 'MOUNTAIN', ST_GeomFromText('POINT(127.0356004 37.4706853)', 0), '2026-10-31', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '가로수길', 'GINKGO', ST_GeomFromText('POINT(127.0228686 37.5210566)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '위례성길', 'GINKGO', ST_GeomFromText('POINT(127.1214941 37.5206868)', 0), '2026-10-30', '산림청 수종별 예측(전국)'),
  (@season_id, NULL, '올림픽로(암사)', 'GINKGO', ST_GeomFromText('POINT(127.1298794 37.5601719)', 0), '2026-10-30', '산림청 수종별 예측(전국)')
ON DUPLICATE KEY UPDATE
  kind = VALUES(kind),
  location = VALUES(location),
  peak_date = VALUES(peak_date),
  source = VALUES(source);
