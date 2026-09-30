import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toMin,
  fmtDur,
  fmtDurSigned,
  durHTML,
  fmtClock,
  leaveMinutes,
  computeDay,
  computeMonth,
  suggestedLeaveTime,
  DEFAULT_SETTINGS,
} from '../js/calc.js';

// 提供スクショの 9/1〜9/10
const SCREENSHOT_DAYS = {
  '2026-09-01': { in: '09:24', out: '17:02' },
  '2026-09-02': { in: '08:56', out: '15:00' },
  '2026-09-03': { in: '09:27', out: '18:31' },
  '2026-09-04': { in: '09:59', out: '15:17' },
  '2026-09-07': { in: '08:51', out: '18:00' },
  '2026-09-08': { in: '10:50', out: '17:03' },
  '2026-09-09': { in: '08:56', out: '16:02' },
  '2026-09-10': { in: '09:01', out: '17:19' },
};

test('時刻の変換(24時超えの表記も可)', () => {
  assert.equal(toMin('09:24'), 564);
  assert.equal(toMin('25:30'), 1530);
  assert.equal(toMin('9:5'), null);
  assert.equal(toMin('24:60'), null);
  assert.equal(fmtClock(1050), '17:30');
});

test('時間の表示は「◯時間◯分」(ちょうどは時間だけ、1時間未満は分だけ)', () => {
  assert.equal(fmtDur(398), '6時間38分');
  assert.equal(fmtDur(420), '7時間');
  assert.equal(fmtDur(7980), '133時間');
  assert.equal(fmtDur(38), '38分');
  assert.equal(fmtDur(0), '0分');
  assert.equal(fmtDur(-22), '−22分');
  assert.equal(fmtDur(-310), '−5時間10分');
  assert.equal(fmtDurSigned(108), '+1時間48分');
  assert.equal(fmtDurSigned(-22), '−22分');
  assert.equal(fmtDurSigned(0), '±0分');
});

test('画面用HTMLは数字のあとに小さな単位を添える', () => {
  assert.equal(durHTML(398), '6<small class="u">時間</small>38<small class="u">分</small>');
  assert.equal(durHTML(420), '7<small class="u">時間</small>');
  assert.equal(durHTML(0), '0<small class="u">分</small>');
  assert.equal(durHTML(108, { signed: true }), '+1<small class="u">時間</small>48<small class="u">分</small>');
  assert.equal(durHTML(-22, { signed: true }), '−22<small class="u">分</small>');
  assert.equal(durHTML(0, { signed: true }), '±0<small class="u">分</small>');
});

test('1日の勤務時間 = 退勤 − 出勤 − 休憩(既定60分)', () => {
  const d = computeDay('2026-09-01', { in: '09:24', out: '17:02' });
  assert.equal(d.workMin, 398); // 6:38
  assert.equal(d.diffMin, -22); // 7:00との差
  assert.equal(d.status, 'done');
  const e = computeDay('2026-09-03', { in: '09:27', out: '18:31' });
  assert.equal(e.workMin, 484); // 8:04
  assert.equal(e.diffMin, 64);
});

test('休憩は5分単位で調整でき、0分にもできる', () => {
  const base = { in: '09:00', out: '17:00' };
  assert.equal(computeDay('2026-09-01', { ...base, break: 45 }).workMin, 435);
  assert.equal(computeDay('2026-09-01', { ...base, break: 65 }).workMin, 415);
  assert.equal(computeDay('2026-09-01', { ...base, break: 0 }).workMin, 480);
  // 休憩が拘束時間を超えても負にならない
  assert.equal(computeDay('2026-09-01', { in: '09:00', out: '09:30', break: 60 }).workMin, 0);
});

test('有給: 全休7:00 / 半休3:30 / 時間休1時間単位', () => {
  assert.equal(leaveMinutes({ kind: 'full' }), 420);
  assert.equal(leaveMinutes({ kind: 'half' }), 210);
  assert.equal(leaveMinutes({ kind: 'hours', hours: 1 }), 60);
  assert.equal(leaveMinutes({ kind: 'hours', hours: 3 }), 180);
  assert.equal(leaveMinutes({ kind: 'hours', hours: 9 }), 420); // 所定時間で頭打ち
  assert.equal(leaveMinutes(undefined), 0);

  const full = computeDay('2026-09-11', { leave: { kind: 'full' } });
  assert.equal(full.status, 'leave');
  assert.equal(full.creditedMin, 420);
  assert.equal(full.diffMin, 0);

  // 勤務と合算: 4:00勤務 + 時間休3h = 7:00
  const mix = computeDay('2026-09-11', { in: '09:00', out: '14:00', leave: { kind: 'hours', hours: 3 } });
  assert.equal(mix.workMin, 240);
  assert.equal(mix.creditedMin, 420);
  assert.equal(mix.diffMin, 0);

  // 半休 + 午前だけ勤務 3:30
  const half = computeDay('2026-09-11', { in: '09:00', out: '13:30', break: 60, leave: { kind: 'half' } });
  assert.equal(half.creditedMin, 210 + 210);
});

test('退勤前は勤務中(集計に入れない)、不正な時刻は invalid', () => {
  const w = computeDay('2026-09-11', { in: '09:00' });
  assert.equal(w.status, 'working');
  assert.equal(w.counted, false);
  assert.equal(w.diffMin, null);
  assert.equal(computeDay('2026-09-11', { in: '17:00', out: '09:00' }).status, 'invalid');
  assert.equal(computeDay('2026-09-11', { out: '17:00' }).status, 'invalid');
});

test('土日祝は休み。出勤記録があれば休日出勤として全時間がプラス', () => {
  assert.equal(computeDay('2026-09-05').kind, 'weekend');
  assert.equal(computeDay('2026-09-21').kind, 'holiday');
  const sat = computeDay('2026-09-05', { in: '10:00', out: '15:00', break: 0 });
  assert.equal(sat.scheduled, false);
  assert.equal(sat.creditedMin, 300);
  assert.equal(sat.diffMin, 300);
  // 休日の有給は無効
  assert.equal(computeDay('2026-09-05', { leave: { kind: 'full' } }).status, 'empty');
});

test('2026年9月: 所定出勤日19日 × 7時間 = 133:00', () => {
  const m = computeMonth({ days: {} }, 2026, 9, '2026-09-11');
  assert.equal(m.scheduledDays, 19);
  assert.equal(m.targetMin, 133 * 60);
  // 敬老の日・国民の休日・秋分の日が休み
  const holidays = m.days.filter((d) => d.kind === 'holiday').map((d) => d.date);
  assert.deepEqual(holidays, ['2026-09-21', '2026-09-22', '2026-09-23']);
});

test('2026年9月 9/1〜9/10 のスクショ実績で集計', () => {
  const m = computeMonth({ days: SCREENSHOT_DAYS }, 2026, 9, '2026-09-11');
  assert.equal(m.actualMin, 3050); // 50:50
  assert.equal(m.recordedScheduled, 8);
  assert.equal(m.balanceMin, -310); // 8日分 56:00 に対して −5:10
  assert.equal(m.remainingMin, 4930); // 82:10
  assert.equal(m.futureDays, 11); // 9/11〜9/30 の所定出勤日
  assert.equal(m.missingPast, 0);
  assert.equal(m.paceMin, Math.ceil(4930 / 11)); // 7:29
  assert.equal(m.achieved, false);
});

test('有給を入力すると残り時間が自動で減る', () => {
  const days = { ...SCREENSHOT_DAYS, '2026-09-11': { leave: { kind: 'full' } }, '2026-09-14': { leave: { kind: 'hours', hours: 2 } } };
  const m = computeMonth({ days }, 2026, 9, '2026-09-11');
  assert.equal(m.actualMin, 3050 + 420 + 120);
  assert.equal(m.remainingMin, 4930 - 540);
  // 有給の日は「未記録の所定出勤日」から外れる
  assert.equal(m.futureDays, 9);
  // 時間休だけの日は勤務の記録がないので、その日の7:00との差は −5:00
  assert.equal(m.balanceMin, -310 + 0 + (120 - 420));
});

test('休日扱いに設定した日は目標から外れる', () => {
  const m = computeMonth({ days: { '2026-09-14': { off: true } } }, 2026, 9, '2026-09-11');
  assert.equal(m.scheduledDays, 18);
  assert.equal(m.targetMin, 18 * 420);
});

test('過去日に記録がなければ「読み込み忘れ」として数える', () => {
  const m = computeMonth({ days: {} }, 2026, 9, '2026-09-11');
  assert.equal(m.missingPast, 8); // 9/1〜9/10 の平日
  assert.equal(m.futureDays, 11);
});

test('目標達成と月末', () => {
  const days = {};
  for (const d of computeMonth({ days: {} }, 2026, 9).days) {
    if (d.scheduled) days[d.date] = { in: '09:00', out: '17:00' };
  }
  const m = computeMonth({ days }, 2026, 9, '2026-10-01');
  assert.equal(m.remainingMin, 0);
  assert.equal(m.balanceMin, 0);
  assert.equal(m.paceMin, null);
  assert.equal(m.achieved, true);
});

test('設定で所定時間・既定休憩を変えられる', () => {
  const s = { settings: { dailyMinutes: 480, defaultBreak: 45 }, days: { '2026-09-01': { in: '09:00', out: '18:00' } } };
  const m = computeMonth(s, 2026, 9, '2026-09-02');
  assert.equal(m.targetMin, 19 * 480);
  assert.equal(m.days[0].workMin, 495); // 9h − 45分
  assert.equal(m.days[0].diffMin, 15);
});

test('退勤前の今日: 所定時間ちょうどで帰れる時刻', () => {
  const d = computeDay('2026-09-11', { in: '09:24' });
  assert.equal(fmtClock(suggestedLeaveTime(d, DEFAULT_SETTINGS)), '17:24'); // 9:24 + 7h + 休憩1h → 17:24
  assert.equal(suggestedLeaveTime(computeDay('2026-09-11', { in: '09:00', out: '18:00' })), null);
});
