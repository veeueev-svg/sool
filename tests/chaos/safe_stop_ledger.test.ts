/**
 * tests/chaos/safe_stop_ledger.test.ts — دفتر التوقف الآمن (المرحلة 34)
 * المالك: ديوان التدقيق | المدخلات: قطوع معلنة وقياسات | المخرجات: أحكام برموز خرق
 * التبعيات: SafeStopLedger + matchEffects + سجل التدقيق
 * الصلاحيات: العدّ والحكم والتصعيد فقط — لا إصلاح ولا قطع
 * السجلات: safe_stop_* و escalated_to_king
 * حالات الفشل: قياس لقطع غير معلن، أو قياس مكرر ⇒ رفض مسجَّل
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت الاختبار: 1) لكل شرط رمز خرق يُسقطه وحده؛ 2) القطع غير المقيس خرق؛
 *                  3) الحكم على ما أعلنته التهيئة لا على ما قِيس.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CutObservation, SafeStopLedger, matchEffects } from '../../src/index';
import { chaosHarness, countEvent, hasEvent, lastDetail } from './helpers';

/** قياس سليم تمامًا: كل تعديل عليه يُظهر رمز خرق واحدًا بعينه */
function sound(overrides: Partial<CutObservation> = {}): CutObservation {
  return {
    proceeded: false,
    refusalCode: 'CHANNEL_PERSIST_FAILED',
    effects: matchEffects({ effects: ['c1'], records: [{ commandId: 'c1', status: 'executed' }] }),
    danglingLeases: 0,
    auditIntact: true,
    modeAfter: 'limited',
    declaredStop: true,
    stopMs: 10,
    restored: true,
    ...overrides,
  };
}

function ledgerOnly(overrides: Parameters<typeof chaosHarness>[0] = {}): {
  h: ReturnType<typeof chaosHarness>; ledger: SafeStopLedger;
} {
  const h = chaosHarness(overrides);
  return { h, ledger: h.ledger };
}

test('قطع معلن ثم مقيس بقياس سليم ⇒ حكمه pass بلا خرق', () => {
  const { h, ledger } = ledgerOnly();
  assert.equal(ledger.declare(h.authority, 'network'), true);
  assert.equal(ledger.observe(h.authority, 'network', sound()), true);
  const verdict = ledger.judge('network');
  assert.deepEqual([...verdict.breaches], []);
  assert.equal(verdict.verdict, 'pass');
  assert.equal(countEvent(h.s, 'safe_stop_declared'), 1);
  assert.equal(countEvent(h.s, 'safe_stop_observed'), 1);
});

test('إعلان قطع غير معلن في التهيئة ⇒ رفض برمز CHAOS_CUT_NOT_DECLARED', () => {
  const { h, ledger } = ledgerOnly({ faults: ['network', 'identity', 'power'] });
  assert.equal(ledger.declare(h.authority, 'disk'), false);
  assert.equal(lastDetail(h.s, 'safe_stop_refused').code, 'CHAOS_CUT_NOT_DECLARED');
});

test('قياس قطع لم يُعلن ⇒ يُرفض ولا يُحتسب', () => {
  const { h, ledger } = ledgerOnly();
  assert.equal(ledger.observe(h.authority, 'power', sound()), false);
  assert.equal(lastDetail(h.s, 'safe_stop_refused').code, 'CHAOS_CUT_NOT_DECLARED');
  assert.equal(ledger.judge('power').breaches.includes('CHAOS_CUT_NOT_OBSERVED'), true);
});

test('قياس مكرر ⇒ CHAOS_CUT_ALREADY_OBSERVED: لا تُستبدل قراءة سيئة بحسنة', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'network');
  ledger.observe(h.authority, 'network', sound({ proceeded: true }));
  assert.equal(ledger.observe(h.authority, 'network', sound()), false);
  assert.equal(lastDetail(h.s, 'safe_stop_refused').code, 'CHAOS_CUT_ALREADY_OBSERVED');
  assert.equal(ledger.judge('network').breaches.includes('CHAOS_SILENT_CONTINUATION'), true);
});

test('فعل سيادي مضى تحت القطع ⇒ CHAOS_SILENT_CONTINUATION', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'network');
  ledger.observe(h.authority, 'network', sound({ proceeded: true, refusalCode: null }));
  assert.deepEqual([...ledger.judge('network').breaches], ['CHAOS_SILENT_CONTINUATION']);
});

test('رفض بلا رمز ⇒ CHAOS_REFUSAL_WITHOUT_CODE: توقف غير موثَّق', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'network');
  ledger.observe(h.authority, 'network', sound({ refusalCode: null }));
  assert.deepEqual([...ledger.judge('network').breaches], ['CHAOS_REFUSAL_WITHOUT_CODE']);
});

test('أمر نصف منفَّذ ⇒ CHAOS_HALF_EXECUTED', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'power');
  ledger.observe(h.authority, 'power', sound({
    effects: matchEffects({ effects: ['c1'], records: [{ commandId: 'c1', status: 'pending' }] }),
  }));
  assert.deepEqual([...ledger.judge('power').breaches], ['CHAOS_HALF_EXECUTED']);
});

test('تنفيذ مزدوج ⇒ CHAOS_DOUBLE_EXECUTED ولو كان السجل واحدًا', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'power');
  ledger.observe(h.authority, 'power', sound({
    effects: matchEffects({ effects: ['c1', 'c1'], records: [{ commandId: 'c1', status: 'executed' }] }),
  }));
  assert.deepEqual([...ledger.judge('power').breaches], ['CHAOS_DOUBLE_EXECUTED']);
});

test('إيجار معلَّق ⇒ CHAOS_DANGLING_LEASE', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'power');
  ledger.observe(h.authority, 'power', sound({ danglingLeases: 1 }));
  assert.deepEqual([...ledger.judge('power').breaches], ['CHAOS_DANGLING_LEASE']);
});

test('سلسلة تدقيق مكسورة ⇒ CHAOS_AUDIT_CHAIN_BROKEN', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'identity');
  ledger.observe(h.authority, 'identity', sound({ auditIntact: false }));
  assert.deepEqual([...ledger.judge('identity').breaches], ['CHAOS_AUDIT_CHAIN_BROKEN']);
});

test('توقف غير معلن ⇒ CHAOS_STOP_UNDECLARED', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'identity');
  ledger.observe(h.authority, 'identity', sound({ declaredStop: false }));
  assert.deepEqual([...ledger.judge('identity').breaches], ['CHAOS_STOP_UNDECLARED']);
});

test('توقف بعد المهلة ⇒ CHAOS_STOP_TOO_SLOW', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'identity');
  ledger.observe(h.authority, 'identity', sound({ stopMs: h.policy.safe_stop_deadline_ms + 1 }));
  assert.deepEqual([...ledger.judge('identity').breaches], ['CHAOS_STOP_TOO_SLOW']);
});

test('الوضع بقي full بعد القطع ⇒ خرقان: يستمر كاملًا ولم يُعلن الوضع المشترط', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'disk');
  ledger.observe(h.authority, 'disk', sound({ modeAfter: 'full' }));
  const breaches = ledger.judge('disk').breaches;
  assert.ok(breaches.includes('CHAOS_MODE_STILL_FULL'));
  assert.ok(breaches.includes('CHAOS_MODE_NOT_DECLARED_FALLBACK'));
});

test('وضع غير الوضع المشترط ⇒ CHAOS_MODE_NOT_DECLARED_FALLBACK', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'disk');
  ledger.observe(h.authority, 'disk', sound({ modeAfter: 'halted' }));
  assert.deepEqual([...ledger.judge('disk').breaches], ['CHAOS_MODE_NOT_DECLARED_FALLBACK']);
});

test('قطع لم تعد الدولة منه ⇒ CHAOS_CUT_NOT_RESTORED', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'disk');
  ledger.observe(h.authority, 'disk', sound({ restored: false }));
  assert.deepEqual([...ledger.judge('disk').breaches], ['CHAOS_CUT_NOT_RESTORED']);
});

test('الحكم الجامع يشمل كل قطع في التهيئة ويُسمّي الخرق بقطعه', () => {
  const { h, ledger } = ledgerOnly();
  for (const kind of h.policy.faults) {
    ledger.declare(h.authority, kind);
    ledger.observe(h.authority, kind, sound());
  }
  const report = ledger.judgeAll(h.authority);
  assert.equal(report.verdict, 'pass');
  assert.equal(report.declared, h.policy.faults.length);
  assert.equal(report.observed, h.policy.faults.length);
  assert.equal(hasEvent(h.s, 'safe_stop_breach'), false);
  assert.equal(lastDetail(h.s, 'safe_stop_verdict').verdict, 'pass');
});

test('قطع معلن لم يُقَس ⇒ الحكم fail برمزه مسبوقًا بنوع القطع', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'network');
  ledger.observe(h.authority, 'network', sound());
  const report = ledger.judgeAll(h.authority);
  assert.equal(report.verdict, 'fail');
  assert.ok(report.breaches.includes('identity:CHAOS_CUT_NOT_OBSERVED'));
  assert.ok(report.breaches.includes('power:CHAOS_CUT_NOT_OBSERVED'));
  assert.ok(report.breaches.includes('disk:CHAOS_CUT_NOT_OBSERVED'));
  assert.equal(report.observed, 1);
});

test('الخرق يُصعَّد إلى الملك حين توجب التهيئة، ويُسجَّل باسمه', () => {
  const { h, ledger } = ledgerOnly();
  ledger.declare(h.authority, 'network');
  ledger.observe(h.authority, 'network', sound({ proceeded: true, refusalCode: null }));
  ledger.judgeAll(h.authority);
  assert.equal(hasEvent(h.s, 'safe_stop_breach'), true);
  assert.equal(hasEvent(h.s, 'escalated_to_king'), true);
});

test('تهيئة لا توجب التصعيد لا تُسكِت الخرق بل تُسجّله بلا تصعيد', () => {
  // السياسة الفعلية توجب التصعيد؛ هذه نسخة مصغّرة تُثبت أن العلم مُنفَّذ لا مزيّن.
  const { h, ledger } = ledgerOnly({ escalate_on_breach: false });
  ledger.declare(h.authority, 'network');
  ledger.observe(h.authority, 'network', sound({ proceeded: true, refusalCode: null }));
  const report = ledger.judgeAll(h.authority);
  assert.equal(report.verdict, 'fail');
  assert.equal(hasEvent(h.s, 'safe_stop_breach'), true);
  assert.equal(hasEvent(h.s, 'escalated_to_king'), false);
});

test('الدفتر لا يُصلح ما يقيسه: القياس يبقى كما ورد', () => {
  const { h, ledger } = ledgerOnly();
  const observation = sound({ danglingLeases: 3 });
  ledger.declare(h.authority, 'power');
  ledger.observe(h.authority, 'power', observation);
  const verdict = ledger.judge('power');
  assert.equal(verdict.observation?.danglingLeases, 3, 'لم يُحرَّر إيجار أثناء الحكم');
  assert.equal(verdict.verdict, 'fail');
});

test('كل حكم يُسجَّل وسلسلة التدقيق تبقى سليمة بعد الأحكام كلها', () => {
  const { h, ledger } = ledgerOnly();
  for (const kind of h.policy.faults) {
    ledger.declare(h.authority, kind);
    ledger.observe(h.authority, kind, sound());
  }
  ledger.judgeAll(h.authority);
  assert.equal(countEvent(h.s, 'safe_stop_verdict'), 1);
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});

test('دفتر مستقل بسياسة مصغّرة يحكم على قطوع سياسته وحدها', () => {
  const h = chaosHarness();
  const narrow = new SafeStopLedger({
    audit: h.s.audit,
    policy: { ...h.policy, faults: ['disk'] },
  });
  narrow.declare(h.authority, 'disk');
  narrow.observe(h.authority, 'disk', sound());
  const report = narrow.judgeAll(h.authority);
  assert.equal(report.declared, 1);
  assert.equal(report.verdict, 'pass');
});
