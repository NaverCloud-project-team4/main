// District bottom sheet: closed → preview → full. Pure reducer (no DOM) for node --test.
export const SHEET_MODES = ['closed', 'preview', 'full'];
export const initialSheet = Object.freeze({ mode: 'closed', tab: 'spots' });

const DRAG_DISTANCE = 60; // px a slow drag must travel to change mode
const FLING_SPEED = 0.5; // px/ms; a faster release follows its direction

/** Snap after a drag: dy and velocity are positive downwards. Moves at most one step. */
export function snapMode(mode, dy, velocity = 0) {
  const fling = Math.abs(velocity) >= FLING_SPEED;
  const up = fling ? velocity < 0 : dy <= -DRAG_DISTANCE;
  const down = fling ? velocity > 0 : dy >= DRAG_DISTANCE;
  const index = SHEET_MODES.indexOf(mode);
  if (up) return SHEET_MODES[Math.min(2, Math.max(1, index + 1))]; // a drag up never closes
  if (down) return SHEET_MODES[Math.max(0, index - 1)];
  return mode;
}

export function sheetReducer(state, action) {
  switch (action.type) {
    // Choosing a district opens the preview; while open, only the content changes.
    case 'select': return state.mode === 'closed' ? { ...state, mode: 'preview' } : state;
    case 'close': return state.mode === 'closed' ? state : { ...state, mode: 'closed' };
    case 'expand': return { ...state, mode: 'full' };
    case 'collapse': return state.mode === 'full' ? { ...state, mode: 'preview' } : state;
    case 'toggle': return { ...state, mode: state.mode === 'full' ? 'preview' : 'full' };
    case 'drag': return { ...state, mode: snapMode(state.mode, action.dy, action.velocity) };
    // Picking a tab from the preview also opens the sheet fully.
    case 'tab': return { ...state, tab: action.tab, mode: state.mode === 'closed' ? 'closed' : 'full' };
    default: return state;
  }
}
