// Focused visual corrections and leaf-report map component.
await Promise.all(["Regular","Medium","Bold"].map(style=>figma.loadFontAsync({family:"Noto Sans KR",style})));
const page=figma.currentPage;const changed=[];const created=[];
const oldPositions=[["4:15",4200,0],["4:21",4200,100],["4:27",4200,200],["4:33",4200,320],["4:35",4300,320]];
for(const [id,x,y] of oldPositions){const n=await figma.getNodeByIdAsync(id);n.x=x;n.y=y;changed.push(id)}
const svg='<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.8l2.1 4.4 3.9-2-1.1 4.2 4.5 1.4-3.6 2.7 2.2 4.1-5.2-.8L12 22l-2.8-6.2-5.2.8 2.2-4.1-3.6-2.7 4.5-1.4L6 4.2l3.9 2L12 1.8z" fill="#C75A33"/></svg>';
const leafFrame=figma.createNodeFromSvg(svg);leafFrame.name="현장 제보 잎 원형";leafFrame.x=4200;leafFrame.y=410;
const leaf=figma.createComponentFromNode(leafFrame);leaf.name="지도 표시 / 제보 잎";leaf.description="검증을 통과한 현장 제보 하나를 지도에 표현하는 잎 아이콘";leaf.x=4200;leaf.y=410;created.push(leaf.id);
const screen=await figma.getNodeByIdAsync("5:2");const map=screen.findOne(n=>n.name==="지도 시각화");
for(const [x,y] of [[64,64],[103,157],[203,249],[305,208],[286,49],[71,343],[301,360]]){const inst=leaf.createInstance();inst.name="최근 제보 잎";inst.x=x;inst.y=y;map.appendChild(inst);created.push(inst.id);await inst.setReactionsAsync([{trigger:{type:"ON_CLICK"},actions:[{type:"NODE",destinationId:"5:44",navigation:"NAVIGATE",transition:null}]}]);changed.push(inst.id)}
const detail=await figma.getNodeByIdAsync("5:44");const detailMap=detail.findOne(n=>n.name==="지도 시각화");
for(const [x,y] of [[64,64],[203,249],[286,49]]){const inst=leaf.createInstance();inst.name="최근 제보 잎";inst.x=x;inst.y=y;detailMap.appendChild(inst);created.push(inst.id)}

const review=await figma.getNodeByIdAsync("5:145");
const configs=[["상태 물들기 전",20,80],["상태 물드는 중",108,86],["상태 절정",202,64]];
for(const [name,x,w] of configs){const c=review.findOne(n=>n.name===name);c.x=x;c.resize(w,c.height);const t=c.children.find(n=>n.type==="TEXT");if(t){t.resize(w,t.height);changed.push(t.id)}changed.push(c.id)}
const vars=await figma.variables.getLocalVariablesAsync("COLOR");const mapVars=Object.fromEntries(vars.map(v=>[v.name.replace("color/",""),v]));
const rgb=h=>({r:parseInt(h.slice(0,2),16)/255,g:parseInt(h.slice(2,4),16)/255,b:parseInt(h.slice(4,6),16)/255});
const bind=(hex,name)=>figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(hex)},"color",mapVars[name]);
const chip=figma.createFrame();chip.name="상태 지는 중";chip.resize(96,35);chip.x=274;chip.y=608;chip.fills=[bind("FFFDF9","paper")];chip.strokes=[bind("E4DED3","line")];chip.strokeWeight=1;chip.cornerRadius=18;review.appendChild(chip);created.push(chip.id);
const label=figma.createText();label.name="상태 지는 중 글자";label.fontName={family:"Noto Sans KR",style:"Medium"};label.fontSize=13;label.characters="지는 중";label.resize(96,23);label.textAlignHorizontal="CENTER";label.x=0;label.y=6;label.fills=[bind("77776E","muted")];chip.appendChild(label);created.push(label.id);

return {createdNodeIds:created,mutatedNodeIds:changed,leafComponentId:leaf.id,leafInstanceCount:10,reviewStages:4,componentAreaBounds:{x:4200,y:0,width:390,height:440}};
