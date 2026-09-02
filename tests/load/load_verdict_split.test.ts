/**
 * tests/load/load_verdict_split.test.ts — قسمةُ الحكمَين تُختبر بأرقامٍ مصنوعةٍ لا بآلة
 * المالك: ديوان التدقيق | المدخلات: قوائمُ رموزٍ مكتوبةٌ في الاختبار | المخرجات: حكمان
 * التبعيات: src/load/load_verdicts.ts (دوالُّ نقيّةٌ لا تقرأ ساعةً ولا ملفًّا)
 * الصلاحيات: لا شيء — الاختبارُ يقرأ ولا يكتب حالةً ولا سجلًّا
 * السجلات: لا شيء | حالات الفشل: رمزٌ يسقط من القسمة أو حكمٌ يتأثر بصنفٍ ليس له
 * الوثيقة المرتبطة: docs/decisions/ADR-0047-verdict-separation.md · docs/test-reports/phase-33-verdict-split.md
 * ثوابت هذا الاختبار:
 *   1) **لا ساعةَ ولا آلةَ ولا مجلدَ مؤقّت**: كلُّ مدخلٍ حرفٌ مكتوبٌ هنا — فالنتيجةُ
 *      واحدةٌ على أيِّ عتادٍ وتحت أيِّ توازٍ، وهذا نفسُه المُثبَت لا المُدَّعى.
 *   2) **الحصرُ مغلق**: يُؤكَّد أنّ رمزًا مجهولًا يقع في صفِّ السلامةِ لا الزمن —
 *      فالخطأُ يميل إلى التشدّد، والرمزُ الجديدُ لا يُعفى من البوابة بالسهو.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMING_BREACH_CODES, isTimingBreach, splitBreaches, integrityVerdict, timingVerdict,
} from '../../src/load/load_verdicts';

const INTEGRITY_SAMPLES = [
  'COMMAND_LOSS', 'LEDGER_UNSOUND', 'COMMAND_FATE_MISSING', 'BURST_FATE_MISSING',
  'QUOTA_OVERRUN', 'QUOTA_PEAK_OVER_TOTAL', 'QUOTA_CAPACITY_MISMATCH',
  'QUOTA_LIMIT_NEVER_REACHED', 'QUOTA_NOT_RESTORED', 'SCHEDULER_TASK_FORGOTTEN',
  'SCHEDULER_OVER_QUEUE_MAX', 'SCHEDULER_LIMIT_NEVER_REACHED',
  'SCHEDULER_REFUSAL_WITHOUT_CODE', 'SCHEDULER_NOT_DRAINED', 'SCHEDULER_TASK_UNACCOUNTED',
];

test('القسمة: الرموزُ الزمنيّةُ أربعةٌ معدودةٌ بأسمائها لا مستنتجةٌ من نصِّها', () => {
  assert.deepEqual([...TIMING_BREACH_CODES], [
    'COMMAND_P99_OVER_THRESHOLD', 'COMMAND_MAX_OVER_THRESHOLD',
    'BURST_PER_COMMAND_OVER_MAX', 'CALIBRATION_OVER_MAX_SCALE',
  ]);
  for (const code of TIMING_BREACH_CODES) assert.equal(isTimingBreach(code), true);
});

test('القسمة: كلُّ رمزِ سلامةٍ معلنٍ في المستودع يقع في صفِّ السلامة', () => {
  for (const code of INTEGRITY_SAMPLES) {
    assert.equal(isTimingBreach(code), false, `الرمزُ ${code} ليس زمنيًّا`);
  }
});

test('القسمة: رمزٌ مجهولٌ يقع في صفِّ السلامة — الخطأُ يميل إلى التشدّد', () => {
  const split = splitBreaches(['SOME_FUTURE_BREACH_CODE']);
  assert.deepEqual(split.integrity, ['SOME_FUTURE_BREACH_CODE']);
  assert.deepEqual(split.timing, []);
  assert.equal(integrityVerdict(split), 'fail');
});

test('القسمة لا تُسقط رمزًا: المجموعُ عددًا وترتيبًا هو المدخلُ نفسُه', () => {
  const codes = [
    'COMMAND_P99_OVER_THRESHOLD', 'COMMAND_LOSS', 'BURST_PER_COMMAND_OVER_MAX',
    'SCHEDULER_TASK_FORGOTTEN', 'CALIBRATION_OVER_MAX_SCALE', 'LEDGER_UNSOUND',
  ];
  const split = splitBreaches(codes);
  assert.equal(split.integrity.length + split.timing.length, codes.length);
  assert.deepEqual(split.integrity, ['COMMAND_LOSS', 'SCHEDULER_TASK_FORGOTTEN', 'LEDGER_UNSOUND']);
  assert.deepEqual(split.timing, [
    'COMMAND_P99_OVER_THRESHOLD', 'BURST_PER_COMMAND_OVER_MAX', 'CALIBRATION_OVER_MAX_SCALE',
  ]);
});

test('حكمُ السلامةِ لا يتأثر بخرقٍ زمنيٍّ مهما كثر', () => {
  const timingOnly = splitBreaches([...TIMING_BREACH_CODES]);
  assert.equal(integrityVerdict(timingOnly), 'pass', 'بطءُ آلةٍ ليس فقدَ أمر');
  assert.equal(timingVerdict(timingOnly), 'fail', 'ولا يُبتلع: له حكمُه الأحمر');
});

test('حكمُ الزمنِ لا يتأثر بخرقِ سلامةٍ مهما كثر', () => {
  const integrityOnly = splitBreaches(INTEGRITY_SAMPLES);
  assert.equal(timingVerdict(integrityOnly), 'pass');
  assert.equal(integrityVerdict(integrityOnly), 'fail');
});

test('الحكمان مستقلّان في الحالات الأربع كلِّها — جدولُ حقيقةٍ لا مثال', () => {
  const cases: ReadonlyArray<readonly [readonly string[], 'pass' | 'fail', 'pass' | 'fail']> = [
    [[], 'pass', 'pass'],
    [['COMMAND_P99_OVER_THRESHOLD'], 'pass', 'fail'],
    [['COMMAND_LOSS'], 'fail', 'pass'],
    [['COMMAND_LOSS', 'COMMAND_P99_OVER_THRESHOLD'], 'fail', 'fail'],
  ];
  for (const [codes, integrity, timing] of cases) {
    const split = splitBreaches(codes);
    assert.equal(integrityVerdict(split), integrity, `سلامةُ ${JSON.stringify(codes)}`);
    assert.equal(timingVerdict(split), timing, `زمنُ ${JSON.stringify(codes)}`);
  }
});

test('الحكمُ حتميٌّ: ألفُ استدعاءٍ على المدخلِ نفسِه تُعطي الحكمَ نفسَه', () => {
  const codes = ['COMMAND_P99_OVER_THRESHOLD', 'QUOTA_OVERRUN'];
  const first = splitBreaches(codes);
  for (let i = 0; i < 1000; i += 1) {
    const again = splitBreaches(codes);
    assert.deepEqual(again, first);
    assert.equal(integrityVerdict(again), 'fail');
    assert.equal(timingVerdict(again), 'fail');
  }
});
