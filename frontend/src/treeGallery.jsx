// Dev-only gallery (/tree-gallery.html, not part of the production build): every species × stage
// with sample decorations, plus one large interactive tree to try drag/tilt parallax.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LayeredTree from './components/LayeredTree';

const SPECIES = { maple: '단풍', ginkgo: '은행', cherry: '벚꽃', xmas: '크리스마스' };
const STAGES = { sprout: '새싹', sapling: '묘목', young: '어린나무', grown: '큰나무' };
const UNLOCK = { sprout: ['background', 'ground'], sapling: ['branch-1', 'branch-2'], young: ['branch-3', 'branch-4'], grown: ['topper'] };
const SAMPLE = {
  maple: { background: 'bg-autumn-dusk', ground: 'leaf-pile', 'branch-1': 'cheongsachorong', 'branch-2': 'maple-mobile', 'branch-3': 'gotgam', 'branch-4': 'fairy-lights', topper: 'bird' },
  ginkgo: { background: 'bg-hanji', ground: 'squirrel', 'branch-1': 'cheongsachorong', 'branch-2': 'fairy-lights', 'branch-3': 'gotgam', 'branch-4': 'cheongsachorong', topper: 'star' },
  cherry: { background: 'bg-spring-river', ground: 'bench', 'branch-1': 'cherry-ribbon', 'branch-2': 'fairy-lights', 'branch-3': 'cherry-ribbon', 'branch-4': 'fairy-lights', topper: 'ribbon' },
  xmas: { background: 'bg-snow-night', ground: 'snowman', 'branch-1': 'ornament', 'branch-2': 'fairy-lights', 'branch-3': 'ornament', 'branch-4': 'ornament', topper: 'star' },
};

// Same shape as GET /api/me/tree slots.
function sampleSlots(species, stage, decorate) {
  const open = new Set(Object.keys(STAGES).slice(0, Object.keys(STAGES).indexOf(stage) + 1).flatMap(s => UNLOCK[s]));
  return Object.entries(SAMPLE[species]).map(([slot, item]) => ({ slot, item_id: decorate ? item : null, unlocked: open.has(slot), visible: decorate }));
}

function Gallery() {
  const [species, setSpecies] = useState('maple');
  const [stage, setStage] = useState('grown');
  const [decorate, setDecorate] = useState(true);
  const [fit, setFit] = useState(false);
  const order = Object.keys(STAGES);
  // Grow one stage (wraps back to a sprout) to watch the growth transition.
  const grow = () => setStage(order[(order.indexOf(stage) + 1) % order.length]);
  return <main className="tg">
    <h1>나무 갤러리 <small>개발용 · 임시 에셋</small></h1>
    <section className="tg-hero">
      <LayeredTree species={species} stage={stage} slots={sampleSlots(species, stage, decorate)} label={`${SPECIES[species]} ${STAGES[stage]}`}/>
      <div className="tg-controls">
        <div>{Object.entries(SPECIES).map(([k, v]) => <button key={k} aria-pressed={species === k} onClick={() => setSpecies(k)}>{v}</button>)}</div>
        <div>{Object.entries(STAGES).map(([k, v]) => <button key={k} aria-pressed={stage === k} onClick={() => setStage(k)}>{v}</button>)}</div>
        <label><input type="checkbox" checked={decorate} onChange={e => setDecorate(e.target.checked)}/> 장식 달기</label>
        <div><button className="tg-grow" onClick={grow}>{stage === 'grown' ? '새싹부터 다시' : '한 단계 키우기'}</button></div>
        <label><input type="checkbox" checked={fit} onChange={e => setFit(e.target.checked)}/> 아래 비교표를 같은 높이로 맞추기</label>
        <p>나무를 끌어 보세요. 휴대폰에서는 "기울여 보기"로 기울기를 켤 수 있어요.</p>
      </div>
    </section>
    <section className="tg-grid">
      {Object.keys(SPECIES).flatMap(sp => Object.keys(STAGES).map(st => <figure key={`${sp}-${st}`}>
        <LayeredTree species={sp} stage={st} slots={sampleSlots(sp, st, decorate)} interactive={false} fit={fit}/>
        <figcaption>{SPECIES[sp]} · {STAGES[st]}</figcaption>
      </figure>))}
    </section>
  </main>;
}

const style = document.createElement('style');
style.textContent = `
body { margin: 0; background: #f3ecdc; color: #3b2f25; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
.tg { max-width: 1180px; margin: 0 auto; padding: 24px 16px 60px; }
.tg h1 { font-size: 22px; } .tg h1 small { font-size: 12px; color: #8a7663; font-weight: 400; }
.tg-hero { display: grid; grid-template-columns: minmax(0, 520px) 1fr; gap: 24px; align-items: start; }
.tg-controls div { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.tg-controls button { padding: 8px 12px; border: 1px solid #5b4a3a55; border-radius: 999px; background: #fbf7ec; }
.tg-controls button[aria-pressed='true'] { background: #3b2f25; color: #fbf7ec; }
.tg-controls p { font-size: 13px; color: #7d6a58; }
.tg-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 28px; }
.tg-grid figure { margin: 0; } .tg-grid figcaption { text-align: center; font-size: 12px; margin-top: 6px; }
@media (max-width: 700px) { .tg-hero { grid-template-columns: 1fr; } .tg-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;
document.head.appendChild(style);
createRoot(document.getElementById('root')).render(<Gallery/>);
