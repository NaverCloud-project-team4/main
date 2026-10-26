# 나만의 나무 에셋 (2.5D 레이어)

코드는 `frontend/src/lib/treeAssets.js` 한 곳에서만 경로를 만듭니다. **같은 이름·크기·기준점·형식으로 덮어쓰면 교체가 끝납니다.**
현재 파일은 `scripts/make_tree_placeholders.py`로 만든 임시본입니다(다시 만들기: `.venv/Scripts/python scripts/make_tree_placeholders.py [--only trees items bg fx]`).
슬롯 위치는 `frontend/src/lib/treeAnchors.json`(1024 캔버스 픽셀 좌표)에 있고, 최종 그림에 맞춰 이 파일의 숫자만 고치면 됩니다. 스크립트는 `--write-anchors`를 줄 때만 이 파일을 다시 씁니다.
단계별 모양(나무 높이, 줄기 굵기, 가지 끝, 잎 덩어리, 물든 정도, 떨어지는 잎·바닥 낙엽 수, 그림자 배율, 소품)은 `frontend/src/lib/treeStages.json` 한 곳의 숫자로 조절합니다. 그림 생성·화면·테스트가 모두 이 파일을 읽습니다.

형식은 **투명 WebP**(알파 포함)입니다. 수채 질감 때문에 PNG는 레이어 한 장이 수백 KB라 모바일에서 무겁습니다. 원본은 PNG로 그리고 `quality≈82, alpha_quality≈90`으로 내보내길 권장합니다.

## 파일 목록

| 구분 | 파일 | 개수 | 크기 | 기준점 | 비고 |
|---|---|---|---|---|---|
| 나무 레이어 | `trees/{species}-{stage}-{part}.webp` | 4종×4단계×3 = 48 | 1024×1024 | 줄기 밑동 (512, 940) | species: `maple` `ginkgo` `cherry` `xmas` / stage: `sprout` `sapling` `young` `grown` / part: `back`(뒷잎) `trunk`(줄기·가지) `front`(앞잎) |
| 그림자 | `shadow.webp` | 1 | 768×192 | 중앙 = 밑동 (512, 940) | 옅은 타원, multiply로 합성 |
| 꼭대기 | `items/{id}.webp` | 3 (`star` `ribbon` `bird`) | 256×256 | 아래 중앙 | 나무 꼭대기에 올려놓는 점 |
| 가지 장식 | `items/{id}.webp` | 6 (`ornament` `fairy-lights` `cheongsachorong` `maple-mobile` `cherry-ribbon` `gotgam`) | 192×192 | 위 중앙 | 가지에 매다는 점(끈 시작점) |
| 바닥 소품 | `items/{id}.webp` | 6 (`gift` `snowman` `leaf-pile` `bench` `squirrel` `mushroom`) | 384×256 | 아래 중앙 | 땅에 닿는 점 |
| 배경 | `bg/{id}.webp` | 5 (`bg-hanji` `bg-autumn-dusk` `bg-snow-night` `bg-spring-river` `bg-summer-night`) | 1024×1024 | — | 불투명, 지평선은 y≈800~900 |
| 효과 파티클 | `fx/{name}.webp` | 4 (`snow` `petal` `leaf` `firefly`) | 64×64 | 중앙 | 배경 효과(4단계)에서 사용 |
| 나무 파티클 | `fx/leaf-{maple\|ginkgo}-{green\|ripe}.webp`, `fx/petal-cherry.webp` | 5 | 64×64 | 중앙 | 떨어지는 잎·바닥 낙엽. 물든 정도 0.5 이상이면 `ripe` |

### 레이어를 나누는 법
- 한 그루를 다 그린 뒤 세 장으로 나눕니다. 겹쳐 놓으면 원래 그림이 그대로 나와야 합니다.
  - `back`: 수관 뒤쪽 잎(약간 어둡게). 줄기 뒤로 가는 잎 전부.
  - `trunk`: 줄기·굵은 가지·뿌리 퍼짐. 잎 없음.
  - `front`: 수관 앞쪽 잎(밝게). **뒤쪽(`mid`) 가지 장식이 걸릴 자리에 잎 사이 틈**을 남깁니다. 위치는 `treeAnchors.json`에서 `layer: "mid"`인 `branch-*` 좌표 아래쪽 약 90px.
- 단계별 나무 높이(밑동부터 꼭대기까지, 캔버스 대비): 새싹 13% · 묘목 36% · 어린나무 56% · 큰나무 74%. 큰나무 위쪽 여백은 꼭대기 장식 자리입니다.
- 가지 장식은 `treeAnchors.json`의 가지 끝 좌표에 매달립니다. **그 자리에 실제 가지(크리스마스는 층 끝)가 있어야** 장식이 허공에 뜨지 않습니다(테스트가 검사).
- **떨어지는 잎, 바닥 낙엽, 그림자는 그리지 않습니다.** 화면이 파티클과 그림자 레이어로 단계별 개수만큼 그립니다.

## 성장 단계별 묘사 (크기만 바꾼 복사본 금지)
같은 높이로 맞춰 놓아도 단계가 구분되어야 합니다. `scripts/check_tree_silhouettes.py`가 단계별 실루엣을 같은 높이로 정규화해 겹침(IoU)이 0.75를 넘으면 실패합니다.

| 단계 | 모양 | 잎 | 소품·기타 (코드가 그리는 것 포함) |
|---|---|---|---|
| 새싹 | 줄기 없이 땅에서 바로 나온 떡잎 2장 | 둥근 떡잎, 연두 | 작은 흙 둔덕 / 떨어지는 잎 0, 그림자 아주 작게 |
| 묘목 | 가늘고 곧은 줄기, 작은 곁가지 2개뿐 | 종류 모양의 잎 5~8장 듬성듬성, 아직 덜 물듦 | 대나무 지지대 + 끈 / 떨어지는 잎 1 |
| 어린나무 | 줄기가 굵어지고 2~3갈래로 갈라짐 | 가지 끝 잎 덩어리 1~2개, **덩어리 사이로 가지가 보이는 빈틈** | 떨어지는 잎 3, 바닥 낙엽 몇 장 |
| 큰나무 | 굵은 줄기와 세로 껍질 결, 밑동에 뿌리가 살짝 드러남 | 잎 덩어리 3~5개가 겹쳐 풍성 | 떨어지는 잎 7, 바닥 낙엽 더미, 그림자 크게 |

종류별 성장 특징:
- **단풍**: 초록 → 노르스름한 주황 → 붉은색(물든 정도 0 / 0.35 / 0.7 / 1). 잎은 다섯 갈래 단풍잎.
- **은행**: 연두 → 노랑. 잎은 부채꼴. 큰나무는 바닥 낙엽이 노란 은행잎.
- **벚꽃**: 잎 위에 꽃 몇 송이(0.1) → 반쯤(0.35·0.7) → 만개(1, 꽃이 잎을 덮음). 떨어지는 것은 꽃잎.
- **크리스마스 트리**: 침엽 층 수 2 → 3 → 4 → 5. 새싹은 떡잎 대신 **아주 작은 2층 침엽 싹 + 흙 둔덕**. 층마다 아래층이 위층보다 넓게 튀어나와 계단처럼 보이게. 묘목은 홀쭉하고 줄기가 길게 보이며, 클수록 통통해짐.

## 지도와 그림체를 맞추는 공통 규칙
수채화 지도(`frontend/public/map-assets`)와 같은 화면에 나오도록 아래를 지킵니다. 지도의 `tree-maple.png`/`tree-ginkgo.png`(현재 3D 렌더 임시본)도 최종에는 이 규칙으로 그린 "큰나무" 합성본으로 바꾸면 그림체가 통일됩니다.

- **시점**: 정면에서 약 15° 위에서 내려다본 정사영. 소실점·광각 왜곡 없음.
- **광원**: 왼쪽 위(10시 방향). 수관 왼쪽 위가 밝고 오른쪽 아래에 물감이 고여 진해짐.
- **채색**: 수채 번짐, 안쪽은 옅고 가장자리는 진하게. 종이 결이 비치는 투명한 물감. 평면 벡터·3D 렌더 질감 금지.
- **외곽선**: 회갈색 먹선 `#5b4a3a`, 1024 캔버스 기준 2~3px, 끊기고 굵기가 약간 변하는 붓선.
- **팔레트**(지도와 동일 계열): 단풍 `#b8321e`·`#e2572b`·`#f4a259` / 은행 `#d6a026`·`#f2c840` / 벚꽃 `#e28ea8`·`#f6bccc` / 상록 `#2c5c42`·`#468054` / 줄기 `#6e4e34` / 먹 `#5b4a3a`.
- **배경**: 레이어·아이템은 완전 투명 배경, 바닥면·받침·글자·테두리 없음. 그림자는 별도 파일.
- **크기 일관성**: 같은 단계면 4종의 나무 높이가 같아야 합니다(위 비율). 아이템은 큰나무 기준 실제 크기 느낌으로 그리면 코드가 단계별로 줄입니다.

## 이미지 생성 AI용 공통 스타일 프롬프트

모든 그림 앞에 붙이는 공통 문구:

> East Asian ink-and-watercolor illustration for a picture-book map, warm hand-painted postcard feel. Soft transparent watercolor washes with pigment pooling at the edges and lighter centres, subtle hanji paper grain showing through, thin broken warm-brown ink outline (#5b4a3a) of slightly varying width. Orthographic view from about 15 degrees above, light from the upper left. Autumn palette of vermilion, persimmon orange, ginkgo yellow and muted moss green on off-white paper. No 3D render, no glossy shading, no flat vector, no text, no border, no watermark.

나무(한 그루를 그린 뒤 레이어로 분리) 뒤에 붙이는 문구 예시. 공통 부분:

> A single {maple | ginkgo | cherry blossom | Christmas fir} {stage text}, upright and centred, trunk foot at the bottom centre of a 1024×1024 transparent canvas at about 92% height, tree height {13 | 36 | 56 | 74}% of the canvas. Transparent background, no ground plane, no cast shadow, no falling leaves and no leaves on the ground (they are added separately).

단계별 `{stage text}`:
- 새싹: `seedling just sprouting: no stem, two rounded seed leaves (cotyledons) opening from a small mound of brown soil` (크리스마스: `a tiny fir seedling with two little tiers of needles on a small soil mound`)
- 묘목: `young sapling: a thin straight stem with only two tiny side twigs, five to eight sparse single leaves, colours still mostly green, a thin bamboo support stake beside it tied with a loop of string` (크리스마스: `three narrow tiers, slender with a long bare trunk`)
- 어린나무: `young tree: a thicker trunk that splits into two or three limbs, one or two separate leaf clusters at the limb ends with a clear gap between them where the branches show, leaves half turned to autumn colour` (크리스마스: `four tiers, each tier flaring out beyond the one above`)
- 큰나무: `mature tree: a thick trunk with vertical bark texture and a few roots showing at its foot, three to five large overlapping leaf clusters forming a full crown, deep autumn colour` (벚꽃: `in full bloom, blossoms covering the leaves`; 크리스마스: `five tiers, full and wide`)

물든 정도: 단풍 `still green` → `green turning orange` → `orange-red` → `deep crimson red` / 은행 `fresh lime green` → `yellow-green` → `golden yellow` → `bright ginkgo yellow` / 벚꽃 `a few blossoms` → `half in bloom` → `mostly in bloom` → `full bloom`.

레이어 분리 지시(편집 가능한 도구라면):

> Split the tree into three aligned layers on identical transparent 1024×1024 canvases: (1) only the foliage behind the trunk, slightly darker; (2) only the trunk, branches and root flare; (3) only the foliage in front of the trunk, lighter, keeping the gaps. Stacked in order 1-2-3 they must reproduce the full tree exactly.

아이템 예시:

> A small {brass star | red ribbon bow | little sparrow} tree topper, {256×256} transparent canvas, its base touching the bottom centre. Same watercolor and ink style.
> A hanging {Korean blue-and-red cheongsachorong lantern | string of dried persimmons (gotgam) | glass Christmas bauble}, {192×192} transparent canvas, the hanging string starting at the top centre.
> A {wooden bench | small snowman | pile of fallen maple leaves}, {384×256} transparent canvas, standing on the bottom centre, no ground plane.
