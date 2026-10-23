// Editable mobile prototype screens for 까우룽까우룽. Run with use_figma.
const page=figma.currentPage;
await Promise.all(["Regular","Medium","Bold"].map(style=>figma.loadFontAsync({family:"Noto Sans KR",style})));
const palette={canvas:"F8F5EF",paper:"FFFDF9",ink:"25261F",muted:"77776E",line:"E4DED3",orange:"C75A33",orangeLight:"F8E7DA",gold:"E3AD49",olive:"667A4A",oliveLight:"E7EEDC",gray:"EEEAE3",white:"FFFFFF"};
const rgb=hex=>({r:parseInt(hex.slice(0,2),16)/255,g:parseInt(hex.slice(2,4),16)/255,b:parseInt(hex.slice(4,6),16)/255});
const vs=await figma.variables.getLocalVariablesAsync("COLOR");
const vars=Object.fromEntries(vs.map(v=>[v.name.replace("color/",""),v]));
const paint=k=>figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(palette[k])},"color",vars[k]);
const ids=[]; const screens={}; const refs={}; const images={};
const add=n=>{ids.push(n.id);return n};
function frame(parent,name,x,y,w,h,color="paper",radius=0){const n=add(figma.createFrame());n.name=name;n.resize(w,h);n.x=x;n.y=y;n.fills=[paint(color)];n.cornerRadius=radius;parent.appendChild(n);return n}
function rect(parent,name,x,y,w,h,color,radius=0,opacity=1){const n=frame(parent,name,x,y,w,h,color,radius);n.opacity=opacity;return n}
function ellipse(parent,name,x,y,w,h,color){const n=add(figma.createEllipse());n.name=name;n.resize(w,h);n.x=x;n.y=y;n.fills=[paint(color)];parent.appendChild(n);return n}
function txt(parent,name,content,x,y,w,h,size=16,weight="Regular",color="ink",align="LEFT"){
  const n=add(figma.createText());n.name=name;n.fontName={family:"Noto Sans KR",style:weight};n.fontSize=size;n.characters=content;n.fills=[paint(color)];n.resize(w,h);n.textAlignHorizontal=align;n.textAutoResize="NONE";n.x=x;n.y=y;parent.appendChild(n);return n;
}
function button(parent,name,label,x,y,w,h=52,kind="orange"){
  const n=frame(parent,name,x,y,w,h,kind,16);
  txt(n,`${name} 라벨`,label,0,(h-28)/2,w,29,16,"Bold",kind==="orange"?"white":"ink","CENTER");
  return n;
}
function chip(parent,name,label,x,y,w,selected=false){const c=frame(parent,name,x,y,w,35,selected?"orangeLight":"paper",18);c.strokes=[paint(selected?"orange":"line")];c.strokeWeight=1;txt(c,`${name} 글자`,label,0,6,w,23,13,selected?"Bold":"Medium",selected?"orange":"muted","CENTER");return c}
function screen(name,index){const n=frame(page,name,index*460,0,390,844,"paper",28);n.clipsContent=true;screens[name]=n;txt(n,`${name} 상태 시각`,"9:41",22,12,70,25,13,"Bold","ink");txt(n,`${name} 상태 표시`,"●  ▮  100%",270,12,98,25,11,"Medium","ink","RIGHT");return n}
const navComponents={지도:await figma.getNodeByIdAsync("4:15"),피드:await figma.getNodeByIdAsync("4:21"),나무:await figma.getNodeByIdAsync("4:27")};
function nav(s,selected){const i=add(navComponents[selected].createInstance());i.name=`하단 탐색 · ${selected}`;i.x=0;i.y=764;s.appendChild(i);return i}
function navHotspots(s){const y=764;refs[`${s.name}:tab-map`]=rect(s,"탭 지도 클릭",16,y,110,72,"white",0,0.001);refs[`${s.name}:tab-feed`]=rect(s,"탭 피드 클릭",136,y,110,72,"white",0,0.001);refs[`${s.name}:tab-tree`]=rect(s,"탭 나무 클릭",256,y,110,72,"white",0,0.001)}
function photo(parent,name,x,y,w,h){const n=frame(parent,name,x,y,w,h,"gray",14);txt(n,"사진 준비 표시","시연용 사진",0,h/2-14,w,28,13,"Medium","muted","CENTER");images[name]=n.id;return n}
function headline(s,title,subtitle){txt(s,"페이지 제목",title,20,48,350,38,25,"Bold","ink");if(subtitle)txt(s,"페이지 설명",subtitle,20,91,350,28,14,"Regular","muted")}
function sampleNote(s){txt(s,"예시 데이터 안내","사진과 현황은 프로토타입 예시",20,735,350,20,11,"Regular","muted")}
function mapArea(s,startY=165,height=450){
  const m=frame(s,"지도 시각화",16,startY,358,height,"oliveLight",18);
  rect(m,"큰 길 가로",0,90,358,28,"paper",12);rect(m,"큰 길 세로",140,0,26,height,"paper",12);
  rect(m,"작은 길 가로",0,268,358,16,"paper",8);rect(m,"작은 길 세로",262,0,13,height,"paper",7);
  rect(m,"공원",183,135,123,94,"olive",18,0.35);ellipse(m,"연못",198,160,60,40,"white");
  txt(m,"지역명 1","경희대",38,135,90,24,14,"Bold","ink");txt(m,"지역명 2","회기역",200,315,90,24,14,"Medium","muted");
  const peak=figma.getNodeByIdAsync("4:33");const changing=figma.getNodeByIdAsync("4:35");
  return Promise.all([peak,changing]).then(([p,c])=>{const a=add(p.createInstance());a.name="경희대 일대 · 절정";a.x=45;a.y=187;m.appendChild(a);const b=add(c.createInstance());b.name="회기역 주변 · 물드는 중";b.x=216;b.y=342;m.appendChild(b);refs[`${s.name}:map-marker`]=a;return m});
}

// 01 Map home
{
 const s=screen("01 지도 · 내 주변",0);headline(s,"지금 어디가 물들었을까?","2026 가을 · 경희대 주변");
 chip(s,"단풍 필터","단풍",20,127,76,true);chip(s,"은행 필터","은행",104,127,76);chip(s,"최근 필터","최근 3일",272,127,98);
 await mapArea(s,176,463);
 const sheet=frame(s,"내 주변 요약",16,590,358,134,"paper",18);sheet.strokes=[paint("line")];sheet.strokeWeight=1;
 txt(sheet,"요약 제목","경희대 일대",18,14,200,29,19,"Bold","ink");txt(sheet,"요약 단계","절정",284,19,55,22,14,"Bold","orange","RIGHT");
 txt(sheet,"요약 정보","최근 사진 3장  ·  마지막 제보 2시간 전",18,48,320,24,13,"Regular","muted");
 rect(sheet,"사진 썸네일 1",18,83,60,38,"gold",8);rect(sheet,"사진 썸네일 2",86,83,60,38,"orange",8);rect(sheet,"사진 썸네일 3",154,83,60,38,"olive",8);
 refs.mapSheet=rect(sheet,"요약 열기 클릭",0,0,358,134,"white",0,0.001);
 sampleNote(s);nav(s,"지도");navHotspots(s);
}

// 02 Region sheet
{
 const s=screen("02 구역 상세",1);txt(s,"뒤로","‹",20,53,30,36,30,"Medium","ink");refs.detailBack=rect(s,"뒤로 클릭",12,44,44,44,"white",0,0.001);
 txt(s,"구역 제목","경희대 일대",61,53,280,37,24,"Bold","ink");
 await mapArea(s,107,376);rect(s,"지도 어둡게",16,107,358,376,"ink",18,0.12);
 const sheet=frame(s,"구역 정보 시트",0,338,390,426,"paper",28);rect(sheet,"시트 손잡이",173,10,44,5,"line",3);
 txt(sheet,"구역명","경희대 일대",20,33,220,35,23,"Bold","ink");chip(sheet,"단계 표시","절정",286,37,76,true);
 txt(sheet,"요약","최근 제보 3건  ·  마지막 갱신 2시간 전",20,75,350,23,13,"Regular","muted");
 photo(sheet,"regionPhoto",20,116,350,168);
 txt(sheet,"촬영 시각","오늘 12:28 촬영 · 12:31 제보",20,294,340,24,12,"Medium","muted");
 refs.detailFeed=button(sheet,"피드 보기","이 구역 제보 보기",20,333,169,49,"gray");
 refs.detailReport=button(sheet,"여기서 제보","여기서 제보하기",201,333,169,49,"orange");
 nav(s,"지도");navHotspots(s);
}

// 03 Feed
{
 const s=screen("03 제보 피드",2);headline(s,"제보 피드","내 주변 사람들이 방금 본 가을");
 chip(s,"주변 필터","경희대 주변",20,129,129,true);chip(s,"시간 필터","최신순",158,129,79);chip(s,"종류 필터","전체",246,129,67);
 const a=frame(s,"첫 번째 제보 카드",20,180,350,254,"paper",18);a.strokes=[paint("line")];a.strokeWeight=1;photo(a,"feedPhoto1",0,0,350,165);
 txt(a,"첫 제보 지역","경희대 일대 · 은행 절정",14,176,315,28,16,"Bold","ink");txt(a,"첫 제보 시간","오늘 12:28 촬영 · 2시간 전 제보",14,207,320,22,12,"Regular","muted");
 const b=frame(s,"두 번째 제보 카드",20,449,350,254,"paper",18);b.strokes=[paint("line")];b.strokeWeight=1;photo(b,"feedPhoto2",0,0,350,165);
 txt(b,"둘째 제보 지역","회기역 산책로 · 단풍 물드는 중",14,176,325,28,16,"Bold","ink");txt(b,"둘째 제보 시간","오늘 10:42 촬영 · 4시간 전 제보",14,207,320,22,12,"Regular","muted");
 refs.feedReport=button(s,"제보 시작","＋  사진 제보",238,692,132,56,"orange");
 nav(s,"피드");navHotspots(s);
}

// 04 Camera permission
{
 const s=screen("04 촬영 권한 안내",3);txt(s,"뒤로","‹",20,53,30,36,30,"Medium","ink");refs.permissionBack=rect(s,"뒤로 클릭",12,44,44,44,"white",0,0.001);
 txt(s,"제보 단계","제보 1 / 3",20,105,170,27,13,"Bold","orange");
 ellipse(s,"카메라 원",113,166,164,164,"orangeLight");txt(s,"카메라 그림","◎",139,190,112,105,73,"Bold","orange","CENTER");
 txt(s,"권한 안내 제목","지금 본 풍경을 남겨주세요",20,362,350,38,24,"Bold","ink","CENTER");
 txt(s,"권한 안내 내용","사진은 웹 카메라로 바로 촬영하고,\n현재 위치가 제보 구역 안인지 확인해요.",33,413,324,64,15,"Regular","muted","CENTER");
 rect(s,"권한 항목 1",30,513,330,58,"canvas",14);txt(s,"권한 1","카메라   사진 직접 촬영",49,529,290,28,15,"Medium","ink");
 rect(s,"권한 항목 2",30,583,330,58,"canvas",14);txt(s,"권한 2","위치       현장 제보 확인",49,599,290,28,15,"Medium","ink");
 refs.permissionContinue=button(s,"권한 허용","권한 허용하고 촬영",20,685,350,56,"orange");
 txt(s,"권한 주석","실제 웹에서는 브라우저 권한 창이 열립니다",20,752,350,24,12,"Regular","muted","CENTER");
}

// 05 Live camera simulation
{
 const s=screen("05 카메라 촬영",4);s.fills=[paint("ink")];
 images.cameraView=frame(s,"카메라 미리보기",0,80,390,637,"gray",0).id;
 txt(s,"카메라 뒤로","‹",20,47,30,36,30,"Medium","white");refs.cameraBack=rect(s,"뒤로 클릭",12,42,44,44,"white",0,0.001);
 txt(s,"카메라 안내","나무가 잘 보이도록 촬영해 주세요",42,98,310,31,15,"Bold","white","CENTER");
 ellipse(s,"셔터 바깥",151,730,88,88,"white");ellipse(s,"셔터 안쪽",162,741,66,66,"orange");
 refs.shutter=rect(s,"촬영 클릭",151,730,88,88,"white",44,0.001);
}

// 06 Review and submit
{
 const s=screen("06 제보 확인",5);txt(s,"뒤로","‹",20,53,30,36,30,"Medium","ink");refs.reviewBack=rect(s,"뒤로 클릭",12,44,44,44,"white",0,0.001);
 txt(s,"제보 단계","제보 2 / 3",20,102,170,26,13,"Bold","orange");txt(s,"확인 제목","사진과 위치를 확인해요",20,130,350,38,23,"Bold","ink");
 photo(s,"reviewPhoto",20,184,350,248);
 txt(s,"촬영 장소 라벨","촬영 장소",20,452,150,24,13,"Bold","muted");
 rect(s,"장소 확인",20,480,350,70,"canvas",14);txt(s,"장소 확인 글","경희대 일대  ✓  구역 안에서 촬영",38,500,314,31,15,"Medium","ink");
 txt(s,"단계 라벨","현재 단풍 상태",20,571,250,26,14,"Bold","ink");
 chip(s,"상태 물들기 전","물들기 전",20,608,103);chip(s,"상태 물드는 중","물드는 중",131,608,103);chip(s,"상태 절정","절정",242,608,65,true);
 txt(s,"검증 안내","촬영 시각과 위치를 함께 확인한 뒤 등록합니다",20,659,350,27,12,"Regular","muted");
 refs.submit=button(s,"제보 등록","제보 등록하기",20,704,350,56,"orange");
}

// 07 Success
{
 const s=screen("07 제보 완료",6);ellipse(s,"완료 원",125,107,140,140,"oliveLight");txt(s,"완료 기호","✓",152,132,86,90,68,"Bold","olive","CENTER");
 txt(s,"완료 제목","제보가 등록됐어요",20,278,350,42,26,"Bold","ink","CENTER");
 txt(s,"완료 설명","경희대 일대 지도에 새 제보가 반영됐어요",20,332,350,31,15,"Regular","muted","CENTER");
 rect(s,"포인트 알림",45,393,300,78,"orangeLight",18);txt(s,"포인트 글","기본 확인 통과  ·  20P 적립",55,416,280,32,18,"Bold","orange","CENTER");
 photo(s,"successPhoto",45,503,300,160);
 refs.successMap=button(s,"지도로 이동","지도에서 내 제보 보기",20,690,350,54,"orange");
 refs.successTree=txt(s,"나무로 이동","나무 꾸미러 가기  ›",20,756,350,30,15,"Bold","olive","CENTER");
}

// 08 Tree
function drawTree(s,decorated){
  rect(s,"나무 줄기",174,316,42,244,"orange",14);ellipse(s,"나무 덮개 왼쪽",76,229,160,170,"gold");
  ellipse(s,"나무 덮개 오른쪽",157,225,160,170,"orange");ellipse(s,"나무 덮개 위",113,169,174,174,"gold");
  ellipse(s,"잎 무리 1",101,251,67,71,"orangeLight");ellipse(s,"잎 무리 2",244,278,52,58,"gold");ellipse(s,"잎 무리 3",175,202,70,70,"orangeLight");
  if(decorated){rect(s,"리본 매듭",179,396,32,31,"olive",8);txt(s,"리본","✦",156,385,78,54,34,"Bold","white","CENTER");}
  ellipse(s,"나무 그림자",93,548,205,26,"gray");
}
{
 const s=screen("08 나만의 나무",7);headline(s,"나만의 나무","제보로 모은 포인트로 가을을 꾸며요");
 chip(s,"내 포인트","보유 80P",260,58,110,true);drawTree(s,false);
 txt(s,"나무 시즌","2026 가을 · 단풍나무",20,587,350,32,18,"Bold","ink","CENTER");
 txt(s,"꾸미기 제목","나무 꾸미기",20,634,200,30,18,"Bold","ink");
 const shop=frame(s,"리본 상품",20,674,350,73,"canvas",16);txt(shop,"상품 이름","가을 리본",17,16,170,27,16,"Bold","ink");txt(shop,"상품 가격","30P",235,19,52,25,14,"Bold","orange");
 refs.buyRibbon=button(shop,"리본 구매","적용",288,14,48,43,"orange");
 nav(s,"나무");navHotspots(s);
}

// 09 Decorated tree state
{
 const s=screen("09 나무 꾸민 후",8);headline(s,"나만의 나무","가을 리본을 달았어요");chip(s,"남은 포인트","보유 50P",260,58,110,true);drawTree(s,true);
 txt(s,"나무 시즌","2026 가을 · 단풍나무",20,587,350,32,18,"Bold","ink","CENTER");
 rect(s,"적용 완료 알림",20,650,350,75,"oliveLight",16);txt(s,"적용 완료 글","가을 리본 적용 완료  ·  30P 사용",25,672,340,31,16,"Bold","olive","CENTER");
 nav(s,"나무");navHotspots(s);
}

return {createdNodeIds:ids,screenIds:Object.fromEntries(Object.entries(screens).map(([k,v])=>[k,v.id])),imageNodeIds:images,hotspotIds:Object.fromEntries(Object.entries(refs).map(([k,v])=>[k,v.id])),screenCount:Object.keys(screens).length,nodeCount:ids.length};
