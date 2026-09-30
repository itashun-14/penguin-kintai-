// ぺんぎん勤怠 — 画面の組み立て
import {
  computeMonth, computeDay, fmtDur, durHTML, fmtClock, suggestedLeaveTime, todayString, WEEKDAY_JA,
} from './calc.js';
import { getState, subscribe } from './store.js';
import { SEASONS, applySeason, confetti } from './season.js';
import { moodFor, say, SPRITE } from './mascot.js';
import { recognizeFiles } from './ocr.js';
import {
  esc, toast, openEditor, openImportConfirm, openPaste, openSettings, showProgress,
} from './sheets.js';

const $ = (s) => document.querySelector(s);
const els = {
  title: $('#monthTitle'), season: $('#seasonName'), hero: $('#hero'), list: $('#list'),
  mascot: $('#mascot'), mascotImg: $('#mascotImg'), bubbleText: $('#bubbleText'), footNote: $('#footNote'),
};

const now = new Date();
let view = { year: now.getFullYear(), month: now.getMonth() + 1 };
let shownKey = ''; // 月が変わったときだけ背景やアニメを切り替える
let mood = null;
const celebrated = new Set();
const achievedBefore = new Map(); // 月 → 前回の描画で達成していたか

const monthKey = () => `${view.year}-${view.month}`;

function shiftMonth(delta) {
  const d = new Date(view.year, view.month - 1 + delta, 1);
  view = { year: d.getFullYear(), month: d.getMonth() + 1 };
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 描画 ----------

function render() {
  const today = todayString();
  const st = getState();
  const m = computeMonth(st, view.year, view.month, today);
  const isCurrent = today.startsWith(`${view.year}-${String(view.month).padStart(2, '0')}`);
  const monthChanged = shownKey !== monthKey();

  if (monthChanged) {
    const s = applySeason(view.month);
    els.season.textContent = `${s.name} ・ ${s.hello}`;
    els.title.textContent = `${view.year}年${view.month}月`;
  }

  const todayDay = isCurrent ? m.days.find((d) => d.date === today) : null;
  const leaveAtMin = todayDay ? suggestedLeaveTime(todayDay, m.settings) : null;
  const leaveAt = leaveAtMin != null ? fmtClock(leaveAtMin) : null;

  renderHero(m, { isCurrent, todayDay, leaveAt, animate: monthChanged });
  renderList(m, today, monthChanged);
  renderMascot(m, { isCurrent, today: todayDay, leaveAt }, monthChanged);
  els.footNote.textContent = `目標 ＝ 所定出勤日 ${m.scheduledDays}日（土日祝をのぞく）× ${fmtDur(m.settings.dailyMinutes)}`;
  shownKey = monthKey();
}

function renderHero(m, { isCurrent, todayDay, leaveAt, animate }) {
  const rem = m.remainingMin;
  const empty = m.recordedScheduled === 0 && m.actualMin === 0;
  const over = m.achieved;
  const pct = m.targetMin ? Math.min(1, Math.max(0, m.actualMin / m.targetMin)) : 0;

  const exact = over && rem === 0;
  const label = exact ? '目標クリア！ ぴったり' : over ? '目標クリア！ 超過' : '今月あと';
  const big = exact ? durHTML(0) : over ? durHTML(-rem, { signed: true }) : durHTML(Math.max(rem, 0));

  let pace = '';
  if (m.futureDays > 0 && rem > 0 && m.paceMin > 16 * 60) {
    // 1日16時間を超えるペースは現実的でない = 記録の読み込み漏れの可能性が高い
    pace = `残り <b>${m.futureDays}日</b> で <b>${fmtDur(rem)}</b> が必要です。読み込み漏れがないか確認してね`;
  } else if (m.futureDays > 0 && rem > 0) {
    pace = `残り <b>${m.futureDays}日</b> ＝ 1日あたり <b class="pace-num">${fmtDur(m.paceMin)}</b> でOK`;
  } else if (rem <= 0 && !empty) {
    pace = 'この先の勤務は、そのまま貯金になります ✨';
  } else if (m.futureDays === 0 && rem > 0) {
    pace = `この月は <b>${fmtDur(rem)}</b> 足りませんでした`;
  }
  if (todayDay?.status === 'working' && leaveAt) {
    pace += `${pace ? '<br>' : ''}今日は <b>${leaveAt}</b> に退勤で7時間ちょうど`;
  }
  const warn =
    isCurrent && m.missingPast > 0
      ? `<p class="hero-warn">📷 記録のない平日が ${m.missingPast}日 あります。スクショを読み込んでね</p>`
      : '';

  const balCls = m.balanceMin > 0 ? 'pos' : m.balanceMin < 0 ? 'neg' : '';
  const balNote = m.recordedScheduled === 0 ? '—' : m.balanceMin >= 0 ? '貯金あり' : '足りない分';

  els.hero.innerHTML = `
    <div class="hero-main">
      <p class="hero-label">${label}</p>
      <p class="hero-big ${over ? 'is-over' : ''}" id="heroBig" data-min="${over ? -rem : Math.max(rem, 0)}" data-signed="${over && !exact ? 1 : 0}">${big}</p>
    </div>
    <div class="track" role="img" aria-label="目標に対して${Math.round(pct * 100)}%">
      <div class="track-bar"><div class="track-fill" id="trackFill" style="width:${animate ? 0 : pct * 100}%"></div></div>
      <img class="walker" id="walker" src="${SPRITE.walk}" alt="" style="left:${walkerLeft(animate ? 0 : pct)}">
      <span class="goal" aria-hidden="true">🚩</span>
    </div>
    <div class="stats">
      <div class="stat"><span class="stat-l">目標</span><span class="stat-v">${durHTML(m.targetMin)}</span><span class="stat-s">${m.scheduledDays}日 × ${fmtDur(m.settings.dailyMinutes)}</span></div>
      <div class="stat"><span class="stat-l">実績</span><span class="stat-v">${durHTML(m.actualMin)}</span><span class="stat-s">${m.recordedScheduled}日分</span></div>
      <div class="stat"><span class="stat-l">フル出勤比</span><span class="stat-v ${balCls}">${m.recordedScheduled ? durHTML(m.balanceMin, { signed: true }) : '—'}</span><span class="stat-s">${balNote}</span></div>
    </div>
    ${pace ? `<p class="pace">${pace}</p>` : ''}
    ${warn}`;

  if (animate) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const fill = $('#trackFill');
        const walker = $('#walker');
        if (!fill || !walker) return;
        walker.classList.add('moving');
        fill.style.width = `${pct * 100}%`;
        walker.style.left = walkerLeft(pct);
        setTimeout(() => walker.classList.remove('moving'), 1700);
        countUp($('#heroBig'));
      }),
    );
  }
}

// ペンギンがバーの端からはみ出さない位置
const walkerLeft = (p) => `clamp(17px, ${p * 100}%, calc(100% - 17px))`;

function countUp(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = Number(el.dataset.min);
  const signed = el.dataset.signed === '1';
  if (!target) return;
  const t0 = performance.now();
  const dur = 900;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const v = Math.round(target * (1 - Math.pow(1 - p, 3)));
    el.innerHTML = signed ? durHTML(v, { signed: true }) : durHTML(v);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function dayRow(d, today) {
  const kindCls = d.kind === 'off' ? 'is-off' : d.kind === 'holiday' || d.weekday === 0 ? 'is-sun' : d.weekday === 6 ? 'is-sat' : '';
  const classes = ['day', kindCls, d.date === today ? 'is-today' : '', d.date > today ? 'is-future' : ''];
  const num = Number(d.date.slice(8));
  const dow = WEEKDAY_JA[d.weekday];

  let main = '';
  let work = '';
  let diff = '';
  if (d.status === 'done' || d.status === 'working' || d.status === 'invalid') {
    const tin = d.inMin != null ? fmtClock(d.inMin) : '--:--';
    const tout = d.outMin != null ? fmtClock(d.outMin) : d.status === 'working' ? '勤務中' : '--:--';
    main = `<span class="d-times">${tin} – ${tout}</span><span class="d-sub">休憩 ${d.breakMin}分${d.status === 'invalid' ? ' ・ <b class="neg">時刻を確認</b>' : ''}</span>`;
  } else if (d.status === 'leave') {
    main = `<span class="d-times">有給</span>`;
  } else if (d.kind === 'off') {
    main = `<span class="d-rest">休み扱い</span>`;
  } else if (d.kind === 'holiday') {
    main = `<span class="d-rest">${esc(d.holiday)}</span>`;
  } else if (d.kind === 'weekend') {
    main = `<span class="d-rest">おやすみ</span>`;
  } else {
    main = `<span class="d-none">${d.date <= today ? '記録なし' : ''}</span>`;
  }
  if (d.leaveMin && d.status !== 'leave') {
    main = main.replace('</span></span>', '</span></span>');
  }
  const badge = d.leaveMin
    ? `<span class="badge-leave">🏖 有給 ${fmtDur(d.leaveMin)}</span>`
    : '';
  if (d.counted) {
    work = durHTML(d.creditedMin);
    diff = `<span class="${d.diffMin > 0 ? 'pos' : d.diffMin < 0 ? 'neg' : ''}">${durHTML(d.diffMin, { signed: true })}</span>`;
  }
  const quiet = !d.scheduled && d.status === 'empty';
  return `
    <button class="${classes.filter(Boolean).join(' ')}${quiet ? ' quiet' : ''}" data-date="${d.date}" style="--i:${Math.min(num, 24)}">
      <span class="d-date"><b>${num}</b><i>${dow}</i></span>
      <span class="d-main">${main}${badge}</span>
      <span class="d-num"><span class="d-work">${work}</span><span class="d-diff">${diff}</span></span>
    </button>`;
}

function renderList(m, today, animate) {
  els.list.classList.toggle('enter', animate); // 行のふわっと表示は月を切り替えたときだけ
  const head = `
    <div class="list-head">
      <h2>日ごとの記録</h2>
      <span class="list-hint">タップして編集</span>
      ${m.days.some((d) => d.date === today) ? '<button class="chip" id="btnToday">今日へ</button>' : ''}
    </div>
    <div class="day-cols" aria-hidden="true"><span>日</span><span>出勤 – 退勤</span><span>勤務 / ${fmtDur(m.settings.dailyMinutes)}との差</span></div>`;
  els.list.innerHTML = head + m.days.map((d) => dayRow(d, today)).join('');
}

function renderMascot(m, ctx, monthChanged) {
  mood = moodFor(m, ctx);
  const prevSrc = els.mascotImg.getAttribute('src');
  if (prevSrc !== mood.sprite) els.mascotImg.src = mood.sprite;
  els.mascot.className = `mascot is-${mood.mood}`;
  if (monthChanged || !els.bubbleText.textContent) els.bubbleText.textContent = mood.say();
  // 編集や読み込みで「達成」になった瞬間、または今月がすでに達成済みで開いたとき(1回だけ)に紙吹雪
  const key = monthKey();
  const justAchieved = m.achieved && achievedBefore.get(key) === false;
  const openedAchieved = m.achieved && ctx.isCurrent && monthChanged && !celebrated.has(key);
  if (justAchieved || openedAchieved) {
    celebrated.add(key);
    setTimeout(confetti, 500);
  }
  achievedBefore.set(key, m.achieved);
}

// ---------- 操作 ----------

$('#btnPrev').addEventListener('click', () => shiftMonth(-1));
$('#btnNext').addEventListener('click', () => shiftMonth(1));

els.mascot.addEventListener('click', () => {
  els.mascot.classList.remove('jump');
  void els.mascot.offsetWidth;
  els.mascot.classList.add('jump');
  els.bubbleText.textContent = mood ? mood.say() : '';
  els.bubbleText.parentElement.classList.remove('pop');
  void els.bubbleText.offsetWidth;
  els.bubbleText.parentElement.classList.add('pop');
});

els.list.addEventListener('click', (e) => {
  if (e.target.closest('#btnToday')) {
    const row = els.list.querySelector('.is-today');
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const row = e.target.closest('.day');
  if (row) openEditor(row.dataset.date);
});

// スクショの読み込み
const fileInput = $('#fileInput');
$('#btnImport').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (files.length) importFiles(files);
});

async function importFiles(files) {
  const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(f.name));
  if (!imgs.length) return toast('画像ファイルを選んでください');
  const prog = showProgress();
  els.mascotImg.src = SPRITE.loupe;
  try {
    const res = await recognizeFiles(imgs, prog.update, { year: view.year, month: view.month });
    prog.close();
    if (!res.rows.length) {
      toast('出勤・退勤の行が見つかりませんでした。別の画像か、テキスト貼り付けを試してください');
      return;
    }
    confirmImport(res);
  } catch (err) {
    prog.close();
    console.error(err);
    toast(`読み取りに失敗しました：${err.message}`);
  } finally {
    render();
  }
}

function confirmImport(res) {
  openImportConfirm(res, (rows) => {
    const first = rows[0]?.date;
    if (first) {
      view = { year: Number(first.slice(0, 4)), month: Number(first.slice(5, 7)) };
    }
    render();
    toast(`${rows.length}日分を反映しました 🐧`);
    els.mascot.classList.add('jump');
    els.bubbleText.textContent = 'ありがとう！計算したよ';
  });
}

$('#btnPaste').addEventListener('click', () => openPaste(view, confirmImport));
$('#btnSettings').addEventListener('click', () => openSettings(render));

// 画像のドラッグ&ドロップ(PC用)
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
});

// 日付が変わった/戻ってきたら再計算
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
subscribe(render);

// 左右スワイプで月移動
let sx = null;
document.addEventListener('touchstart', (e) => (sx = e.touches.length === 1 ? e.touches[0].clientX : null), { passive: true });
document.addEventListener(
  'touchend',
  (e) => {
    if (sx == null || document.body.classList.contains('no-scroll')) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = 0;
    sx = null;
    if (Math.abs(dx) > 90 && !dy && !e.target.closest('input, .sheet')) shiftMonth(dx < 0 ? 1 : -1);
  },
  { passive: true },
);

render();

// ホーム画面に追加したときにオフラインでも開けるように
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.search.includes('sw=1'))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 開発用フック(localhostでのみ)
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__app = { importFiles, confirmImport, render, confetti, view: () => view, computeMonth, computeDay, getState };
}
