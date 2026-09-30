// 勤怠の集計ロジック。すべて「分」の整数で計算する純粋関数。
import { holidayName, ymd } from './holidays.js';

export const DEFAULT_SETTINGS = Object.freeze({
  dailyMinutes: 420, // 1日の所定時間(7時間)
  defaultBreak: 60, // 既定の休憩(分)
});

export const BREAK_STEP = 5; // 休憩の調整単位(分)
export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

const pad2 = (n) => String(n).padStart(2, '0');

// ---------- 時刻の変換・表示 ----------

/** "09:24" → 564。不正なら null(24時超えの "25:30" 表記は許可) */
export function toMin(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 29 || mi > 59) return null;
  return h * 60 + mi;
}

/** 分 → 「6時間38分」。ちょうどの時間は「7時間」、1時間未満は「38分」。負は「−」付き */
export function fmtDur(min) {
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  const body = (h ? `${h}時間` : '') + (m || !h ? `${m}分` : '');
  return (min < 0 && a > 0 ? '−' : '') + body;
}

/** 符号つき: +1時間48分 / −22分 / ±0分 */
export function fmtDurSigned(min) {
  if (Math.round(min) === 0) return '±0分';
  return `${min > 0 ? '+' : '−'}${fmtDur(Math.abs(min))}`;
}

/** 画面表示用のHTML。数字は大きく、「時間」「分」は小さく添える(値は数値だけなので安全) */
export function durHTML(min, { signed = false } = {}) {
  const r = Math.round(min);
  const a = Math.abs(r);
  const h = Math.floor(a / 60);
  const m = a % 60;
  const sign = r === 0 ? (signed ? '±' : '') : r < 0 ? '−' : signed ? '+' : '';
  const u = (t) => `<small class="u">${t}</small>`;
  return sign + (h ? `${h}${u('時間')}` : '') + (m || !h ? `${m}${u('分')}` : '');
}

// ---------- 日付ユーティリティ ----------

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** ローカル時刻での今日 'YYYY-MM-DD' */
export function todayString(now = new Date()) {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// ---------- 有給 ----------

/**
 * 有給の分数。leave は {kind:'full'} | {kind:'half'} | {kind:'hours', hours:n}
 * 時間休は1時間単位。所定時間を超えないよう丸める。
 */
export function leaveMinutes(leave, settings = DEFAULT_SETTINGS) {
  if (!leave) return 0;
  const daily = settings.dailyMinutes;
  if (leave.kind === 'full') return daily;
  if (leave.kind === 'half') return Math.round(daily / 2);
  if (leave.kind === 'hours') {
    const h = Math.max(0, Math.floor(Number(leave.hours) || 0));
    return Math.min(h * 60, daily);
  }
  return 0;
}

// ---------- 1日の計算 ----------

/**
 * @param {string} date 'YYYY-MM-DD'
 * @param {object|undefined} rec {in, out, break, leave, off}
 * @returns 表示と集計に使う1日分の結果
 *   kind: 'work'(所定出勤日) | 'weekend' | 'holiday' | 'off'(休日扱いに設定)
 *   status: 'empty' | 'working'(退勤なし) | 'done' | 'leave'(有給のみ) | 'invalid'
 */
export function computeDay(date, rec, settings = DEFAULT_SETTINGS) {
  const r = rec ?? {};
  const wd = weekdayOf(date);
  const holiday = holidayName(date);

  let kind = 'work';
  if (r.off) kind = 'off';
  else if (wd === 0 || wd === 6) kind = 'weekend';
  else if (holiday) kind = 'holiday';
  const scheduled = kind === 'work';

  const breakMin = r.break ?? settings.defaultBreak;
  const inMin = r.in ? toMin(r.in) : null;
  const outMin = r.out ? toMin(r.out) : null;
  const leaveMin = scheduled ? leaveMinutes(r.leave, settings) : 0;

  let status = 'empty';
  let workMin = 0;
  let spanMin = null;

  if (r.in || r.out) {
    if (r.in && r.out) {
      if (inMin === null || outMin === null || outMin <= inMin) {
        status = 'invalid';
      } else {
        status = 'done';
        spanMin = outMin - inMin;
        workMin = Math.max(0, spanMin - breakMin);
      }
    } else if (r.in && inMin !== null) {
      status = 'working';
    } else {
      status = 'invalid';
    }
  } else if (leaveMin > 0) {
    status = 'leave';
  }

  const counted = status === 'done' || status === 'leave';
  const creditedMin = counted ? workMin + leaveMin : 0;
  // 所定出勤日: 7:00との差 / 休日出勤: 全時間がプラス
  const diffMin = counted ? (scheduled ? creditedMin - settings.dailyMinutes : creditedMin) : null;

  return {
    date,
    weekday: wd,
    kind,
    scheduled,
    holiday,
    status,
    counted,
    inMin,
    outMin,
    spanMin,
    breakMin,
    workMin,
    leaveMin,
    creditedMin,
    diffMin,
  };
}

// ---------- 月の集計 ----------

/**
 * @param {{settings?:object, days?:object}} state
 * @param {number} year
 * @param {number} month 1-12
 * @param {string} today 'YYYY-MM-DD'
 */
export function computeMonth(state, year, month, today = todayString()) {
  const settings = { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) };
  const recs = state.days ?? {};
  const n = daysInMonth(year, month);

  const days = [];
  for (let d = 1; d <= n; d++) {
    const date = ymd(year, month, d);
    days.push(computeDay(date, recs[date], settings));
  }

  const scheduledDays = days.filter((x) => x.scheduled).length;
  const targetMin = scheduledDays * settings.dailyMinutes;
  const actualMin = days.reduce((s, x) => s + x.creditedMin, 0);
  const recordedScheduled = days.filter((x) => x.scheduled && x.counted).length;
  const balanceMin = actualMin - recordedScheduled * settings.dailyMinutes;
  const remainingMin = targetMin - actualMin;

  // 今日以降でまだ記録のない所定出勤日(今日の勤務中も含む)
  const futureDays = days.filter((x) => x.scheduled && !x.counted && x.date >= today).length;
  // 今日より前なのに記録がない所定出勤日(読み込み忘れのヒント)
  const missingPast = days.filter(
    (x) => x.scheduled && !x.counted && x.date < today && x.status !== 'working',
  ).length;
  const paceMin = futureDays > 0 ? Math.ceil(Math.max(remainingMin, 0) / futureDays) : null;

  return {
    year,
    month,
    settings,
    days,
    scheduledDays,
    recordedScheduled,
    targetMin,
    actualMin,
    remainingMin,
    balanceMin,
    futureDays,
    missingPast,
    paceMin,
    achieved: remainingMin <= 0 && recordedScheduled > 0,
  };
}

/** 今日出勤済みで退勤前のとき、所定時間ちょうどで帰れる退勤時刻(分)。なければ null */
export function suggestedLeaveTime(day, settings = DEFAULT_SETTINGS) {
  if (!day || day.status !== 'working' || day.inMin === null) return null;
  return day.inMin + settings.dailyMinutes - day.leaveMin + day.breakMin;
}

/** 分 → "17:30" */
export function fmtClock(min) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}
