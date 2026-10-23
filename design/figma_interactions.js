// Link editable screens into a Figma click prototype and place sample images.
const page=figma.currentPage;
const node=async id=>await figma.getNodeByIdAsync(id);
const screen={map:"5:2",detail:"5:44",feed:"5:86",permission:"5:118",camera:"5:135",review:"5:145",success:"5:167",tree:"5:181",decorated:"5:212"};
const changed=[];const created=[];const links=[];
async function link(id,destination,label){const n=await node(id);if(!n)throw Error(`Missing source ${id}`);await n.setReactionsAsync([{trigger:{type:"ON_CLICK"},actions:[{type:"NODE",destinationId:destination,navigation:"NAVIGATE",transition:{type:"DISSOLVE",easing:{type:"EASE_OUT"},duration:0.2}}]}]);changed.push(n.id);links.push(label)}
const routes=[
 ["5:22",screen.detail,"지도 마커 → 구역"],["5:33",screen.detail,"지도 요약 → 구역"],
 ["5:48",screen.map,"구역 뒤로 → 지도"],["5:73",screen.feed,"구역 → 피드"],["5:75",screen.permission,"구역 → 제보"],
 ["5:107",screen.permission,"피드 → 제보"],["5:122",screen.feed,"권한 뒤로 → 피드"],["5:132",screen.camera,"권한 → 카메라"],
 ["5:140",screen.permission,"카메라 뒤로 → 권한"],["5:144",screen.review,"셔터 → 확인"],["5:149",screen.camera,"확인 뒤로 → 카메라"],
 ["5:165",screen.success,"등록 → 완료"],["5:178",screen.map,"완료 → 지도"],["5:201",screen.decorated,"리본 적용 → 꾸민 나무"],
];
for(const [id,dest,label] of routes)await link(id,dest,label);
const navRoutes=[
 ["5:41","5:42","5:43"],["5:83","5:84","5:85"],["5:115","5:116","5:117"],
 ["5:209","5:210","5:211"],["5:238","5:239","5:240"]
];
const navParents=[screen.map,screen.detail,screen.feed,screen.tree,screen.decorated];
for(let i=0;i<navRoutes.length;i++){
 const row=navRoutes[i],from=navParents[i];
 if(from!==screen.map)await link(row[0],screen.map,"탭 → 지도");
 if(from!==screen.feed)await link(row[1],screen.feed,"탭 → 피드");
 if(from!==screen.tree)await link(row[2],screen.tree,"탭 → 나무");
}
const success=await node(screen.success);const hot=figma.createRectangle();hot.name="나무로 이동 클릭";hot.resize(350,36);hot.x=20;hot.y=750;hot.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:0.001}];success.appendChild(hot);created.push(hot.id);await link(hot.id,screen.tree,"완료 → 나무");

const imageTargets={
 "5:70":"4eff43c5514b1479b58de477c3d63d54069d444b",
 "5:138":"4eff43c5514b1479b58de477c3d63d54069d444b",
 "5:152":"4eff43c5514b1479b58de477c3d63d54069d444b",
 "5:176":"4eff43c5514b1479b58de477c3d63d54069d444b"
};
for(const [id,hash] of Object.entries(imageTargets)){const n=await node(id);n.fills=[{type:"IMAGE",imageHash:hash,scaleMode:"FILL"}];changed.push(n.id)}
for(const id of ["5:70","5:98","5:103","5:152","5:176"]){const n=await node(id);const p=n.children.find(c=>c.name==="사진 준비 표시");if(p){changed.push(p.id);p.remove()}}
const cam=await node("5:138");cam.fills=[{type:"IMAGE",imageHash:"4eff43c5514b1479b58de477c3d63d54069d444b",scaleMode:"FILL"}];changed.push(cam.id);

return {createdNodeIds:created,mutatedNodeIds:changed,routeCount:links.length,routeNames:links,imageFilledNodeIds:["5:70","5:98","5:103","5:138","5:152","5:176"],pageId:page.id};
