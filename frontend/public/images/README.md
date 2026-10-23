# 지도 관심 나무

- `autumn-maple-tree.png`: 지도에서 제보/좋아요가 모인 자치구의 중심에 표시하는 투명 RGBA 이미지.
- 사용자 제공 단풍나무 참고 이미지를 기반으로 내장 `image_gen` 도구로 2026-10-23 생성했습니다. 실제 3D 모델이 아니라 입체감 있게 렌더링한 지도용 이미지입니다.
- UI는 구 이름과 나무를 별도 마커로 표시합니다. 관심도 1/2/3단계의 나무 너비는 데스크톱에서 60/78/96px, 좁은 지도에서 75%입니다. 관심도가 0이면 나무를 표시하지 않습니다. 나무 뿌리가 구 경계 안에 설정된 중심 좌표에 놓입니다.

## 최종 생성 프롬프트 (내장 도구, 투명 배경)

Use case: stylized-concept. Asset type: transparent map marker sprite for the Seoul foliage reporting web app. Input image 1 is a style and subject reference, not a background to retain. Create ONE isolated full autumn maple tree, taking the dense red-orange pointed maple leaves, orange/golden highlights, dark brown trunk, spreading roots and a few fallen leaves from the reference. Make it look like a polished miniature 3D diorama / game object with layered volumetric foliage, visibly dimensional soft lighting and natural branch depth, while staying close to the reference silhouette. Slightly elevated orthographic view, tree vertically upright, full crown and entire trunk in frame, centred, crown occupies upper two-thirds, foot of trunk near bottom-centre. Warm red and orange foliage with individual maple leaf silhouettes readable at small sizes, dark sturdy branching trunk. Small restrained soft contact shadow and a few red fallen leaves around the roots. Genuine transparent background/alpha outside the tree and shadow; no yellow background, no rectangular ground plane, no grass island, no platform, no bench, no person, no text, no logo, no border, no watermark. Tightly frame the single tree with about 5% breathing room for use as a small map asset. This is a 3D-looking rendered sprite, not a flat emoji or flat vector icon.
