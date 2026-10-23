// 까우룽까우룽 Figma prototype foundations. Run with use_figma.
const page = figma.currentPage;
page.name = "까우룽까우룽 · 모바일 프로토타입";
const fonts = [
  { family: "Noto Sans KR", style: "Regular" },
  { family: "Noto Sans KR", style: "Medium" },
  { family: "Noto Sans KR", style: "Bold" },
];
await Promise.all(fonts.map(f => figma.loadFontAsync(f)));

const palette = {
  canvas: "F8F5EF",
  paper: "FFFDF9",
  ink: "25261F",
  muted: "77776E",
  line: "E4DED3",
  orange: "C75A33",
  orangeLight: "F8E7DA",
  gold: "E3AD49",
  olive: "667A4A",
  oliveLight: "E7EEDC",
  gray: "EEEAE3",
  white: "FFFFFF",
};
const rgb = hex => ({ r: parseInt(hex.slice(0,2),16)/255, g: parseInt(hex.slice(2,4),16)/255, b: parseInt(hex.slice(4,6),16)/255 });
const coll = figma.variables.createVariableCollection("까우룽 · 색상");
const mode = coll.defaultModeId;
const variables = {};
for (const [name,hex] of Object.entries(palette)) {
  const v = figma.variables.createVariable(`color/${name}`,coll,"COLOR");
  v.setValueForMode(mode,rgb(hex));
  v.scopes = ["FRAME_FILL","SHAPE_FILL","TEXT_FILL","STROKE_COLOR"];
  v.setVariableCodeSyntax("WEB",`var(--kk-${name})`);
  variables[name]=v;
}
const paint = name => figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(palette[name])},"color",variables[name]);

function textNode(parent,name,content,x,y,size,weight,color,width,height) {
  const t=figma.createText();
  t.name=name; t.fontName={family:"Noto Sans KR",style:weight}; t.fontSize=size;
  t.characters=content; t.fills=[paint(color)]; t.resize(width,height);
  t.x=x; t.y=y; parent.appendChild(t); return t;
}
function shape(parent,name,x,y,w,h,color,radius=0) {
  const f=figma.createFrame(); f.name=name; f.resize(w,h); f.x=x; f.y=y; f.fills=[paint(color)]; f.cornerRadius=radius; parent.appendChild(f); return f;
}
function navComponent(selected,x) {
  const c=figma.createComponent();
  c.name=`하단 탐색 / ${selected}`; c.description="모바일 지도, 제보 피드, 나무 화면을 오가는 하단 탐색";
  c.resize(390,80); c.x=x; c.y=2000; c.fills=[paint("paper")];
  shape(c,"상단 경계",0,0,390,1,"line");
  const labels=["지도","피드","나무"];
  labels.forEach((lab,i)=>{
    const xx=16+i*120;
    if(lab===selected) shape(c,`${lab} 선택 배경`,xx,12,110,48,"orangeLight",14);
    textNode(c,`${lab} 라벨`,lab,xx+26,23,17,lab===selected?"Bold":"Medium",lab===selected?"orange":"muted",60,32);
  });
  page.appendChild(c); return c;
}
const navs={지도:navComponent("지도",0),피드:navComponent("피드",430),나무:navComponent("나무",860)};

function markerComponent(name,label,color,x) {
  const c=figma.createComponent(); c.name=`지도 표시 / ${name}`; c.description="현재 단풍 단계와 최근 제보가 있는 장소를 표시";
  c.resize(84,42); c.x=x; c.y=2100; c.fills=[paint(color)]; c.cornerRadius=21;
  textNode(c,"단계",label,15,9,14,"Bold","white",65,24);
  page.appendChild(c); return c;
}
const markers={절정:markerComponent("절정","절정 · 3","orange",0),물드는중:markerComponent("물드는 중","물듦 · 5","olive",110)};

return {createdNodeIds:[coll.id,...Object.values(variables).map(v=>v.id),...Object.values(navs).map(n=>n.id),...Object.values(markers).map(n=>n.id)],pageId:page.id,collectionId:coll.id,variableNames:Object.keys(variables),navIds:Object.fromEntries(Object.entries(navs).map(([k,v])=>[k,v.id])),markerIds:Object.fromEntries(Object.entries(markers).map(([k,v])=>[k,v.id]))};
