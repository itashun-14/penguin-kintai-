// 文字認識の結果(またはコピペしたテキスト)から、日ごとの出勤・退勤を取り出す。
// 入力例: "9/1(火) 出勤 09:24 退勤 17:02"
import { toMin, daysInMonth, weekdayOf, WEEKDAY_JA } from './calc.js';
import { ymd } from './holidays.js';

const LOW_CONFIDENCE = 75;

// 全角→半角 / OCRが混同しやすい記号の整理
function normalize(text) {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：﹕]/g, ':')
    .replace(/[／⁄]/g, '/')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

const DIGIT_FIX = { O: '0', o: '0', D: '0', I: '1', l: '1', '|': '1', S: '5' };
const fixDigits = (s) => s.replace(/[OoDIl|S]/g, (c) => DIGIT_FIX[c]);

const HEADER_RE = /(\d{4})\s*[/.\-年]\s*(\d{1,2})/;
const DATE_RE = /(?<![\d:/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d:/])/;
const DOW_RE = /\(\s*([日月火水木金土])\s*\)/;
const TIME_RE = /(?<![\d:])([0-9OoDIl|S]{1,2})\s*[:;.]\s*([0-9OoDIl|S]{2})(?![\d:])/g;

/**
 * @param {string | Array<{text:string, confidence?:number, edge?:boolean}>} input
 * @param {{fallback?: {year:number, month:number}}} [opts]
 * @returns {{year:number|null, month:number|null, headerFound:boolean, rows:Array, ignored:Array}}
 *   rows: {date, in, out, confidence, warnings:[{code,message}]}
 */
export function parseAttendance(input, opts = {}) {
  const lines = (typeof input === 'string' ? input.split(/\r?\n/).map((text) => ({ text })) : input)
    .map((l) => ({ ...l, text: normalize(l.text ?? '') }))
    .filter((l) => l.text.trim());

  // 1. ヘッダー(2026/09/01 - 2026/09/31)から年月を得る
  let year = opts.fallback?.year ?? null;
  let month = opts.fallback?.month ?? null;
  let headerFound = false;
  const bodyLines = [];
  for (const l of lines) {
    const h = HEADER_RE.exec(l.text);
    if (h) {
      if (!headerFound && Number(h[2]) >= 1 && Number(h[2]) <= 12) {
        year = Number(h[1]);
        month = Number(h[2]);
        headerFound = true;
      }
      continue; // 年つきの日付行はヘッダー扱い
    }
    bodyLines.push(l);
  }

  // 2. 日付を含む行ごとにレコードを作り、続く行(時刻が別の行に出た場合)を連結
  const records = [];
  for (const l of bodyLines) {
    const d = DATE_RE.exec(l.text);
    if (d) {
      records.push({ m: Number(d[1]), d: Number(d[2]), parts: [l.text.slice(d.index + d[0].length)], lines: [l] });
    } else if (records.length) {
      const last = records[records.length - 1];
      last.parts.push(l.text);
      last.lines.push(l);
    }
  }

  const rows = [];
  const ignored = [];
  for (const rec of records) {
    const raw = `${rec.m}/${rec.d}`;
    if (month === null || year === null) {
      ignored.push({ raw, reason: '年月がわかりません' });
      continue;
    }
    if (rec.m !== month || rec.d < 1 || rec.d > daysInMonth(year, month)) {
      ignored.push({ raw, reason: `${month}月の日付として読めません` });
      continue;
    }
    const date = ymd(year, month, rec.d);
    const text = rec.parts.join(' ');
    const warnings = [];

    // 時刻を抽出し、「出勤/退勤」の文字があればそれで、なければ並び順で振り分ける
    const found = [];
    let prevEnd = 0;
    for (const t of text.matchAll(TIME_RE)) {
      const hh = Number(fixDigits(t[1]));
      const mm = Number(fixDigits(t[2]));
      const between = text.slice(prevEnd, t.index);
      prevEnd = t.index + t[0].length;
      if (Number.isNaN(hh) || Number.isNaN(mm) || hh > 29 || mm > 59) {
        warnings.push({ code: 'time', message: `時刻「${t[0]}」が読み取れません` });
        continue;
      }
      const label = /退/.test(between) ? 'out' : /出/.test(between) ? 'in' : null;
      found.push({ label, value: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` });
    }
    if (found.length > 2) warnings.push({ code: 'extra', message: '時刻が3つ以上見つかりました' });

    let tin = null;
    let tout = null;
    const unlabeled = [];
    for (const f of found.slice(0, 2)) {
      if (f.label === 'in' && tin === null) tin = f.value;
      else if (f.label === 'out' && tout === null) tout = f.value;
      else unlabeled.push(f.value);
    }
    for (const v of unlabeled) {
      if (tin === null) tin = v;
      else if (tout === null) tout = v;
    }

    if (tin === null && tout === null) continue; // 記録のない日(休みなど)

    if (tin !== null && tout !== null && toMin(tout) <= toMin(tin)) {
      warnings.push({ code: 'order', message: '退勤が出勤より前になっています' });
    }
    if (tin === null) warnings.push({ code: 'no-in', message: '出勤時刻がありません' });

    // 曜日の照合: 読み取った(火)などが実際の曜日と違えば日付の誤読を疑う
    const dow = DOW_RE.exec(text) ?? DOW_RE.exec(rec.lines[0].text);
    if (dow && dow[1] !== WEEKDAY_JA[weekdayOf(date)]) {
      warnings.push({ code: 'dow', message: `曜日が合いません(画像:${dow[1]} / 暦:${WEEKDAY_JA[weekdayOf(date)]})` });
    }

    const confs = rec.lines.map((l) => l.confidence).filter((c) => typeof c === 'number');
    const confidence = confs.length ? Math.min(...confs) : null;
    if (confidence !== null && confidence < LOW_CONFIDENCE) {
      warnings.push({ code: 'confidence', message: `読み取りの自信が低めです(${Math.round(confidence)}%)` });
    }
    if (rec.lines.some((l) => l.edge)) {
      warnings.push({ code: 'edge', message: '画面の端で見切れている可能性があります' });
    }

    rows.push({ date, in: tin, out: tout, confidence, warnings });
  }

  return { year, month, headerFound, rows, ignored };
}

/**
 * 複数枚のスクショから得た行を日付ごとに統合する。
 * 同じ日が重なったら、警告が少なく・時刻が揃っている方を採用。
 */
export function mergeRows(...rowLists) {
  const score = (r) => (r.in ? 1 : 0) + (r.out ? 1 : 0) - r.warnings.length * 0.5;
  const byDate = new Map();
  for (const r of rowLists.flat()) {
    const cur = byDate.get(r.date);
    if (!cur || score(r) >= score(cur)) byDate.set(r.date, r);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
