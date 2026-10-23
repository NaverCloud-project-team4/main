import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centreLimits, clampSeoulCentre, insideCity } from '../frontend/src/lib/seoulViewport.js';

const point = (x,y) => ({x,y});
const ring = values => values.map(([x,y])=>point(x,y));
const city = {minX:0,maxX:10,minY:0,maxY:10};
const rectangle = [[ring([[0,0],[10,0],[10,10],[0,10],[0,0]])]];

test('overview locks both axes instead of allowing the city to be dragged to an edge',()=>{
  const limits=centreLimits(city,{minX:-5,maxX:15,minY:-5,maxY:15});
  assert.deepEqual(limits,{minX:5,maxX:5,minY:5,maxY:5});
  assert.deepEqual(clampSeoulCentre(point(-100,100),limits,rectangle),point(5,5));
});
test('zoomed view clamps the entire viewport extent, with one oversized axis locked',()=>{
  const limits=centreLimits(city,{minX:0,maxX:4,minY:0,maxY:6});
  assert.deepEqual(limits,{minX:2,maxX:8,minY:3,maxY:7});
  assert.deepEqual(clampSeoulCentre(point(-100,100),limits,rectangle),point(2,7));
  assert.deepEqual(centreLimits(city,{minX:0,maxX:20,minY:0,maxY:2}),{minX:5,maxX:5,minY:1,maxY:9});
});
test('concave city corners are excluded even when inside the bounding box',()=>{
  const lShape=[[ring([[0,0],[6,0],[6,2],[2,2],[2,6],[0,6],[0,0]])]];
  assert.equal(insideCity(point(4,4),lShape),false);
  const fixed=clampSeoulCentre(point(4,4),{minX:1,maxX:5,minY:1,maxY:5},lShape);
  assert.ok(insideCity(fixed,lShape));
  assert.ok(fixed.x===2||fixed.y===2);
});
test('holes, shared edges and disconnected polygons are handled',()=>{
  const withHole=[[rectangle[0][0],ring([[3,3],[7,3],[7,7],[3,7],[3,3]])]];
  assert.equal(insideCity(point(5,5),withHole),false);
  assert.equal(insideCity(point(3,5),withHole),true);
  assert.ok(insideCity(clampSeoulCentre(point(5,5),city,withHole),withHole));
  const multi=[...rectangle,[ring([[20,20],[25,20],[25,25],[20,25],[20,20]])]];
  assert.ok(insideCity(point(22,22),multi));
});

test('real Seoul boundaries clamp nearby cities and viewport changes deterministically',()=>{
  const source=JSON.parse(readFileSync(new URL('../backend/app/data/seoul_districts_20261001.geojson',import.meta.url)));
  // Independent normalized Mercator coordinates, rather than latitude arithmetic.
  const project=(lng,lat)=>point((lng+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2);
  const [west,south,east,north]=source.bbox;
  const sw=project(west,south), ne=project(east,north);
  const bounds={minX:sw.x,maxX:ne.x,minY:ne.y,maxY:sw.y};
  const polygons=[source.city_geometry.coordinates.map(r=>r.map(([lng,lat])=>project(lng,lat)))];
  for(const [lng,lat] of [[126.85,37.65],[126.8647,37.4784],[126.9879,37.4293],[126.766,37.5034]]) {
    assert.equal(insideCity(project(lng,lat),polygons),false);
  }
  for(const ratio of [0.05,0.3,0.7,1,2]) {
    const limits=centreLimits(bounds,{minX:0,maxX:(bounds.maxX-bounds.minX)*ratio,minY:0,maxY:(bounds.maxY-bounds.minY)*ratio});
    for(let x=-2;x<=10;x++) for(let y=-2;y<=10;y++) {
      const fixed=clampSeoulCentre(point(sw.x+(ne.x-sw.x)*x/8,ne.y+(sw.y-ne.y)*y/8),limits,polygons);
      assert.ok(insideCity(fixed,polygons));
      assert.ok(fixed.x>=limits.minX-1e-12&&fixed.x<=limits.maxX+1e-12);
      assert.ok(fixed.y>=limits.minY-1e-12&&fixed.y<=limits.maxY+1e-12);
      const again=clampSeoulCentre(fixed,limits,polygons);
      assert.ok(Math.hypot(again.x-fixed.x,again.y-fixed.y)<1e-12);
    }
  }
});
