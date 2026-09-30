// 日本の祝日(2020年以降)を祝日法に沿って計算する。
// 固定日 / ハッピーマンデー / 春分・秋分 / 国民の休日 / 振替休日。

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

const dayOfWeek = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

// m月の第n月曜日の日付
function nthMonday(y, m, n) {
  const first = dayOfWeek(y, m, 1);
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

// 1980〜2099年で有効な近似式
const vernalEquinox = (y) =>
  Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const autumnalEquinox = (y) =>
  Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

function baseHolidays(y) {
  const h = new Map();
  const add = (m, d, name) => h.set(ymd(y, m, d), name);

  add(1, 1, '元日');
  add(1, nthMonday(y, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  add(2, 23, '天皇誕生日');
  add(3, vernalEquinox(y), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(9, nthMonday(y, 9, 3), '敬老の日');
  add(9, autumnalEquinox(y), '秋分の日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  // 東京オリンピックに伴う移動(2020・2021年)
  if (y === 2020) {
    add(7, 23, '海の日');
    add(7, 24, 'スポーツの日');
    add(8, 10, '山の日');
  } else if (y === 2021) {
    add(7, 22, '海の日');
    add(7, 23, 'スポーツの日');
    add(8, 8, '山の日');
  } else {
    add(7, nthMonday(y, 7, 3), '海の日');
    add(8, 11, '山の日');
    add(10, nthMonday(y, 10, 2), 'スポーツの日');
  }
  return h;
}

const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};
const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dayOfWeek(y, m, d);
};

const cache = new Map();

/** その年の祝日 Map<'YYYY-MM-DD', 名前> */
export function holidaysOf(year) {
  if (cache.has(year)) return cache.get(year);
  const h = baseHolidays(year);

  // 国民の休日: 前日と翌日が祝日に挟まれた平日(日曜を除く)
  const sandwiched = [];
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 31; d++) {
      const s = ymd(year, m, d);
      if (new Date(Date.UTC(year, m - 1, d)).getUTCMonth() !== m - 1) continue;
      if (h.has(s) || weekdayOf(s) === 0) continue;
      if (h.has(addDays(s, -1)) && h.has(addDays(s, 1))) sandwiched.push(s);
    }
  }
  sandwiched.forEach((s) => h.set(s, '国民の休日'));

  // 振替休日: 日曜の祝日は、次の祝日でない日が休みになる
  const sundays = [...h.keys()].filter((s) => weekdayOf(s) === 0).sort();
  for (const s of sundays) {
    let t = addDays(s, 1);
    while (h.has(t)) t = addDays(t, 1);
    h.set(t, '振替休日');
  }

  cache.set(year, h);
  return h;
}

/** 祝日名。祝日でなければ null */
export function holidayName(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  return holidaysOf(year).get(dateStr) ?? null;
}
