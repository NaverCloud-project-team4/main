# 부하 테스트 사진

사용자가 제공한 JPEG 7장을 원본 그대로 복사했습니다.

- `ginkgo-1.jpeg` ~ `ginkgo-3.jpeg`: 은행 사진 → `GINKGO`
- `maple-1.jpeg` ~ `maple-3.jpeg`: 단풍 사진 → `MAPLE`
- `unrelated-usagi.jpeg`: 우사기 캐릭터 → 무관 이미지 반려 검증용. API의 필수 수종은 `MIXED`로 전달하고 기대 결과 `REJECTED`는 클라이언트 기록에만 남깁니다. 서버의 AI 결과를 강제하지 않습니다.

매핑은 `scripts/loadtest/photos.example.json`에 있습니다. 단계 초깃값은 사진에 보이는 가을 색을 기준으로 `PEAK`입니다. CLOVA 승인 결과를 보장하지 않으며, 필요하면 매니페스트의 단계를 변경하세요.

생성기는 사진과 수종을 묶어서 무작위 선택합니다. 사진의 실제 촬영 장소와 별개로 서울 안의 합성 좌표를 사용하며, 설명에 `[LOADTEST:...]` 표식을 넣습니다.
