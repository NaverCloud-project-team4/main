import React, { useEffect, useMemo, useRef, useState } from 'react';
import anchors from '../lib/treeAnchors.json';
import stages from '../lib/treeStages.json';
import { buildScene, parallax, STAGE_ORDER, tiltFromOrientation, turn } from '../lib/treeScene';
import { TREE_ASSETS, TREE_PARTS } from '../lib/treeAssets';
import '../tree.css';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const tiltSupported = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
const GROW_MS = 1400;
const BURST = 4; // extra leaves shaken loose when the tree grows a stage
const LITTER_STAGGER_MS = 90;

function Particles({ layer, growth }) {
  if (layer.kind === 'litter') {
    const fresh = growth?.newLitterFrom ?? Infinity;
    return layer.particles.map((p, i) => <img key={p.key} src={p.src} alt="" draggable={false} className={i >= fresh ? 'lt-new' : undefined}
      style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.size}%`, transform: `rotate(${p.rotate}deg)`, '--delay': `${(i - fresh) * LITTER_STAGGER_MS + 500}ms` }}/>);
  }
  const leaves = growth ? [...layer.particles, ...layer.particles.slice(0, BURST).map(p => ({ ...p, key: `${p.key}-burst`, burst: true, delay: 0.1 }))] : layer.particles;
  return leaves.map(p => <div key={p.key} className={`lt-fall${p.burst ? ' lt-burst' : ''}`}
    style={{ '--dx': p.dx, '--dy': p.dy, '--dur': `${p.duration}s`, '--delay': `${p.delay}s`, '--spin': `${p.spin}deg` }}>
    <img src={p.src} alt="" draggable={false} style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.size}%` }}/>
  </div>);
}

/**
 * 2.5D layered tree. Layers move by depth when the tree is dragged or (opt-in) the phone is tilted;
 * the whole stage turns slightly under CSS perspective. No 3D library.
 * slots: the /api/me/tree slots ([{ slot, item_id, unlocked, visible }]).
 * fit: scale so every stage fills the same height (used to compare silhouettes).
 */
export default function LayeredTree({ species, stage, slots, label, interactive = true, fit = false, children }) {
  const layers = useMemo(() => buildScene(anchors, species, stage, slots, stages), [species, stage, slots]);
  const stageRef = useRef(null);
  const layerRefs = useRef(new Map());
  const tilt = useRef({ x: 0, y: 0 });
  const frame = useRef(null);
  const [settling, setSettling] = useState(false);
  const [tiltOn, setTiltOn] = useState(false);
  const zoom = fit ? stages.stages.grown.height / stages.stages[stage].height : 1;

  // Growing a stage: keep the previous tree for a moment so it can fade out under the new one.
  const previous = useRef({ species, stage });
  const [growth, setGrowth] = useState(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { species, stage };
    if (before.species !== species || STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(before.stage)) return undefined;
    const oldLitter = stages.stages[before.stage].groundLeaves;
    setGrowth({ from: before.stage, newLitterFrom: stages.species[species].leaf === 'none' ? Infinity : oldLitter, key: Date.now() });
    const timer = setTimeout(() => setGrowth(null), GROW_MS);
    return () => clearTimeout(timer);
  }, [species, stage]);

  // Apply the current tilt to the DOM directly (no React render per pointer move).
  const paint = () => {
    frame.current = null;
    const t = tilt.current;
    const r = turn(t);
    if (stageRef.current) stageRef.current.style.transform = `scale(${zoom}) rotateX(${r.rotateX}deg) rotateY(${r.rotateY}deg)`;
    for (const layer of layers) {
      const el = layerRefs.current.get(layer.key);
      if (!el) continue;
      const p = parallax(t, layer.depth);
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    }
  };
  const setTilt = next => {
    tilt.current = next;
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  };
  useEffect(() => { paint(); }, [layers, zoom]); // keep the current tilt when the tree changes
  useEffect(() => () => frame.current !== null && cancelAnimationFrame(frame.current), []);

  const drag = useRef(null);
  const enabled = interactive && !reducedMotion();
  const onPointerDown = event => {
    if (!enabled || tiltOn) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, w: rect.width / 2, h: rect.height / 2 };
    setSettling(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = event => {
    const d = drag.current;
    if (!d) return;
    setTilt({ x: (event.clientX - d.x) / d.w, y: (event.clientY - d.y) / d.h });
  };
  const release = () => {
    if (!drag.current) return;
    drag.current = null;
    setSettling(true); // CSS transition eases every layer back
    setTilt({ x: 0, y: 0 });
  };

  // Opt-in device tilt (iOS asks for permission on a tap).
  useEffect(() => {
    if (!tiltOn || !enabled) return;
    let rest = null;
    const onOrientation = e => {
      if (e.gamma == null || e.beta == null) return;
      rest ??= e.beta;
      setTilt(tiltFromOrientation(e.gamma, e.beta, rest));
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => { window.removeEventListener('deviceorientation', onOrientation); setTilt({ x: 0, y: 0 }); };
  }, [tiltOn, enabled]);
  const toggleTilt = async () => {
    if (tiltOn) return setTiltOn(false);
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') return;
      setSettling(true);
      setTiltOn(true);
    } catch { /* permission denied or unsupported: keep drag */ }
  };

  const outgoing = growth ? TREE_PARTS.map(part => ({ key: `old-${part}`, src: TREE_ASSETS.layer(species, growth.from, part), after: part })) : [];
  return <div className={`lt-tree${settling ? ' settling' : ''}${growth ? ' growing' : ''}`} data-species={species} data-stage={stage}>
    <div className="lt-viewport" role="img" aria-label={label || `${species} ${stage} 나무`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={release}>
      <div className="lt-stage" ref={stageRef}>
        {layers.map(layer => {
          const style = layer.box ? { left: `${layer.box.left}%`, top: `${layer.box.top}%`, width: `${layer.box.width}%`, height: `${layer.box.height}%` } : undefined;
          const grows = growth && layer.kind === 'tree';
          return <React.Fragment key={layer.key}>
            <div ref={el => (el ? layerRefs.current.set(layer.key, el) : layerRefs.current.delete(layer.key))}
              className={`lt-layer lt-${layer.kind}${grows ? ' lt-in' : ''}`} data-layer={layer.key} data-item={layer.itemId || undefined} style={style}>
              {layer.particles ? <Particles key={growth?.key || 'steady'} layer={layer} growth={growth}/> : <img src={layer.src} alt="" draggable={false} decoding="async"/>}
            </div>
            {outgoing.filter(o => o.after === layer.key).map(o => <div key={o.key} className="lt-layer lt-tree lt-out" data-layer={o.key}><img src={o.src} alt="" draggable={false}/></div>)}
          </React.Fragment>;
        })}
        {children}
      </div>
    </div>
    {enabled && tiltSupported() && <button type="button" className="lt-tilt" aria-pressed={tiltOn} onClick={toggleTilt}>{tiltOn ? '기울기 끄기' : '기울여 보기'}</button>}
  </div>;
}
