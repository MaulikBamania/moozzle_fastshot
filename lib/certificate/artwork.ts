/** Inline SVG artwork for the printed MOOZZLE certificate (no network or font dependencies). */

const COW_PATH =
  'M14 26C14 20 20 18 30 18L82 17C88 17 92 14 96 12L100 8L101.5 12.5L106 12.5C112 15 116 21 117 27C117.5 31 112 32.5 108 30.5C104 30.5 100 32 96 36C94 40 92 44 90 46L90 62L86 62L85 48L82 48L82 62L78 62L77 47C66 50 46 50 36 47L35 62L31 62L30 48L27 47L26 62L22 62C21 54 18 46 16 40C14 36 13 33 14 30L12 32L10 46L8 46L11 29Z';

export function cowSvg(color: string, width: number, flip = false): string {
  const transform = flip ? ' transform="translate(124 0) scale(-1 1)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${(width * 66) / 124}" viewBox="0 0 124 66"><g${transform}><path d="${COW_PATH}" fill="${color}"/></g></svg>`;
}

function tree(x: number, base: number, size: number, color: string): string {
  return `<rect x="${x - size * 0.06}" y="${base - size * 0.55}" width="${size * 0.12}" height="${size * 0.55}" fill="#5b4a2f"/><circle cx="${x}" cy="${base - size * 0.75}" r="${size * 0.38}" fill="${color}"/><circle cx="${x - size * 0.22}" cy="${base - size * 0.6}" r="${size * 0.26}" fill="${color}"/><circle cx="${x + size * 0.22}" cy="${base - size * 0.6}" r="${size * 0.26}" fill="${color}"/>`;
}

function placedCow(x: number, y: number, width: number, color: string, flip = false): string {
  const scale = width / 124;
  const mirror = flip ? `translate(${width} 0) scale(-1 1) ` : '';
  return `<g transform="translate(${x} ${y}) ${mirror}scale(${scale})"><path d="${COW_PATH}" fill="${color}"/></g>`;
}

/** Banner silhouettes: three cattle in translucent dark green over the green ribbon. */
export function bannerHerdSvg(): string {
  const fill = 'rgba(10,70,32,0.42)';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="70" viewBox="0 0 300 70">${placedCow(0, 34, 62, fill)}${placedCow(70, 22, 86, fill, true)}${placedCow(170, 6, 120, fill)}</svg>`;
}

/** Footer pasture: rolling hills, tree line, village skyline and grazing cattle. */
export function pastureSvg(): string {
  const trees = [18, 70, 118, 196, 262, 330, 402, 470, 530, 598, 668, 724, 776]
    .map((x, index) => tree(x, 70 + (index % 3) * 2, 26 + (index % 4) * 6, index % 2 ? '#3f8f4a' : '#2f7a3d'))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="88" viewBox="0 0 794 112" preserveAspectRatio="none">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#e3f1e2"/></linearGradient>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8cc63f"/><stop offset="1" stop-color="#4f9a35"/></linearGradient>
    <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0f6b36"/><stop offset="0.6" stop-color="#1f8a44"/><stop offset="1" stop-color="#0b5aa8"/></linearGradient>
  </defs>
  <rect width="794" height="112" fill="url(#sky)"/>
  <path d="M0 62 Q120 44 250 58 T520 52 T794 56 L794 80 L0 80Z" fill="#cfe6c9"/>
  <g fill="#b9d7b3"><rect x="560" y="36" width="10" height="26"/><rect x="574" y="28" width="12" height="34"/><rect x="590" y="40" width="9" height="22"/><path d="M640 62 L640 36 Q648 26 656 36 L656 62Z"/></g>
  ${trees}
  <path d="M0 78 Q160 60 330 74 T660 70 T794 72 L794 112 L0 112Z" fill="url(#field)"/>
  ${placedCow(250, 54, 52, '#2e5e2a')}${placedCow(392, 42, 78, '#5aa83a', true)}${placedCow(472, 40, 84, '#6b6b5c')}${placedCow(560, 58, 48, '#3c3c32', true)}${placedCow(140, 66, 40, '#4b6b3a')}
  <path d="M0 98 Q260 80 470 96 T794 88 L794 112 L0 112Z" fill="url(#wave)"/>
  <path d="M0 104 Q300 90 520 104 T794 98 L794 112 L0 112Z" fill="#ffffff"/>
</svg>`;
}

/** Stylised map tile with roads and a red pin; a visual cue only, not a rendered map. */
export function mapPreviewSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="92" height="58" viewBox="0 0 92 58">
  <rect width="92" height="58" rx="6" fill="#f3efe4"/>
  <path d="M0 18 L92 10" stroke="#ffffff" stroke-width="5"/><path d="M0 44 L92 38" stroke="#ffffff" stroke-width="4"/>
  <path d="M30 0 L38 58" stroke="#ffffff" stroke-width="5"/><path d="M66 0 L60 58" stroke="#f6d27a" stroke-width="4"/>
  <rect x="6" y="24" width="18" height="12" rx="2" fill="#d6ead0"/><rect x="72" y="18" width="14" height="14" rx="2" fill="#d6ead0"/>
  <path d="M48 12 C41 12 37 17 37 22 C37 30 48 40 48 40 C48 40 59 30 59 22 C59 17 55 12 48 12Z" fill="#e53935"/><circle cx="48" cy="22" r="4" fill="#ffffff"/>
</svg>`;
}

/** Handwritten-style signature stroke. */
export function signatureSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="48" viewBox="0 0 150 48"><path d="M14 40 C16 26 18 12 22 6 C24 3 27 6 25 12 C22 22 16 30 20 32 C26 34 34 18 40 20 C44 22 38 32 44 32 C50 32 54 22 58 24 C62 26 58 32 64 31 C72 30 78 22 84 24 C90 26 86 32 94 30 C104 28 120 20 140 18" fill="none" stroke="#14284b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 38 C60 34 96 32 132 30" fill="none" stroke="#14284b" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}

type IconName = 'cow' | 'user' | 'calendar' | 'pin' | 'flask' | 'fingerprint' | 'document' | 'shield' | 'leaf' | 'trace' | 'manage' | 'sustain';

const ICON_BODY: Record<Exclude<IconName, 'cow'>, string> = {
  user: '<circle cx="12" cy="7.5" r="4.5" fill="C"/><path d="M3 22c0-5 4-8.5 9-8.5s9 3.5 9 8.5z" fill="C"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="C" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="C" stroke-width="2" stroke-linecap="round"/><g fill="C"><rect x="6.5" y="12.5" width="3" height="2.5"/><rect x="10.5" y="12.5" width="3" height="2.5"/><rect x="14.5" y="12.5" width="3" height="2.5"/><rect x="6.5" y="16.5" width="3" height="2.5"/><rect x="10.5" y="16.5" width="3" height="2.5"/></g>',
  pin: '<path d="M12 2C7.6 2 4.5 5.3 4.5 9.4 4.5 15 12 22 12 22s7.5-7 7.5-12.6C19.5 5.3 16.4 2 12 2z" fill="C"/><circle cx="12" cy="9.4" r="3" fill="#fff"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3" fill="none" stroke="C" stroke-width="2" stroke-linejoin="round"/><path d="M7.5 15h9" stroke="C" stroke-width="2"/><circle cx="12" cy="11.5" r="1.2" fill="C"/>',
  fingerprint: '<g fill="none" stroke="C" stroke-width="1.6" stroke-linecap="round"><path d="M5 9a7.5 7.5 0 0 1 14 0"/><path d="M4 14c0-4.6 3.6-8 8-8s8 3.4 8 8"/><path d="M7 19c-.6-1.6-1-3.3-1-5a6 6 0 0 1 12 0c0 1.4-.2 2.8-.6 4"/><path d="M9.5 21c-.8-2-1.3-4.3-1.3-7a3.8 3.8 0 0 1 7.6 0c0 2-.3 3.6-.8 5.2"/><path d="M12 14c0 2.8.5 5.2 1.4 7.4"/></g>',
  document: '<path d="M6 2h8l5 5v15H6z" fill="none" stroke="C" stroke-width="2" stroke-linejoin="round"/><path d="M14 2v5h5M9 12h7M9 15.5h7M9 19h4" stroke="C" stroke-width="1.8" stroke-linecap="round"/>',
  shield: '<path d="M12 1.5 3.5 5v6.2c0 5.4 3.6 9.6 8.5 11.3 4.9-1.7 8.5-5.9 8.5-11.3V5z" fill="C"/><path d="m8 12 3 3 5.5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  leaf: '<path d="M21 3C9 3 3 9 4 19c8 1 15-4 17-16z" fill="C"/><path d="M4 20 15 9" stroke="#fff" stroke-width="1.4"/>',
  trace: '<circle cx="12" cy="12" r="10" fill="none" stroke="C" stroke-width="2"/><path d="M12 6c-2.4 0-4 1.8-4 3.8C8 13 12 17.5 12 17.5s4-4.5 4-7.7C16 7.8 14.4 6 12 6z" fill="C"/>',
  manage: '<circle cx="12" cy="12" r="10" fill="none" stroke="C" stroke-width="2"/><path d="M7 16v-4l5-4 5 4v4z" fill="C"/>',
  sustain: '<circle cx="12" cy="12" r="10" fill="none" stroke="C" stroke-width="2"/><path d="M17 7c-6 0-9 3-8.5 8 4 .5 7.5-2 8.5-8zM7 17l5-5" fill="C" stroke="C" stroke-width="1"/>',
};

export function iconSvg(name: IconName, color: string, size: number): string {
  if (name === 'cow') return cowSvg(color, size * 1.4, true);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${ICON_BODY[name].replace(/"C"/g, `"${color}"`)}</svg>`;
}
