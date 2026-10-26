const FONT_ID = 'kauroong-brush-font';

// Brush-script headings (watercolor map, 나만의 나무). Google Fonts splits Korean fonts into
// unicode-range slices, so the browser only downloads the slices for glyphs on screen.
export function loadBrushFont() {
  if (typeof document === 'undefined' || document.getElementById(FONT_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_ID;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Nanum+Brush+Script&display=swap';
  document.head.appendChild(link);
}
