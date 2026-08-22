/**
 * tests/security/termination_roll.test.ts — سجل المنتهين (المرحلة 35)
 * المالك: حرس التاج | المدخلات: قيود إنهاء | المخرجات: جواب قاطع لكل مسلك
 * التبعيات: TerminationRoll، سجل التدقيق | الصلاحيات: لا شيء خارج القيد والقراءة
 * السجلات: entity_terminated_recorded / termination_record_duplicate
 * حالات الفشل: كيان فارغ، قيد مكرَّر، سؤال عن غير مقيَّد — كلها مغلقة
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت الاختبار: 1) الإنهاء نهائي؛ 2) القيد مُسجَّل دائمًا؛ 3) لا أثر ثانٍ للتكرار.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { T0, countEvent, freshRoll, lastDetail } from './helpers';

function fresh() {
  const s = bootstrapState({ now: T0 });
  return { s, roll: freshRoll(s) };
}

test('كيان غير مقيَّد ليس منتهيًا — لا استنتاج من حالة وحدة أخرى', () => {
  const { roll } = fresh();
  assert.equal(roll.isTerminated('agent:x'), false);
  assert.equal(roll.size, 0);
});

test('القيد الأول ينجح ويجعل الكيان منتهيًا', () => {
  const { roll } = fresh();
  assert.equal(roll.record('agent:x', 'authority:crown_guard', 'إنهاء', T0), true);
  assert.equal(roll.isTerminated('agent:x'), true);
  assert.equal(roll.size, 1);
});

test('القيد يُسجَّل في السجل الأبدي — قيدٌ صامت لا يُدقَّق (RULE-006)', () => {
  const { s, roll } = fresh();
  roll.record('agent:x', 'authority:crown_guard', 'حادث', T0);
  assert.equal(countEvent(s, 'entity_terminated_recorded'), 1);
  assert.equal(lastDetail(s, 'entity_terminated_recorded').entity, 'agent:x');
  assert.equal(lastDetail(s, 'entity_terminated_recorded').at, T0);
});

test('القيد المكرَّر يُرفض بلا أثر ثانٍ ويُسجَّل بوصفه تكرارًا', () => {
  const { s, roll } = fresh();
  roll.record('agent:x', 'authority:crown_guard', 'أول', T0);
  assert.equal(roll.record('agent:x', 'authority:crown_guard', 'ثانٍ', T0 + 5), false);
  assert.equal(roll.size, 1);
  assert.equal(countEvent(s, 'entity_terminated_recorded'), 1);
  assert.equal(countEvent(s, 'termination_record_duplicate'), 1);
});

test('التكرار لا يُبدّل سبب القيد الأول ولا زمنه', () => {
  const { roll } = fresh();
  roll.record('agent:x', 'authority:crown_guard', 'أول', T0);
  roll.record('agent:x', 'ministry:interior', 'ثانٍ', T0 + 900);
  const record = roll.recordOf('agent:x');
  assert.equal(record?.reason, 'أول');
  assert.equal(record?.at, T0);
  assert.equal(record?.by, 'authority:crown_guard');
});

test('كيان فارغ يُرفض ولا يُصحَّح عن صاحبه (فشل مغلق)', () => {
  const { s, roll } = fresh();
  assert.equal(roll.record('', 'authority:crown_guard', 'إنهاء', T0), false);
  assert.equal(roll.record('   ', 'authority:crown_guard', 'إنهاء', T0), false);
  assert.equal(roll.size, 0);
  assert.equal(countEvent(s, 'entity_terminated_recorded'), 0);
});

test('لا دالّة ترفع القيد — الإنهاء نهائي بالبناء لا بالاتفاق (ثابت 1)', () => {
  const { roll } = fresh();
  const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(roll));
  for (const forbidden of ['remove', 'delete', 'restore', 'revive', 'clear', 'undo']) {
    assert.equal(surface.includes(forbidden), false, `سطح السجل يجب ألّا يحوي ${forbidden}`);
  }
});

test('القراءة لا تُغيّر ما تقرؤه: recordOf و list يعيدان نسخًا', () => {
  const { roll } = fresh();
  roll.record('agent:x', 'authority:crown_guard', 'إنهاء', T0);
  const copy = roll.recordOf('agent:x') as { reason: string };
  copy.reason = 'مُبدَّل';
  assert.equal(roll.recordOf('agent:x')?.reason, 'إنهاء');
  const list = roll.list() as unknown as { reason: string }[];
  list[0]!.reason = 'مُبدَّل';
  assert.equal(roll.recordOf('agent:x')?.reason, 'إنهاء');
});

test('السجل يحصي كيانات كثيرة بلا خلط', () => {
  const { roll } = fresh();
  for (let i = 0; i < 40; i += 1) roll.record(`agent:${i}`, 'authority:crown_guard', 'دفعة', T0 + i);
  assert.equal(roll.size, 40);
  assert.equal(roll.isTerminated('agent:39'), true);
  assert.equal(roll.isTerminated('agent:40'), false);
  assert.equal(roll.list().length, 40);
});

test('السجل لا يُنهي ولا يسحب ولا يحرّر — يقيّد فقط (ثابت 3)', () => {
  const s = bootstrapState({ now: T0 });
  const roll = freshRoll(s);
  const before = s.audit.snapshot().length;
  roll.record('agent:x', 'authority:crown_guard', 'إنهاء', T0);
  const added = s.audit.snapshot().length - before;
  assert.equal(added, 1, 'القيد يُنتج سجلًا واحدًا لا آثارًا جانبية');
});

test('سجل الدولة المُقلعة موصول ومقروء من الخارج', () => {
  const s = bootstrapState({ now: T0 });
  assert.equal(s.terminationRoll.size, 0);
  assert.equal(s.terminationRoll.isTerminated('agent:none'), false);
});

test('recordOf لكيان غير مقيَّد يُرجع undefined لا كائنًا فارغًا', () => {
  const { roll } = fresh();
  assert.equal(roll.recordOf('agent:ghost'), undefined);
});
