# 시연 사진 (seed-showcase)

`python -m app.cli seed-showcase`가 이 폴더의 사진을 읽어 현재 `STORAGE_BACKEND`(local 또는 NCP Object Storage)에 올립니다.

- `ginkgo/` — 은행나무길 명소 제보에 쓰는 사진
- `maple/` — 단풍(산) 명소 제보에 쓰는 사진
- 형식: jpg · jpeg · png · webp. 파일 이름 순서대로 돌아가며 쓰고, 업로드 전에 EXIF·위치 정보를 지우고 크기를 맞춥니다.
- 폴더가 비어 있으면 `assets/sample-ginkgo.png`, `assets/sample-maple.png`를 대신 씁니다.
- 직접 찍었거나 사용 허락을 받은 사진만 넣어주세요.
