import React, { useEffect, useMemo, useRef, useState } from 'react';
import anchors from '../lib/treeAnchors.json';
import stages from '../lib/treeStages.json';
import { buildScene, changedItems, parallax, STAGE_ORDER, tiltFromOrientation, turn } from '../lib/treeScene';
import { TREE_ASSETS, TREE_PARTS } from '../lib/treeAssets';
import '../tree.css';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const tiltSupported = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
const GROW_MS = 1400;
const SWITCH_MS = 450; // species crossfade
const BURST = 4; // extra leaves shaken loose when the tree grows a stage
const LITTER_STAGGER_MS = 90;

function Particles({ layer, growth }) {
  if (layer.kind === 'litter') {
    const fresh = growth?.type === 'grow' ? growth.newLitterFrom : Infinity;
    return layer.particles.map((p, i) => <img key={p.key} src={p.src} alt="" draggable={false} className={i >= fresh ? 'lt-new' : undefined}
      style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.size}%`, transform: `rotate(${p.rotate}deg)`, '--delay': `${(i - fresh) * LITTER_STAGGER_MS + 500}ms` }}/>);
  }
  if (layer.kind === 'effect' && layer.particles[0]?.mode === 'wander') {
    return layer.particles.map(p => <div key={p.key} className="lt-wander" style={{ '--dx': p.dx, '--dy': p.dy, '--dur': `${p.duration}s`, '--delay': `${p.delay}s` }}>
      <img src={p.src} alt="" draggable={false} style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.size}%` }}/>
    </div>);
  }
  const burst = growth?.type === 'grow' && layer.kind === 'falling';
  const leaves = burst ? [...layer.particles, ...layer.particles.slice(0, BURST).map(p => ({ ...p, key: `${p.key}-burst`, burst: true, delay: 0.1 }))] : layer.particles;
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
export default function LayeredTree({ species, stage, slots, effect = null, label, interactive = true, fit = false, children }) {
  const layers = useMemo(() => buildScene(anchors, species, stage, slots, stages, effect), [species, stage, slots, effect]);
  const stageRef = useRef(null);
  const layerRefs = useRef(new Map());
  const tilt = useRef({ x: 0, y: 0 });
  const frame = useRef(null);
  const [settling, setSettling] = useState(false);
  const [tiltOn, setTiltOn] = useState(false);
  const zoom = fit ? stages.stages.grown.height / stages.stages[stage].height : 1;

  // Growing a stage or switching species: keep the previous tree for a moment so it can fade out
  // under the new one (grow: the new tree rises from its foot; species: a plain crossfade).
  const previous = useRef({ species, stage });
  const [growth, setGrowth] = useState(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { species, stage };
    let next = null;
    if (before.species !== species) {
      next = { type: 'species', fromSpecies: before.species, from: before.stage, key: Date.now() };
    } else if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(before.stage)) {
      const oldLitter = stages.stages[before.stage].groundLeaves;
      next = { type: 'grow', fromSpecies: species, from: before.stage, newLitterFrom: stages.species[species].leaf === 'none' ? Infinity : oldLitter, key: Date.now() };
    }
    if (!next) return undefined;
    setGrowth(next);
    const timer = setTimeout(() => setGrowth(null), next.type === 'grow' ? GROW_MS : SWITCH_MS);
    return () => clearTimeout(timer);
  }, [species, stage]);

  // A decoration that was just hung (or swapped) pops onto the tree; nothing pops on the first render.
  const shownItems = useMemo(() => new Map(layers.filter(l => l.itemId && l.kind !== 'background').map(l => [l.key, l.itemId])), [layers]);
  const lastItems = useRef(null);
  const popping = useMemo(() => changedItems(lastItems.current, shownItems), [shownItems]);
  useEffect(() => { lastItems.current = shownItems; }, [shownItems]);

  // Effects and falling leaves pause while the tree is scrolled out of view.
  const viewportRef = useRef(null);
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    if (!viewportRef.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting));
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

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
    // Buttons placed on the tree (slot pins) keep their own clicks; capturing would swallow them.
    if (!enabled || tiltOn || event.target.closest('button')) return;
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

  const outgoing = growth ? TREE_PARTS.map(part => ({ key: `old-${part}`, src: TREE_ASSETS.layer(growth.fromSpecies, growth.from, part), after: part })) : [];
  const incoming = growth?.type === 'grow' ? ' lt-in' : growth?.type === 'species' ? ' lt-fadein' : '';
  return <div className={`lt-tree${settling ? ' settling' : ''}${growth ? (growth.type === 'grow' ? ' growing' : ' switching') : ''}${offscreen ? ' lt-offscreen' : ''}`} data-species={species} data-stage={stage}>
    <div className="lt-viewport" ref={viewportRef} role="img" aria-label={label || `${species} ${stage} 나무`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={release}>
      <div className="lt-stage" ref={stageRef}>
        {layers.map(layer => {
          const style = layer.box ? { left: `${layer.box.left}%`, top: `${layer.box.top}%`, width: `${layer.box.width}%`, height: `${layer.box.height}%` } : undefined;
          const changing = layer.kind === 'tree' ? incoming : '';
          const pops = popping.has(layer.key);
          return <React.Fragment key={layer.key}>
            <div ref={el => (el ? layerRefs.current.set(layer.key, el) : layerRefs.current.delete(layer.key))}
              className={`lt-layer lt-${layer.kind}${changing}`} data-layer={layer.key} data-item={layer.itemId || undefined} style={style}>
              {layer.particles
                ? <Particles key={layer.kind === 'effect' ? layer.effect : (growth?.key || 'steady')} layer={layer} growth={growth}/>
                : <img key={layer.itemId || layer.src} src={layer.src} alt="" draggable={false} decoding="async" className={pops ? 'lt-pop' : undefined}/>}
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
