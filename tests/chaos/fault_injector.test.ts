/**
 * tests/chaos/fault_injector.test.ts — حاقن القطوع (المرحلة 34)
 * المالك: ديوان التدقيق | المدخلات: مقاعد قطع | المخرجات: قطع نشط أو رفض برمزه
 * التبعيات: FaultInjector + سجل التدقيق + تهيئة الانقطاع
 * الصلاحيات: القطع والعودة فقط بجهة التهيئة | السجلات: fault_* بأسمائها
 * حالات الفشل: كلها مغلقة ومسجَّلة — ولا عودة تُعلن بلا إثبات
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت الاختبار: 1) الجهة أولًا؛ 2) لا قطعان في وقت واحد؛ 3) العودة بإثبات لا بدعوى.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FaultInjector } from '../../src/index';
import {
  T0, chaosHarness, countEvent, dummySeam, lastDetail,
} from './helpers';

test('الحاقن يُعلن نفسه في السجل ويُعلن القطوع التي يعرفها', () => {
  const h = chaosHarness();
  assert.equal(countEvent(h.s, 'fault_injector_online') >= 1, true);
  const detail = lastDetail(h.s, 'fault_injector_online');
  assert.deepEqual(detail.faults, [...h.policy.faults]);
});

test('تسجيل مقعد بجهة التهيئة يُقبل ويُسجَّل', () => {
  const h = chaosHarness();
  const seam = dummySeam('network');
  assert.equal(h.injector.register(h.authority, seam).ok, true);
  assert.deepEqual([...h.injector.registered()], ['network']);
  assert.equal(countEvent(h.s, 'fault_seam_registered'), 1);
});

test('تسجيل من غير جهة التهيئة ⇒ CHAOS_REGISTER_UNAUTHORIZED', () => {
  const h = chaosHarness();
  const out = h.injector.register('identity:king', dummySeam('network'));
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_REGISTER_UNAUTHORIZED');
  assert.equal(lastDetail(h.s, 'fault_refused').code, 'CHAOS_REGISTER_UNAUTHORIZED');
});

test('مقعد لقطع غير معلن في التهيئة ⇒ CHAOS_FAULT_NOT_DECLARED', () => {
  const h = chaosHarness({ faults: ['network', 'identity', 'power'] });
  const out = h.injector.register(h.authority, dummySeam('disk'));
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_FAULT_NOT_DECLARED');
});

test('تسجيل مقعد مرتين ⇒ CHAOS_SEAM_ALREADY_REGISTERED — لا يُستبدل مقعد قِيس عليه', () => {
  const h = chaosHarness();
  h.injector.register(h.authority, dummySeam('network'));
  const out = h.injector.register(h.authority, dummySeam('network'));
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_SEAM_ALREADY_REGISTERED');
});

test('الحقن يقطع فعلًا ويُسجَّل، والقطع يظهر نشطًا', () => {
  const h = chaosHarness();
  const seam = dummySeam('power');
  h.injector.register(h.authority, seam);
  const out = h.injector.inject(h.authority, 'power', T0);
  assert.equal(out.ok, true);
  assert.equal(seam.cuts, 1);
  assert.equal(h.injector.isActive('power'), true);
  assert.deepEqual([...h.injector.activeFaults()], ['power']);
  assert.equal(lastDetail(h.s, 'fault_injected').kind, 'power');
});

test('الحقن من غير الجهة ⇒ CHAOS_INJECT_UNAUTHORIZED ولا قطع', () => {
  const h = chaosHarness();
  const seam = dummySeam('power');
  h.injector.register(h.authority, seam);
  const out = h.injector.inject('agent:rogue', 'power', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_INJECT_UNAUTHORIZED');
  assert.equal(seam.cuts, 0);
});

test('حقن بلا مقعد ⇒ CHAOS_SEAM_MISSING', () => {
  const h = chaosHarness();
  const out = h.injector.inject(h.authority, 'disk', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_SEAM_MISSING');
});

test('حقن قطع نشط مرة ثانية ⇒ CHAOS_FAULT_ALREADY_ACTIVE', () => {
  const h = chaosHarness();
  h.injector.register(h.authority, dummySeam('network'));
  h.injector.inject(h.authority, 'network', T0);
  const out = h.injector.inject(h.authority, 'network', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_FAULT_ALREADY_ACTIVE');
});

test('قطعان في وقت واحد ⇒ CHAOS_FAULT_OVERLAP: لا يُعرف أيهما كفى', () => {
  const h = chaosHarness();
  h.injector.register(h.authority, dummySeam('network'));
  const second = dummySeam('power');
  h.injector.register(h.authority, second);
  h.injector.inject(h.authority, 'network', T0);
  const out = h.injector.inject(h.authority, 'power', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_FAULT_OVERLAP');
  assert.equal(second.cuts, 0);
});

test('العودة تُشفي وتُسجَّل، ويعود القطع غير نشط', () => {
  const h = chaosHarness();
  const seam = dummySeam('network');
  h.injector.register(h.authority, seam);
  h.injector.inject(h.authority, 'network', T0);
  const out = h.injector.restore(h.authority, 'network');
  assert.equal(out.ok, true);
  assert.equal(seam.heals, 1);
  assert.equal(h.injector.isActive('network'), false);
  assert.equal(countEvent(h.s, 'fault_restored'), 1);
});

test('عودة غير متحققة ⇒ CHAOS_RESTORE_UNVERIFIED والقطع يبقى نشطًا', () => {
  const h = chaosHarness();
  const seam = dummySeam('network', { healsTo: false });
  h.injector.register(h.authority, seam);
  h.injector.inject(h.authority, 'network', T0);
  const out = h.injector.restore(h.authority, 'network');
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_RESTORE_UNVERIFIED');
  assert.equal(h.injector.isActive('network'), true, 'لا تُعلن عودة بدعوى');
  assert.equal(countEvent(h.s, 'fault_restore_unverified'), 1);
  assert.equal(countEvent(h.s, 'fault_restored'), 0);
});

test('العودة من غير الجهة ⇒ CHAOS_RESTORE_UNAUTHORIZED ولا شفاء', () => {
  const h = chaosHarness();
  const seam = dummySeam('network');
  h.injector.register(h.authority, seam);
  h.injector.inject(h.authority, 'network', T0);
  const out = h.injector.restore('agent:rogue', 'network');
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_RESTORE_UNAUTHORIZED');
  assert.equal(seam.heals, 0);
});

test('عودة قطع غير نشط ⇒ CHAOS_FAULT_NOT_ACTIVE', () => {
  const h = chaosHarness();
  h.injector.register(h.authority, dummySeam('network'));
  const out = h.injector.restore(h.authority, 'network');
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_FAULT_NOT_ACTIVE');
});

test('كل رفض في الحاقن مسجَّل باسمه fault_refused — لا رفض صامت (RULE-006)', () => {
  const h = chaosHarness();
  const before = countEvent(h.s, 'fault_refused');
  h.injector.inject(h.authority, 'disk', T0);
  h.injector.restore(h.authority, 'disk');
  h.injector.register('agent:rogue', dummySeam('power'));
  assert.equal(countEvent(h.s, 'fault_refused'), before + 3);
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});

test('حاقن مستقل بسياسة مصغّرة يقبل ما أعلنته سياسته وحدها', () => {
  const h = chaosHarness();
  const narrow = new FaultInjector({
    audit: h.s.audit,
    policy: { ...h.policy, faults: ['disk'] },
  });
  assert.equal(narrow.register(h.authority, dummySeam('disk')).ok, true);
  const out = narrow.register(h.authority, dummySeam('network'));
  assert.equal(out.ok, false);
});
