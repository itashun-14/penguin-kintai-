// ペンギンの表情・ひとこと。
import { fmtDur } from './calc.js';

export const SPRITE = {
  normal: 'assets/penguin/normal.png',
  happy: 'assets/penguin/happy.png',
  worried: 'assets/penguin/worried.png',
  sleep: 'assets/penguin/sleep.png',
  loupe: 'assets/penguin/loupe.png',
  flag: 'assets/penguin/flag.png',
  vacation: 'assets/penguin/vacation.png',
  walk: 'assets/penguin/walk.png',
};

const LINES = {
  empty: ['まずはスクショを読み込んでね', '勤怠アプリのスクショを選んでみて！', '写真を選ぶだけで表ができるよ'],
  normal: ['今日もこつこつ、いこう〜', 'ペースはいい感じだよ', 'あわてなくて大丈夫！'],
  happy: ['貯金できてる！えらい！', 'この調子〜！', '余裕があるよ、いい感じ！'],
  worried: ['ちょっと足りないかも…', '1日ずつ取り戻そう！', '無理せず、少しずつね'],
  worriedPace: ['これから1日 {pace} でいけるよ', '1日 {pace} ずつでOK！'],
  sleep: ['おやすみの日だね zzz', 'ゆっくり休んでね', 'のんびりしよう〜'],
  vacation: ['有給いいね〜！のんびりして', '今日はおやすみ！たのしんで'],
  flag: ['目標達成！おつかれさま！！', 'やったね！今月はクリア！'],
  working: ['お仕事がんばってね！', '{leave} に帰れば7時間だよ'],
  past: ['この月のふりかえりだよ', 'おつかれさま！'],
  loupe: ['読み取り中…じーっ'],
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];

/**
 * @param {object} m computeMonth の結果
 * @param {{isCurrent:boolean, today:object|null, leaveAt:string|null}} ctx
 */
export function moodFor(m, ctx) {
  let mood = 'normal';
  let key = 'normal';
  if (m.recordedScheduled === 0 && !ctx.today?.counted) {
    mood = 'loupe';
    key = 'empty';
  } else if (m.achieved) {
    mood = 'flag';
    key = 'flag';
  } else if (ctx.isCurrent && ctx.today && !ctx.today.scheduled && ctx.today.status === 'empty') {
    mood = 'sleep';
    key = 'sleep';
  } else if (ctx.isCurrent && ctx.today?.leaveMin > 0 && ctx.today.status === 'leave') {
    mood = 'vacation';
    key = 'vacation';
  } else if (m.balanceMin >= 30) {
    mood = 'happy';
    key = 'happy';
  } else if (m.balanceMin <= -60) {
    mood = 'worried';
    key = m.paceMin && Math.random() < 0.5 ? 'worriedPace' : 'worried';
  } else if (!ctx.isCurrent) {
    key = 'past';
  }
  return { mood, sprite: SPRITE[mood], say: () => say(key, m, ctx) };
}

export function say(key, m, ctx = {}) {
  let line = pick(LINES[key] ?? LINES.normal);
  if (ctx.today?.status === 'working' && ctx.leaveAt && Math.random() < 0.6) line = pick(LINES.working);
  return line.replace('{pace}', m.paceMin != null ? fmtDur(m.paceMin) : '').replace('{leave}', ctx.leaveAt ?? '');
}
