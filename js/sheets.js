// 下から出てくるシート類: 日の編集 / 読み取り結果の確認 / テキスト貼り付け / 設定 / 読み取り中
import { computeDay, fmtDur, fmtDurSigned, WEEKDAY_JA, weekdayOf, BREAK_STEP } from './calc.js';
import { getState, setDay, applyRows, setSettings, exportJSON, importJSON, clearAll, isStorageOk } from './store.js';
import { parseAttendance } from './parse.js';
import { SPRITE } from './mascot.js';

const root = document.getElementById('sheetRoot');

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dowOf = (date) => WEEKDAY_JA[weekdayOf(date)];
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ---------- 土台 ----------

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function openSheet(title, { onClose, tall = false } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const sheet = document.createElement('div');
  sheet.className = `sheet${tall ? ' tall' : ''}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <header class="sheet-head"><h2>${title}</h2><button class="sheet-x" aria-label="閉じる">✕</button></header>
    <div class="sheet-body"></div>`;
  root.append(backdrop, sheet);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    sheet.classList.add('show');
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('show');
    sheet.classList.remove('show');
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
      if (!root.children.length) document.body.classList.remove('no-scroll');
    }, 260);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);
  sheet.querySelector('.sheet-x').addEventListener('click', close);
  return { sheet, body: sheet.querySelector('.sheet-body'), close };
}

/** 押しっぱなしで連続入力できるボタン */
function holdRepeat(btn, fn) {
  let timer;
  let interval;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(interval);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stop(); // 押し直しでタイマーが重ならないように
    fn();
    timer = setTimeout(() => (interval = setInterval(fn, 110)), 420);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && fn());
}

// ---------- 日の編集 ----------

const BREAK_CHIPS = [
  [0, 'なし'],
  [30, '30分'],
  [45, '45分'],
  [60, '1時間'],
  [90, '1時間30分'],
];

export function openEditor(date) {
  const wd = dowOf(date);
  const { body } = openSheet(`${md(date)}（${wd}）`);
  const st0 = getState();
  const maxHours = Math.max(1, Math.floor(st0.settings.dailyMinutes / 60));

  body.innerHTML = `
    <p class="ed-holiday" id="edHoliday"></p>
    <div class="ed-summary" id="edSummary"></div>

    <div class="ed-block">
      <div class="ed-times">
        <label class="ed-time"><span>出勤</span>
          <input type="time" id="edIn">
          <button class="mini" data-now="in" type="button">いま</button>
        </label>
        <label class="ed-time"><span>退勤</span>
          <input type="time" id="edOut">
          <button class="mini" data-now="out" type="button">いま</button>
        </label>
      </div>
    </div>

    <div class="ed-block">
      <h3>休憩 <small>（${BREAK_STEP}分単位）</small></h3>
      <div class="stepper">
        <button class="step" id="brMinus" aria-label="休憩を${BREAK_STEP}分減らす">−${BREAK_STEP}</button>
        <output id="brVal"></output>
        <button class="step" id="brPlus" aria-label="休憩を${BREAK_STEP}分増やす">＋${BREAK_STEP}</button>
      </div>
      <div class="chips" id="brChips">${BREAK_CHIPS.map(([v, l]) => `<button class="chip" data-br="${v}">${l}</button>`).join('')}</div>
    </div>

    <div class="ed-block" id="leaveBlock">
      <h3>有給</h3>
      <div class="seg" id="leaveSeg">
        <button data-lv="none">なし</button>
        <button data-lv="hours">時間休</button>
        <button data-lv="half">半休</button>
        <button data-lv="full">全休</button>
      </div>
      <div class="stepper small" id="lvHours">
        <button class="step" id="lvMinus" aria-label="時間休を1時間減らす">−1h</button>
        <output id="lvVal"></output>
        <button class="step" id="lvPlus" aria-label="時間休を1時間増やす">＋1h</button>
      </div>
      <p class="ed-hint" id="lvHint"></p>
    </div>

    <label class="ed-switch" id="offBlock">
      <input type="checkbox" id="edOff">
      <span class="track"><span class="knob"></span></span>
      <span class="ed-switch-text">この日は休み扱い<small>会社の休業日など。所定の出勤日から外れます</small></span>
    </label>

    <div class="ed-actions">
      <button class="btn btn-danger" id="edClear">この日の記録を消す</button>
      <button class="btn btn-primary" id="edDone">とじる</button>
    </div>`;

  const $ = (s) => body.querySelector(s);
  const upd = (patch) => {
    setDay(date, patch);
    sync();
  };

  function sync() {
    const st = getState();
    const rec = st.days[date] ?? {};
    const d = computeDay(date, rec, st.settings);
    $('#edIn').value = rec.in ? rec.in.padStart(5, '0') : '';
    $('#edOut').value = rec.out ? rec.out.padStart(5, '0') : '';
    $('#edHoliday').textContent = d.holiday && d.kind !== 'off' ? `🎌 ${d.holiday}` : d.kind === 'weekend' ? 'おやすみの日' : '';
    $('#edHoliday').hidden = !$('#edHoliday').textContent;

    // 概要
    let sum = '<span class="dim">出勤・退勤を入れると計算します</span>';
    if (d.status === 'working') sum = '<span class="dim">勤務中（退勤を入れると集計に入ります）</span>';
    else if (d.status === 'invalid') sum = '<span class="neg">時刻を確認してください（退勤が出勤より後になるように）</span>';
    else if (d.counted) {
      sum = `勤務 <b>${fmtDur(d.workMin)}</b>${d.leaveMin ? ` ＋ 有給 <b>${fmtDur(d.leaveMin)}</b>` : ''}`;
      sum += ` 　<span class="${d.diffMin >= 0 ? 'pos' : 'neg'}">${d.scheduled ? `${fmtDur(st.settings.dailyMinutes)}との差 ` : '休日出勤 '}${fmtDurSigned(d.diffMin)}</span>`;
    }
    $('#edSummary').innerHTML = sum;

    // 休憩
    const br = d.breakMin;
    $('#brVal').textContent = `${br}分`;
    $('#brMinus').disabled = br <= 0;
    body.querySelectorAll('#brChips .chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.br) === br));

    // 有給
    const scheduled = d.scheduled;
    $('#leaveBlock').hidden = !scheduled && d.kind !== 'off';
    const disabled = !scheduled;
    body.querySelectorAll('#leaveSeg button').forEach((b) => (b.disabled = disabled));
    const lv = rec.leave;
    const kind = lv ? lv.kind : 'none';
    body.querySelectorAll('#leaveSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lv === kind));
    $('#lvHours').hidden = kind !== 'hours';
    if (kind === 'hours') {
      $('#lvVal').textContent = `${lv.hours}時間`;
      $('#lvMinus').disabled = lv.hours <= 1;
      $('#lvPlus').disabled = lv.hours >= maxHours;
    }
    $('#lvHint').textContent = disabled
      ? '休みの日には有給を入れられません'
      : d.leaveMin
        ? `有給として ${fmtDur(d.leaveMin)} が加算されます`
        : '';

    // 休み扱い
    $('#offBlock').hidden = d.kind !== 'work' && d.kind !== 'off';
    $('#edOff').checked = !!rec.off;
  }

  $('#edIn').addEventListener('change', (e) => upd({ in: e.target.value || null }));
  $('#edOut').addEventListener('change', (e) => upd({ out: e.target.value || null }));
  body.querySelectorAll('[data-now]').forEach((b) => b.addEventListener('click', () => upd({ [b.dataset.now]: nowHM() })));

  const brNow = () => computeDay(date, getState().days[date], getState().settings).breakMin;
  holdRepeat($('#brMinus'), () => upd({ break: Math.max(0, brNow() - BREAK_STEP) }));
  holdRepeat($('#brPlus'), () => upd({ break: Math.min(240, brNow() + BREAK_STEP) }));
  body.querySelectorAll('#brChips .chip').forEach((c) => c.addEventListener('click', () => upd({ break: Number(c.dataset.br) })));

  body.querySelectorAll('#leaveSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.lv;
      upd({ leave: k === 'none' ? null : k === 'hours' ? { kind: 'hours', hours: Math.min(3, maxHours) } : { kind: k } });
    }),
  );
  const hours = () => getState().days[date]?.leave?.hours ?? 1;
  holdRepeat($('#lvMinus'), () => upd({ leave: { kind: 'hours', hours: Math.max(1, hours() - 1) } }));
  holdRepeat($('#lvPlus'), () => upd({ leave: { kind: 'hours', hours: Math.min(maxHours, hours() + 1) } }));

  $('#edOff').addEventListener('change', (e) => upd({ off: e.target.checked }));
  $('#edClear').addEventListener('click', () => {
    setDay(date, { in: null, out: null, break: null, leave: null, off: null });
    toast('この日の記録を消しました');
    sync();
  });
  $('#edDone').addEventListener('click', () => body.closest('.sheet').querySelector('.sheet-x').click());
  sync();
}

// ---------- 読み取り結果の確認 ----------

export function openImportConfirm(result, onApplied) {
  const st = getState();
  const rows = result.rows.map((r) => ({ ...r, use: true }));
  const { body, close } = openSheet('読み取り結果の確認', { tall: true });

  const tagOf = (r) => {
    const cur = st.days[r.date];
    if (!cur || (!cur.in && !cur.out)) return ['new', '新規'];
    if ((cur.in ?? null) === (r.in ?? null) && (cur.out ?? null) === (r.out ?? null)) return ['same', '同じ'];
    return ['chg', '更新'];
  };

  body.innerHTML = `
    <p class="imp-lead">${rows.length}日分を読み取りました。時刻が合っているか確かめてから反映してください。</p>
    ${result.notes.map((n) => `<p class="imp-note">⚠ ${esc(n)}</p>`).join('')}
    <div class="imp-list" id="impList"></div>
    ${
      result.ignored.length
        ? `<details class="imp-ign"><summary>読み取れなかった行 ${result.ignored.length}件</summary>${result.ignored
            .map((i) => `<p>「${esc(i.raw)}」— ${esc(i.reason)}</p>`)
            .join('')}<p class="dim">足りない日は、あとで日付をタップして入力できます。</p></details>`
        : ''
    }
    <div class="imp-actions">
      <button class="btn btn-primary" id="impApply"></button>
      <button class="btn btn-ghost" id="impCancel">やめる</button>
    </div>`;

  const list = body.querySelector('#impList');
  list.innerHTML = rows
    .map((r, i) => {
      const [tk, tl] = tagOf(r);
      const warn = r.warnings.length;
      return `
      <div class="imp-row${warn ? ' has-warn' : ''}" data-i="${i}">
        <label class="imp-check"><input type="checkbox" checked>
          <span class="imp-date">${md(r.date)}<small>${dowOf(r.date)}</small></span></label>
        <div class="imp-times">
          <input type="time" class="t-in" value="${esc(r.in ? r.in.padStart(5, '0') : '')}" aria-label="出勤">
          <span>–</span>
          <input type="time" class="t-out" value="${esc(r.out ? r.out.padStart(5, '0') : '')}" aria-label="退勤">
        </div>
        <span class="tag tag-${tk}">${tl}</span>
        ${warn ? `<ul class="imp-warn">${r.warnings.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul>` : ''}
      </div>`;
    })
    .join('');

  const applyBtn = body.querySelector('#impApply');
  const refresh = () => {
    const n = rows.filter((r) => r.use).length;
    applyBtn.textContent = n ? `${n}日分を反映する` : '反映する日がありません';
    applyBtn.disabled = !n;
  };
  list.addEventListener('change', (e) => {
    const row = e.target.closest('.imp-row');
    if (!row) return;
    const r = rows[Number(row.dataset.i)];
    if (e.target.matches('.imp-check input')) r.use = e.target.checked;
    if (e.target.matches('.t-in')) r.in = e.target.value || null;
    if (e.target.matches('.t-out')) r.out = e.target.value || null;
    row.classList.toggle('off', !r.use);
    refresh();
  });
  applyBtn.addEventListener('click', () => {
    const use = rows.filter((r) => r.use).map(({ date, in: i, out: o }) => ({ date, in: i, out: o }));
    applyRows(use);
    close();
    onApplied?.(use);
  });
  body.querySelector('#impCancel').addEventListener('click', close);
  refresh();
}

// ---------- テキスト貼り付け ----------

export function openPaste({ year, month }, onParsed) {
  const { body, close } = openSheet('テキストを貼り付け');
  body.innerHTML = `
    <p class="imp-lead">勤怠アプリの画面をiPhoneで長押しして「テキストをコピー」し、ここに貼り付けてください。<br>
    例：<code>9/1(火) 出勤 09:24 退勤 17:02</code></p>
    <textarea id="pasteText" rows="9" placeholder="ここに貼り付け" spellcheck="false"></textarea>
    <div class="imp-actions">
      <button class="btn btn-primary" id="pasteGo">読み取る</button>
      <button class="btn btn-ghost" id="pasteCancel">やめる</button>
    </div>`;
  body.querySelector('#pasteCancel').addEventListener('click', close);
  body.querySelector('#pasteGo').addEventListener('click', () => {
    const r = parseAttendance(body.querySelector('#pasteText').value, { fallback: { year, month } });
    if (!r.rows.length) {
      toast('日付と時刻の行が見つかりませんでした');
      return;
    }
    close();
    setTimeout(() => onParsed({ rows: r.rows, ignored: r.ignored, notes: [], header: { year: r.year, month: r.month } }), 280);
  });
}

// ---------- 設定 ----------

export function openSettings(onChanged) {
  const { body, close } = openSheet('設定・バックアップ');
  body.innerHTML = `
    <div class="ed-block">
      <h3>1日の所定時間</h3>
      <div class="stepper">
        <button class="step" id="sdMinus">−30分</button><output id="sdVal"></output><button class="step" id="sdPlus">＋30分</button>
      </div>
      <p class="ed-hint">月の目標 ＝ 所定出勤日（土日祝をのぞく）× この時間</p>
    </div>
    <div class="ed-block">
      <h3>休憩の初期値 <small>（${BREAK_STEP}分単位）</small></h3>
      <div class="stepper">
        <button class="step" id="sbMinus">−${BREAK_STEP}</button><output id="sbVal"></output><button class="step" id="sbPlus">＋${BREAK_STEP}</button>
      </div>
      <p class="ed-hint">日ごとに変えていない日は、この休憩で計算されます</p>
    </div>
    <div class="ed-block">
      <h3>バックアップ</h3>
      <p class="ed-hint">データはこの端末のブラウザの中だけに保存されます。機種変更の前に書き出しておくと安心です。</p>
      <div class="imp-actions row">
        <button class="btn btn-ghost" id="bkOut">書き出す</button>
        <button class="btn btn-ghost" id="bkIn">読み込む</button>
        <input type="file" id="bkFile" accept="application/json,.json" hidden>
      </div>
      ${isStorageOk() ? '' : '<p class="imp-note">⚠ この環境では保存が使えません（プライベートブラウズなど）。閉じるとデータが消えます。</p>'}
    </div>
    <div class="ed-block">
      <button class="btn btn-danger" id="bkClear">すべてのデータを消す</button>
    </div>
    <p class="ed-hint center">ぺんぎん勤怠 ・ スクショの読み取りはすべて端末の中で行われ、画像は送信されません</p>`;
  const $ = (s) => body.querySelector(s);
  const sync = () => {
    const s = getState().settings;
    $('#sdVal').textContent = fmtDur(s.dailyMinutes);
    $('#sbVal').textContent = `${s.defaultBreak}分`;
    $('#sdMinus').disabled = s.dailyMinutes <= 60;
    $('#sbMinus').disabled = s.defaultBreak <= 0;
  };
  const change = (patch) => {
    setSettings(patch);
    sync();
    onChanged?.();
  };
  const s = () => getState().settings;
  holdRepeat($('#sdMinus'), () => change({ dailyMinutes: Math.max(60, s().dailyMinutes - 30) }));
  holdRepeat($('#sdPlus'), () => change({ dailyMinutes: Math.min(720, s().dailyMinutes + 30) }));
  holdRepeat($('#sbMinus'), () => change({ defaultBreak: Math.max(0, s().defaultBreak - BREAK_STEP) }));
  holdRepeat($('#sbPlus'), () => change({ defaultBreak: Math.min(240, s().defaultBreak + BREAK_STEP) }));

  $('#bkOut').addEventListener('click', () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `penguin-kintai-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('バックアップを書き出しました');
  });
  $('#bkIn').addEventListener('click', () => $('#bkFile').click());
  $('#bkFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = importJSON(await f.text());
      toast(`${n}日分のデータを読み込みました`);
      onChanged?.();
      sync();
    } catch (err) {
      toast(`読み込めませんでした（${err.message}）`);
    }
  });
  $('#bkClear').addEventListener('click', () => {
    if (confirm('記録をすべて消します。バックアップがないと元に戻せません。よろしいですか？')) {
      clearAll();
      onChanged?.();
      toast('すべて消しました');
      close();
    }
  });
  sync();
}

// ---------- 読み取り中 ----------

export function showProgress() {
  const el = document.createElement('div');
  el.className = 'progress-overlay';
  el.innerHTML = `
    <div class="progress-card">
      <img src="${SPRITE.loupe}" alt="" width="160" height="160">
      <p class="progress-msg">じゅんび中…</p>
      <div class="progress-bar"><i></i></div>
      <p class="progress-sub"></p>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const msg = el.querySelector('.progress-msg');
  const bar = el.querySelector('.progress-bar i');
  const sub = el.querySelector('.progress-sub');
  return {
    update({ phase, index, total, ratio }) {
      if (phase === 'load') {
        msg.textContent = 'ことばを覚え中…';
        sub.textContent = '初回だけ数十秒かかります（次からはすぐです）';
      } else {
        msg.textContent = total > 1 ? `${index + 1}枚目を読み取り中…` : '読み取り中…じーっ';
        sub.textContent = '';
      }
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio || 0)) * 100)}%`;
    },
    close() {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    },
  };
}
