// 月ごとの背景・色・舞い落ちるもの。
const P = (type, colors, count, extra = {}) => ({ type, colors, count, ...extra });

export const SEASONS = {
  1: { name: 'お正月', hello: 'あけましておめでとう', accent: '#e8443a', soft: '#ffe6df', ink: '#a3261d', particle: P('sparkle', ['#f6cf6b', '#ffe6a3', '#ffffff'], 16) },
  2: { name: '雪と梅', hello: 'あったかくしてね', accent: '#5aa6d8', soft: '#e3f1fb', ink: '#2c6d9c', particle: P('snow', ['#ffffff', '#eaf5ff'], 26) },
  3: { name: 'ひなまつり', hello: 'もうすぐ春だね', accent: '#f27b9a', soft: '#ffe6ee', ink: '#b8496a', particle: P('petal', ['#ffc8d6', '#ffdde6', '#ffb3c6'], 14) },
  4: { name: 'お花見', hello: '桜が満開だよ', accent: '#f58bb0', soft: '#ffe8f1', ink: '#b8497a', particle: P('petal', ['#ffc6da', '#ffdbe8', '#ffffff'], 22) },
  5: { name: 'こいのぼり', hello: 'さわやかな風だね', accent: '#3fa0e6', soft: '#e0f1fd', ink: '#21709f', particle: P('leaf', ['#a8dc8b', '#c6ecab', '#8ccf78'], 12) },
  6: { name: 'あじさい', hello: 'しっとり雨の季節', accent: '#7f8fe6', soft: '#e8ebfc', ink: '#4a58b0', particle: P('rain', ['#ffffff', '#cfe3f7'], 30) },
  7: { name: '七夕', hello: '星に願いを', accent: '#7a6fe0', soft: '#ebe8fc', ink: '#4c41a8', particle: P('star', ['#ffe08a', '#ffffff', '#fff3bd'], 20) },
  8: { name: '夏まつり', hello: '暑いから無理しないでね', accent: '#20b5c8', soft: '#dcf6fa', ink: '#127a89', particle: P('firework', ['#ff9a8b', '#ffd75e', '#7ed6e0', '#ffffff', '#f7a8d8'], 10) },
  9: { name: 'お月見', hello: '月がきれいだよ', accent: '#e8a13a', soft: '#fff0d6', ink: '#9a6410', particle: P('glow', ['#ffe9a6', '#fff4cf', '#ffd98a'], 18) },
  10: { name: 'ハロウィン', hello: 'トリックオアトリート', accent: '#f08a2c', soft: '#ffead2', ink: '#a5540a', particle: P('leaf', ['#ff9a3c', '#8a6fd0', '#ffb45e'], 14, { bat: true }) },
  11: { name: '紅葉', hello: '秋も深まってきたね', accent: '#e05a45', soft: '#ffe5df', ink: '#a6301f', particle: P('leaf', ['#e8574a', '#f59a4b', '#f7d35b'], 20) },
  12: { name: 'クリスマス', hello: 'メリークリスマス', accent: '#d94a52', soft: '#ffe4e6', ink: '#a12a32', particle: P('snow', ['#ffffff', '#fff6e0'], 30) },
};

const rand = (a, b) => a + Math.random() * (b - a);
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let burstTimer = null;

/** 背景・アクセント色を切り替える */
export function applySeason(month, root = document.documentElement) {
  const s = SEASONS[month];
  const pad = String(month).padStart(2, '0');
  root.style.setProperty('--accent', s.accent);
  // color-mix 非対応の古い端末だけ、用意した色を直接使う
  if (!CSS.supports('color', 'color-mix(in srgb, red, blue)')) {
    root.style.setProperty('--accent-soft', s.soft);
    root.style.setProperty('--accent-ink', s.ink);
  }
  // CSS変数のurl()はstyle.cssからの相対になるので、ページ基準の絶対URLにする
  const bgUrl = new URL(`assets/season/${pad}.jpg`, document.baseURI).href;
  root.style.setProperty('--bg-url', `url("${bgUrl}")`);
  root.dataset.season = String(month);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.soft);
  buildParticles(s);
  return s;
}

function buildParticles(s) {
  const box = document.getElementById('particles');
  if (!box) return;
  clearTimeout(burstTimer);
  box.replaceChildren();
  if (reduced()) return;
  const { type, colors, count, bat } = s.particle;
  box.dataset.type = type;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = `p p-${type}`;
    const size = type === 'rain' ? rand(14, 26) : type === 'snow' ? rand(4, 10) : type === 'sparkle' || type === 'glow' ? rand(5, 11) : rand(9, 17);
    el.style.setProperty('--x', `${rand(0, 100)}%`);
    el.style.setProperty('--sz', `${size}px`);
    el.style.setProperty('--dur', `${type === 'rain' ? rand(0.9, 1.6) : type === 'star' || type === 'sparkle' || type === 'glow' ? rand(3, 6) : rand(9, 17)}s`);
    el.style.setProperty('--delay', `${-rand(0, 16)}s`);
    el.style.setProperty('--drift', `${rand(-60, 60)}px`);
    el.style.setProperty('--rot', `${rand(180, 540)}deg`);
    el.style.setProperty('--c', colors[i % colors.length]);
    el.style.setProperty('--y', `${rand(2, 92)}%`);
    if (type !== 'firework') box.append(el);
  }
  if (bat) startBats(box);
  if (type === 'firework') scheduleFirework(box, colors);
}

function startBats(box) {
  const fly = () => {
    if (!box.isConnected || box.dataset.type !== 'leaf') return;
    const b = document.createElement('i');
    b.className = 'bat';
    b.style.setProperty('--y', `${rand(6, 30)}%`);
    b.style.setProperty('--dur', `${rand(7, 11)}s`);
    box.append(b);
    b.addEventListener('animationend', () => b.remove());
    burstTimer = setTimeout(fly, rand(6000, 12000));
  };
  burstTimer = setTimeout(fly, 2500);
}

function scheduleFirework(box, colors) {
  const boom = () => {
    if (!box.isConnected || box.dataset.type !== 'firework') return;
    burst(box, rand(15, 85), rand(8, 38), colors[Math.floor(Math.random() * colors.length)]);
    burstTimer = setTimeout(boom, rand(1400, 3200));
  };
  burstTimer = setTimeout(boom, 800);
}

/** 打ち上げ花火/紙吹雪のような放射状のはじけ */
export function burst(box, xPct, yPct, color, n = 14, dist = 54) {
  if (reduced()) return;
  const g = document.createElement('div');
  g.className = 'burst';
  g.style.left = `${xPct}%`;
  g.style.top = `${yPct}%`;
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i');
    const a = (Math.PI * 2 * i) / n;
    d.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    d.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
    d.style.setProperty('--c', color);
    g.append(d);
  }
  box.append(g);
  setTimeout(() => g.remove(), 1400);
}

/** 目標達成のお祝い: 画面上から紙吹雪 */
export function confetti() {
  if (reduced()) return;
  const box = document.getElementById('confetti');
  if (!box) return;
  const colors = ['#ff9a8b', '#ffd75e', '#7ed6e0', '#a78bfa', '#7bd88f', '#ffffff'];
  for (let i = 0; i < 46; i++) {
    const c = document.createElement('i');
    c.style.setProperty('--x', `${rand(0, 100)}%`);
    c.style.setProperty('--c', colors[i % colors.length]);
    c.style.setProperty('--dur', `${rand(2.4, 4.2)}s`);
    c.style.setProperty('--delay', `${rand(0, 0.9)}s`);
    c.style.setProperty('--drift', `${rand(-80, 80)}px`);
    c.style.setProperty('--rot', `${rand(360, 900)}deg`);
    box.append(c);
    setTimeout(() => c.remove(), 5500);
  }
}
