import test from 'node:test';
import assert from 'node:assert/strict';
import { holidaysOf, holidayName } from '../js/holidays.js';

test('2026年の祝日(振替休日・国民の休日を含む)', () => {
  const got = Object.fromEntries(holidaysOf(2026));
  assert.deepEqual(got, {
    '2026-01-01': '元日',
    '2026-01-12': '成人の日',
    '2026-02-11': '建国記念の日',
    '2026-02-23': '天皇誕生日',
    '2026-03-20': '春分の日',
    '2026-04-29': '昭和の日',
    '2026-05-03': '憲法記念日',
    '2026-05-04': 'みどりの日',
    '2026-05-05': 'こどもの日',
    '2026-05-06': '振替休日',
    '2026-07-20': '海の日',
    '2026-08-11': '山の日',
    '2026-09-21': '敬老の日',
    '2026-09-22': '国民の休日',
    '2026-09-23': '秋分の日',
    '2026-10-12': 'スポーツの日',
    '2026-11-03': '文化の日',
    '2026-11-23': '勤労感謝の日',
  });
});

test('2025年: 振替休日と春分・秋分', () => {
  assert.equal(holidayName('2025-02-24'), '振替休日'); // 2/23(日)の振替
  assert.equal(holidayName('2025-03-20'), '春分の日');
  assert.equal(holidayName('2025-09-23'), '秋分の日');
  assert.equal(holidayName('2025-11-24'), '振替休日'); // 11/23(日)の振替
  assert.equal(holidayName('2025-05-06'), '振替休日'); // 5/4(日)の振替
});

test('2027年・2028年の春分/秋分', () => {
  assert.equal(holidayName('2027-03-21'), '春分の日');
  assert.equal(holidayName('2027-09-23'), '秋分の日');
  assert.equal(holidayName('2028-03-20'), '春分の日');
  assert.equal(holidayName('2028-09-22'), '秋分の日');
});

test('東京オリンピックの年の移動(2020・2021)', () => {
  assert.equal(holidayName('2020-07-23'), '海の日');
  assert.equal(holidayName('2020-07-24'), 'スポーツの日');
  assert.equal(holidayName('2020-08-10'), '山の日');
  assert.equal(holidayName('2021-08-09'), '振替休日'); // 8/8(日)の振替
});

test('平日は祝日ではない', () => {
  assert.equal(holidayName('2026-09-01'), null);
});
