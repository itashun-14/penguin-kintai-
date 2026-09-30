import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttendance, mergeRows } from '../js/parse.js';

// 提供スクショをそのままテキストにしたもの
const SCREENSHOT_TEXT = `
タイムカード 勤務報告書
2026/09/01 - 2026/09/31
前月 翌月
9/1(火) 出勤 09:24 退勤 17:02
9/2(水) 出勤 08:56 退勤 15:00
9/3(木) 出勤 09:27 退勤 18:31
9/4(金) 出勤 09:59 退勤 15:17
9/5(土)
9/6(日)
9/7(月) 出勤 08:51 退勤 18:00
9/8(火) 出勤 10:50 退勤 17:03
9/9(水) 出勤 08:56 退勤 16:02
9/10(木) 出勤 09:01 退勤 17:19
ホーム ダイヤル 電話帳 履歴 ワンタッチ
`;

test('スクショのテキストから 9/1〜9/10 を取り出す(記録のない土日は出さない)', () => {
  const r = parseAttendance(SCREENSHOT_TEXT);
  assert.equal(r.year, 2026);
  assert.equal(r.month, 9);
  assert.equal(r.headerFound, true);
  assert.deepEqual(
    r.rows.map((x) => [x.date, x.in, x.out]),
    [
      ['2026-09-01', '09:24', '17:02'],
      ['2026-09-02', '08:56', '15:00'],
      ['2026-09-03', '09:27', '18:31'],
      ['2026-09-04', '09:59', '15:17'],
      ['2026-09-07', '08:51', '18:00'],
      ['2026-09-08', '10:50', '17:03'],
      ['2026-09-09', '08:56', '16:02'],
      ['2026-09-10', '09:01', '17:19'],
    ],
  );
  assert.ok(r.rows.every((x) => x.warnings.length === 0));
});

test('OCRの揺れ(全角・O/l混同・区切り違い・ラベル欠落)に耐える', () => {
  const r = parseAttendance(
    ['2026/09/01 - 2026/09/31', '９/１(火)  出勤 O9:24  退勤 l7;02', '9/2(水) 08.56 15:00'].join('\n'),
  );
  assert.deepEqual(
    r.rows.map((x) => [x.date, x.in, x.out]),
    [
      ['2026-09-01', '09:24', '17:02'],
      ['2026-09-02', '08:56', '15:00'],
    ],
  );
});

test('出勤のみ(勤務中)と、退勤のみ', () => {
  const r = parseAttendance('2026/09/01 - 2026/09/31\n9/11(金) 出勤 09:10\n9/14(月) 退勤 17:00');
  assert.deepEqual(r.rows[0], { date: '2026-09-11', in: '09:10', out: null, confidence: null, warnings: [] });
  assert.equal(r.rows[1].in, null);
  assert.equal(r.rows[1].out, '17:00');
  assert.ok(r.rows[1].warnings.some((w) => w.code === 'no-in'));
});

test('日付と時刻が別の行に分かれていても連結する(iPhoneのテキストコピー)', () => {
  const r = parseAttendance('2026/09/01 - 2026/09/31\n9/1(火)\n出勤 09:24\n退勤 17:02\n9/2(水)\n出勤 08:56\n退勤 15:00');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].out, '15:00');
});

test('曜日が暦と合わない行・退勤が出勤より前の行に警告', () => {
  const r = parseAttendance('2026/09/01 - 2026/09/31\n9/1(水) 出勤 09:24 退勤 17:02\n9/2(水) 出勤 18:00 退勤 09:00');
  assert.ok(r.rows[0].warnings.some((w) => w.code === 'dow'));
  assert.ok(r.rows[1].warnings.some((w) => w.code === 'order'));
});

test('信頼度が低い行・画面端の行に警告(ぼやけた行の目印)', () => {
  const r = parseAttendance([
    { text: '2026/09/01 - 2026/09/31', confidence: 96 },
    { text: '9/10(木) 出勤 09:01 退勤 17:19', confidence: 93 },
    { text: '9/11(金) 出勤 09:00 退勤 17:00', confidence: 52, edge: true },
  ]);
  assert.equal(r.rows[0].warnings.length, 0);
  const codes = r.rows[1].warnings.map((w) => w.code);
  assert.ok(codes.includes('confidence') && codes.includes('edge'));
});

test('別の月・存在しない日付は無視して一覧で知らせる', () => {
  const r = parseAttendance('2026/09/01 - 2026/09/31\n3/1(火) 出勤 09:00 退勤 17:00\n9/31(木) 出勤 09:00 退勤 17:00\n9/2(水) 出勤 09:00 退勤 17:00');
  assert.equal(r.rows.length, 1);
  assert.equal(r.ignored.length, 2);
});

test('ヘッダーがない画像は、指定した年月で解釈する', () => {
  const r = parseAttendance('9/15(火) 出勤 09:00 退勤 17:00', { fallback: { year: 2026, month: 9 } });
  assert.equal(r.headerFound, false);
  assert.equal(r.rows[0].date, '2026-09-15');
  const none = parseAttendance('9/15(火) 出勤 09:00 退勤 17:00');
  assert.equal(none.rows.length, 0);
});

test('複数枚のスクショを日付ごとに統合(重なった日は情報が揃った方を採用)', () => {
  const a = parseAttendance('2026/09/01 - 2026/09/31\n9/1(火) 出勤 09:24 退勤 17:02\n9/2(水) 出勤 08:56').rows;
  const b = parseAttendance('2026/09/01 - 2026/09/31\n9/2(水) 出勤 08:56 退勤 15:00\n9/3(木) 出勤 09:27 退勤 18:31').rows;
  const merged = mergeRows(a, b);
  assert.deepEqual(merged.map((x) => x.date), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(merged[1].out, '15:00');
});
