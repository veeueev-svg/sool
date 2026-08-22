/**
 * tests/security/termination_ledger.test.ts — دفتر الحكم على الإنهاء (المرحلة 35)
 * المالك: ديوان التدقيق | المدخلات: دعوى أمر + قياسات + شهادات | المخرجات: حكم برموز خرق
 * التبعيات: TerminationLedger، StopWitness | الصلاحيات: الحكم لا يُنفّذ ولا يُصلح
 * السجلات: termination_order_declared / termination_judged / termination_breach / termination_verdict
 * حالات الفشل: كل رمز خرق مغطّى باختبار مستقل
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت الاختبار: 1) الدعوى تُحاكم بالقياس؛ 2) كل خرق برمزه؛ 3) خرق واحد يُسقط الحكم كله.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityId, ProbeEvidence, TerminationLedger, bootstrapState, loadTermination } from '../../src/index';
import { T0, countEvent, lastDetail } from './helpers';

const policy = loadTermination().policy;
const A: EntityId = 'agent:worker-0001';
const B: EntityId = 'agent:worker-0002';
const WITNESS: EntityId = policy.witness_authority;

function fresh(over: Partial<typeof policy> = {}) {
  const s = bootstrapState({ now: T0 });
  const ledger = new TerminationLedger({ audit: s.audit, policy: { ...policy, ...over } });
  return { s, ledger };
}

/** شهادة نظيفة: عمل قبل الأمر، رُفض بعده برمز معلن */
function clean(kind: ProbeEvidence['kind'] = 'tool'): ProbeEvidence {
  return {
    kind,
    actedBefore: true, actedAfter: false,
    refusalCodeBefore: null, refusalCodeAfter: `${kind.toUpperCase()}_DENIED`,
    measuredBefore: true, measuredAfter: true,
  };
}

/** شهادة كاملة على كل مسلك أعلنته التهيئة — نقصان مسلك خرقٌ بذاته */
function allClean(): ProbeEvidence[] {
  return policy.probes.map((kind) => clean(kind));
}

/** شهادة كاملة مع مسلك واحد مُبدَّل — لعزل الخرق المقصود */
function withProbe(item: ProbeEvidence): ProbeEvidence[] {
  return allClean().map((e) => (e.kind === item.kind ? item : e));
}

function goodObservation(over: Record<string, unknown> = {}) {
  return {
    liveCapabilities: 0, danglingLeases: 0, declaredStop: true, stopMs: 10,
    evidence: allClean(), ...over,
  } as never;
}

function judgeOne(over: Record<string, unknown> = {}, policyOver: Partial<typeof policy> = {}) {
  const { s, ledger } = fresh(policyOver);
  ledger.declareOrder([A], [A], WITNESS);
  ledger.observe(A, goodObservation(over));
  return { s, ledger, verdict: ledger.judgeAll() };
}

function breachCodes(verdict: { readonly breaches: readonly string[] }): string[] {
  return [...verdict.breaches];
}

// ═══ الطريق السليم ═══

test('إنهاء مُثبَت بالكامل يُنتج حكمًا سليمًا', () => {
  const { verdict } = judgeOne();
  assert.equal(verdict.passed, true);
  assert.equal(verdict.breaches.length, 0);
});

test('الدعوى تُسجَّل قبل الحكم — لا حكم على أمر غير معلن', () => {
  const { s } = judgeOne();
  assert.equal(countEvent(s, 'termination_order_declared'), 1);
  assert.equal(countEvent(s, 'termination_verdict'), 1);
});

test('الحكم يُسجَّل لكل كيان على حدة', () => {
  const { s, ledger } = fresh();
  ledger.declareOrder([A, B], [A, B], WITNESS);
  ledger.observe(A, goodObservation());
  ledger.observe(B, goodObservation());
  const verdict = ledger.judgeAll();
  assert.equal(verdict.verdicts.length, 2);
  assert.equal(countEvent(s, 'termination_judged'), 2);
  assert.equal(verdict.passed, true);
});

// ═══ رمز خرق لكل ثغرة ═══

test('ما زال يعمل بعد التوقف ⇒ TERM_ACTED_AFTER_STOP', () => {
  const acting: ProbeEvidence = { ...clean('tool'), actedAfter: true, refusalCodeAfter: null };
  const { verdict } = judgeOne({ evidence: withProbe(acting) });
  assert.equal(verdict.passed, false);
  assert.ok(breachCodes(verdict).includes('TERM_ACTED_AFTER_STOP'));
});

test('مسلك لم يعمل قبل الأمر ⇒ TERM_PRE_PROOF_MISSING', () => {
  const unproven: ProbeEvidence = { ...clean('tool'), actedBefore: false };
  const { verdict } = judgeOne({ evidence: withProbe(unproven) });
  assert.ok(breachCodes(verdict).includes('TERM_PRE_PROOF_MISSING'));
});

test('مسلك لم يُقَس بعد الأمر ⇒ TERM_PROBE_NOT_RUN — «لم يُجرَّب» ليس «رُفض»', () => {
  const unmeasured: ProbeEvidence = { ...clean('tool'), measuredAfter: false };
  const { verdict } = judgeOne({ evidence: withProbe(unmeasured) });
  assert.ok(breachCodes(verdict).includes('TERM_PROBE_NOT_RUN'));
});

test('كيان مستهدَف بلا أي قياس ⇒ TERM_STOP_UNPROVEN — الصمت ليس نجاحًا', () => {
  const { ledger } = fresh();
  ledger.declareOrder([A, B], [A, B], WITNESS);
  ledger.observe(A, goodObservation());
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.includes('TERM_STOP_UNPROVEN'));
  assert.equal(verdict.proven, 1);
});

test('مسلك مطلوب غائب عن الشهادة ⇒ TERM_PROBE_NOT_RUN', () => {
  const { verdict } = judgeOne({ evidence: allClean().filter((e) => e.kind !== 'capability') });
  assert.ok(breachCodes(verdict).includes('TERM_PROBE_NOT_RUN'));
});

test('رفض بلا رمز ⇒ TERM_REFUSAL_WITHOUT_CODE', () => {
  const codeless: ProbeEvidence = { ...clean('tool'), refusalCodeAfter: null };
  const { verdict } = judgeOne({ evidence: withProbe(codeless) });
  assert.ok(breachCodes(verdict).includes('TERM_REFUSAL_WITHOUT_CODE'));
});

test('قدرة حيّة بعد الإنهاء ⇒ TERM_LIVE_CAPABILITY', () => {
  const { verdict } = judgeOne({ liveCapabilities: 1 });
  assert.ok(breachCodes(verdict).includes('TERM_LIVE_CAPABILITY'));
});

test('إيجار معلَّق بعد الإنهاء ⇒ TERM_DANGLING_LEASE', () => {
  const { verdict } = judgeOne({ danglingLeases: 2 });
  assert.ok(breachCodes(verdict).includes('TERM_DANGLING_LEASE'));
});

test('توقف غير معلَن ⇒ TERM_STOP_UNDECLARED', () => {
  const { verdict } = judgeOne({ declaredStop: false });
  assert.ok(breachCodes(verdict).includes('TERM_STOP_UNDECLARED'));
});

test('تجاوز المهلة ⇒ TERM_DEADLINE_EXCEEDED', () => {
  const { verdict } = judgeOne({ stopMs: policy.stop_deadline_ms + 1 });
  assert.ok(breachCodes(verdict).includes('TERM_DEADLINE_EXCEEDED'));
});

test('المهلة عند حدّها تمرّ — الحدّ لا يُقاس بالمساواة الخاطئة', () => {
  const { verdict } = judgeOne({ stopMs: policy.stop_deadline_ms });
  assert.equal(verdict.passed, true);
});

test('كيان مُدّعى إيقافه ولم يُستهدف ⇒ TERM_CLAIMED_NOT_TARGETED', () => {
  const { s, ledger } = fresh();
  ledger.declareOrder([A], [A, 'agent:ghost'], WITNESS);
  ledger.observe(A, goodObservation());
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.includes('TERM_CLAIMED_NOT_TARGETED'));
  assert.equal(countEvent(s, 'termination_breach') >= 1, true);
});

test('توقف مُثبَت لم يدّعه المنفّذ ⇒ TERM_CLAIM_CONTRADICTS_EVIDENCE', () => {
  // المنفّذ استهدف كيانين وادّعى إيقاف واحد، والشهادة تُثبت توقف الاثنين.
  // الاختلاف لا يُبتلع لصالح المنفّذ ولو كان في مصلحته: يُعلن كما هو.
  const { ledger } = fresh();
  ledger.declareOrder([A, B], [A], WITNESS);
  ledger.observe(A, goodObservation());
  ledger.observe(B, goodObservation());
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.includes('TERM_CLAIM_CONTRADICTS_EVIDENCE'));
});

test('أمر بلا أهداف ⇒ TERM_ORDER_EMPTY', () => {
  const { ledger } = fresh();
  ledger.declareOrder([], [], WITNESS);
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.includes('TERM_ORDER_EMPTY'));
});

test('أمر فوق سقف النطاق ⇒ TERM_ORDER_OVER_CAPACITY', () => {
  const { ledger } = fresh();
  const many = Array.from({ length: policy.max_agents_per_order + 1 }, (_, i) => `agent:w-${i}`);
  ledger.declareOrder(many, many, WITNESS);
  const verdict = ledger.judgeAll();
  assert.ok(verdict.breaches.includes('TERM_ORDER_OVER_CAPACITY'));
});

test('منفّذ هو الشاهد ⇒ TERM_WITNESS_IS_EXECUTOR', () => {
  const { ledger } = fresh();
  ledger.declareOrder([A], [A], 'authority:crown_guard');
  ledger.observe(A, goodObservation());
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.includes('TERM_WITNESS_IS_EXECUTOR'));
});

test('أمر بلا شاهد معلن ⇒ TERM_WITNESS_MISSING', () => {
  const { ledger } = fresh();
  ledger.declareOrder([A], [A], '');
  ledger.observe(A, goodObservation());
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.includes('TERM_WITNESS_MISSING'));
});

test('شهادة فارغة على كيان ⇒ كل مسلك مطلوب يُعدّ غير مُجرَّب', () => {
  const { verdict } = judgeOne({ evidence: [] });
  assert.ok(breachCodes(verdict).includes('TERM_PROBE_NOT_RUN'));
  assert.equal(verdict.proven, 0);
});

// ═══ سلوك الحكم ═══

test('خرق واحد يُسقط الحكم كله ولو نجح باقي الكيانات (ثابت 3)', () => {
  const { ledger } = fresh();
  ledger.declareOrder([A, B], [A, B], WITNESS);
  ledger.observe(A, goodObservation());
  ledger.observe(B, goodObservation({ liveCapabilities: 1 }));
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.equal(verdict.verdicts.filter((e) => e.stopProven).length, 1);
});

test('الخرق يُصعَّد إلى الملك حين تأمر التهيئة بالتصعيد', () => {
  const { s } = judgeOne({ liveCapabilities: 1 });
  assert.equal(countEvent(s, 'escalated_to_king') >= 1, true);
});

test('كل خرق رمزٌ معلن بسابقة TERM_ — لا خرق بنص حرّ (ثابت 2)', () => {
  const { verdict } = judgeOne({ liveCapabilities: 3, danglingLeases: 2, declaredStop: false });
  const flat = verdict.verdicts.flatMap((e) => e.breaches);
  assert.ok(flat.length >= 3);
  for (const code of flat) {
    assert.equal(typeof code, 'string');
    assert.ok(code.startsWith('TERM_'), `الرمز ${code} خارج نطاق الرموز المعلنة`);
  }
});

test('الخروق لا تُكرَّر في الحكم الجامع — الرمز مرة واحدة', () => {
  const { ledger } = fresh();
  ledger.declareOrder([A, B], [A, B], WITNESS);
  ledger.observe(A, goodObservation({ liveCapabilities: 1 }));
  ledger.observe(B, goodObservation({ liveCapabilities: 1 }));
  const verdict = ledger.judgeAll();
  const live = verdict.breaches.filter((c) => c === 'TERM_LIVE_CAPABILITY');
  assert.equal(live.length, 1);
  assert.equal(verdict.proven, 0);
});

test('الحكم يحمل بصمة سجل — auditId يربط الحكم بالسجل الأبدي', () => {
  const { verdict } = judgeOne();
  assert.equal(typeof verdict.auditId, 'string');
  assert.ok(verdict.auditId.length > 0);
});

test('قياس كيان غير مستهدَف يُرفض ولا يُدَسّ في الدفتر', () => {
  const { s, ledger } = fresh();
  ledger.declareOrder([A], [A], WITNESS);
  assert.equal(ledger.observe('agent:outsider', goodObservation()), false);
  assert.equal(countEvent(s, 'termination_observation_refused'), 1);
});

test('القياس قبل إعلان الأمر يُرفض — لا دليل قبل دعوى', () => {
  const { ledger } = fresh();
  assert.equal(ledger.observe(A, goodObservation()), false);
});

test('الحكم يُسجّل عدد الخروق في سجل الحكم النهائي', () => {
  const { s } = judgeOne({ liveCapabilities: 1 });
  const detail = lastDetail(s, 'termination_verdict');
  assert.equal(detail.passed, false);
  assert.ok(Array.isArray(detail.breaches));
  assert.ok((detail.breaches as string[]).includes('TERM_LIVE_CAPABILITY'));
});

test('حكم كيان واحد عبر judge يوافق حكم judgeAll', () => {
  const { ledger } = fresh();
  ledger.declareOrder([A], [A], WITNESS);
  ledger.observe(A, goodObservation({ liveCapabilities: 1 }));
  const single = ledger.judge(A);
  assert.equal(single.stopProven, false);
  assert.equal(ledger.judgeAll().passed, false);
});
