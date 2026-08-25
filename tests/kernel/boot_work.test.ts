/**
 * tests/kernel/boot_work.test.ts — عملُ الإقلاع مَعدودٌ ومحروسٌ بسقفٍ مجمَّد (البند T-134)
 * المالك: القيّم على المستودع | المدخلات: `bootstrapState` على تهيئة المستودع · عدّادُ العمل
 * المخرجات: حكمٌ على ثباتِ العدّ وجمودِ السقوف ورفضِ التجاوز
 * التبعيات: src/index · src/kernel/config (`bootWork` · `guardBootWork` · السقوف)
 * الصلاحيات (RULE-004): اختبارٌ يقرأ ويحكم؛ لا يُعدّل سقفًا
 * السجلات: قيدُ `boot_work_measured` في سجل الإقلاع — يُتحقَّق منه هنا
 * حالات الفشل: عدٌّ متغيّرٌ بين إقلاعَين · سقفٌ يُكتب عليه · تجاوزٌ يمرّ · قيدٌ غائب
 * الوثيقة: docs/test-reports/T-134-boot-work.md
 *
 * ثوابت هذا الاختبار:
 *
 *   1) **الحكمُ على أعدادٍ لا على زمن**: لا يقيس هذا الملفُّ مللي ثانيةً واحدة؛ لأنّ زمنَ
 *      الجدار يختلف بآلةٍ فيسقط الاختبارُ بريئًا. والمقيسُ عددُ عملٍ صحيحٌ يتكرّر حرفًا.
 *
 *   2) **الثباتُ يُثبَت بإقلاعَين لا بواحد**: إقلاعانِ في العمليّة نفسِها يعطيان العددَ نفسَه
 *      — وهو ما يجعل السقفَ عقدًا لا حظًّا (العدّادُ يُصفَّر في أوّلِ كلِّ تركيب).
 *
 *   3) **التجاوزُ يُختبر بأعدادٍ مصنوعةٍ لا بإفسادِ التهيئة**: `guardBootWork` يقبل حصيلةً
 *      مُمرَّرةً، فيُختبر رفضُه بلا لمسِ ملفٍّ على القرص.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { bootstrapState } from '../../src/index';
import {
  BOOT_WORK_CEILINGS, BootWork, bootWork, guardBootWork, resetBootWork,
} from '../../src/kernel/config';
import { SovereignViolation } from '../../src/kernel/types';

const CONFIG_DIR = 'config';
const AXES = Object.keys(BOOT_WORK_CEILINGS) as (keyof BootWork)[];

test('T-134: عدُّ عملِ الإقلاع نفسُه في إقلاعَين متتاليَين', () => {
  bootstrapState({ configDir: CONFIG_DIR, now: 1 });
  const first = { ...bootWork() };
  bootstrapState({ configDir: CONFIG_DIR, now: 2 });
  const second = { ...bootWork() };
  assert.deepEqual(second, first);
  for (const axis of AXES) assert.ok(first[axis] > 0, axis);
});

test('T-134: عملُ الإقلاع الفعليُّ تحت كلِّ سقفٍ معلن', () => {
  bootstrapState({ configDir: CONFIG_DIR, now: 3 });
  const work = bootWork();
  for (const axis of AXES) {
    assert.ok(work[axis] <= BOOT_WORK_CEILINGS[axis], `${axis}: ${work[axis]}`);
  }
  assert.doesNotThrow(() => guardBootWork(work));
});

test('T-134: السقوفُ مجمَّدةٌ لا تُكتب في التشغيل', () => {
  assert.ok(Object.isFrozen(BOOT_WORK_CEILINGS));
  assert.throws(() => {
    (BOOT_WORK_CEILINGS as unknown as Record<string, number>).file_reads = 10_000;
  });
});

test('T-134: كلُّ محورٍ يُرفض وحدَه فوق سقفه برمزٍ واحد', () => {
  for (const axis of AXES) {
    const over = { ...BOOT_WORK_CEILINGS, [axis]: BOOT_WORK_CEILINGS[axis] + 1 } as BootWork;
    assert.throws(() => guardBootWork(over), (error: unknown) => {
      assert.ok(error instanceof SovereignViolation);
      assert.equal(error.code, 'BOOT_WORK_OVER_CEILING');
      return true;
    }, axis);
  }
});

test('T-134: السقفُ نفسُه يمرّ — الحدُّ حدُّ تجاوزٍ لا حدُّ مساواة', () => {
  assert.doesNotThrow(() => guardBootWork({ ...BOOT_WORK_CEILINGS }));
});

test('T-134: التصفيرُ يُعيد كلَّ محورٍ إلى الصفر', () => {
  bootstrapState({ configDir: CONFIG_DIR, now: 4 });
  assert.ok(bootWork().file_reads > 0);
  resetBootWork();
  for (const axis of AXES) assert.equal(bootWork()[axis], 0);
});

test('T-134: قيدُ `boot_work_measured` يحمل المحاورَ الستّةَ في سجلِ الإقلاع', () => {
  const state = bootstrapState({ configDir: CONFIG_DIR, now: 5 });
  const entries = state.audit.find('boot_work_measured');
  assert.equal(entries.length, 1);
  const detail = entries[0]!.detail as Record<string, number>;
  for (const axis of AXES) {
    assert.equal(typeof detail[axis], 'number');
    assert.ok(detail[axis]! > 0, axis);
  }
});

test('T-134: القيدُ ليس أوّلَ السجلِّ ولا آخرَه — الحصرُ قبله والخاتمةُ بعده', () => {
  const state = bootstrapState({ configDir: CONFIG_DIR, now: 6 });
  const kinds = state.audit.snapshot().map((entry) => entry.kind);
  const at = kinds.indexOf('boot_work_measured');
  assert.ok(at > 0);
  assert.equal(kinds[0], 'declaration_budget_measured');
  assert.equal(kinds[at + 1], 'state_online');
});
