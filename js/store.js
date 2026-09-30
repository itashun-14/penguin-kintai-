// 保存(localStorage)。データはこの端末のブラウザの中だけに残り、外部へは送られない。
import { DEFAULT_SETTINGS } from './calc.js';

const KEY = 'penguin-kintai/v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

let storageOk = true;
let state = load();
const listeners = new Set();

function sanitizeDay(r) {
  const out = {};
  if (r && typeof r === 'object') {
    if (typeof r.in === 'string' && TIME_RE.test(r.in)) out.in = r.in;
    if (typeof r.out === 'string' && TIME_RE.test(r.out)) out.out = r.out;
    if (Number.isInteger(r.break) && r.break >= 0 && r.break <= 600) out.break = r.break;
    if (r.off === true) out.off = true;
    const l = r.leave;
    if (l && (l.kind === 'full' || l.kind === 'half')) out.leave = { kind: l.kind };
    else if (l && l.kind === 'hours' && Number.isInteger(l.hours) && l.hours >= 1 && l.hours <= 12) {
      out.leave = { kind: 'hours', hours: l.hours };
    }
  }
  return out;
}

function normalize(raw) {
  const days = {};
  for (const [date, rec] of Object.entries(raw?.days ?? {})) {
    if (!DATE_RE.test(date)) continue;
    const clean = sanitizeDay(rec);
    if (Object.keys(clean).length) days[date] = clean;
  }
  const s = raw?.settings ?? {};
  const settings = { ...DEFAULT_SETTINGS };
  if (Number.isInteger(s.dailyMinutes) && s.dailyMinutes >= 60 && s.dailyMinutes <= 720) settings.dailyMinutes = s.dailyMinutes;
  if (Number.isInteger(s.defaultBreak) && s.defaultBreak >= 0 && s.defaultBreak <= 240) settings.defaultBreak = s.defaultBreak;
  return { version: 1, settings, days };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    storageOk = false;
  }
  return normalize({});
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    storageOk = false;
  }
  listeners.forEach((fn) => fn(state));
}

export const isStorageOk = () => storageOk;
export const getState = () => state;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 1日分を更新。patch の値が null/undefined のキーは削除。休憩が既定と同じなら保存しない。 */
export function setDay(date, patch) {
  const cur = { ...(state.days[date] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '' || v === false) delete cur[k];
    else cur[k] = v;
  }
  if (cur.break === state.settings.defaultBreak) delete cur.break;
  const clean = sanitizeDay(cur);
  const days = { ...state.days };
  if (Object.keys(clean).length) days[date] = clean;
  else delete days[date];
  state = { ...state, days };
  persist();
}

/** スクショから読み取った行をまとめて反映。既存の休憩・有給などは残し、出退勤だけ上書き */
export function applyRows(rows) {
  const days = { ...state.days };
  for (const r of rows) {
    const cur = { ...(days[r.date] ?? {}) };
    if (r.in) cur.in = r.in;
    else delete cur.in;
    if (r.out) cur.out = r.out;
    else delete cur.out;
    const clean = sanitizeDay(cur);
    if (Object.keys(clean).length) days[r.date] = clean;
    else delete days[r.date];
  }
  state = { ...state, days };
  persist();
}

export function setSettings(patch) {
  const next = normalize({ settings: { ...state.settings, ...patch }, days: state.days });
  state = next;
  persist();
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

/** バックアップの読み込み。壊れていれば例外 */
export function importJSON(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || typeof raw.days !== 'object') throw new Error('バックアップの形式ではありません');
  state = normalize(raw);
  persist();
  return Object.keys(state.days).length;
}

export function clearAll() {
  state = normalize({});
  persist();
}
