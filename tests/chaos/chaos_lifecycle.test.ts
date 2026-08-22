/**
 * tests/chaos/chaos_lifecycle.test.ts — اختبار قبول المرحلة 34
 * المالك: ديوان التدقيق
 * شرط القبول في خارطة الطريق: «انقطاع الشبكة والهوية والطاقة ⇒ توقف آمن موثّق»،
 * والبند T-93 يزيد: «لا أمر نصف منفّذ، ولا إيجار معلق، وسلسلة تدقيق سليمة بعد كل قطع»،
 * والبند T-90 يزيد قطع القرص: «توقف معلن لا حالة مجهولة».
 * هذا الملف يثبت الشرط بمقاعد حقيقية: إذن خروج يُلغى، وشهادة ملك تُبطل، وقناة تُفقد
 * وتُبنى من القرص، ومسار لقطة يُستحال الكتابة عليه. لا علم بولياني يتظاهر بالقطع.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROBE_HOST, PROBE_PORT, T0, allProbes, chaosHarness, countEvent, hasEvent, lastDetail,
} from './helpers';

test('القبول: القطوع الأربعة تُنتج توقفًا آمنًا موثّقًا، والحكم الجامع pass', () => {
  const h = chaosHarness();
  const { victims, probes } = allProbes();
  for (const probe of probes) {
    assert.equal(h.drill.registerProbe(h.authority, probe).ok, true, `تسجيل مِجَسّ ${probe.kind}`);
  }

  const outcome = h.drill.run(h.authority, T0);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const report = outcome.report;

  // 1) الحكم الجامع على كل قطع معلن في التهيئة، لا على ما قِيس فقط
  assert.equal(report.declared, h.policy.faults.length);
  assert.equal(report.observed, h.policy.faults.length);
  assert.deepEqual([...report.breaches], [], 'لا خرق في أي قطع');
  assert.equal(report.verdict, 'pass');

  // 2) شرط القبول لكل قطع على حِدة: أربعة شروط مجتمعة لا واحد منها
  for (const cut of report.cuts) {
    const o = cut.observation;
    assert.ok(o, `قياس مفقود للقطع ${cut.kind}`);
    if (!o) continue;
    assert.equal(o.proceeded, false, `${cut.kind}: لم يمضِ فعل سيادي تحت القطع`);
    assert.ok(o.refusalCode, `${cut.kind}: الرفض حمل رمزًا معلنًا`);
    assert.equal(o.effects.halfExecuted, 0, `${cut.kind}: لا أمر نصف منفّذ`);
    assert.deepEqual([...o.effects.doubleExecuted], [], `${cut.kind}: لا تنفيذ مزدوج`);
    assert.equal(o.effects.sound, true, `${cut.kind}: الأثر مطابق للمصير`);
    assert.equal(o.danglingLeases, 0, `${cut.kind}: لا إيجار معلَّق`);
    assert.equal(o.auditIntact, true, `${cut.kind}: سلسلة تدقيق سليمة`);
    assert.equal(o.declaredStop, true, `${cut.kind}: التوقف أُعلن`);
    assert.equal(o.modeAfter, h.policy.fallback_mode, `${cut.kind}: الوضع المعلن هو المشترط`);
    assert.equal(o.restored, true, `${cut.kind}: العودة بإثبات`);
    assert.ok(o.stopMs <= h.policy.safe_stop_deadline_ms, `${cut.kind}: التوقف داخل المهلة`);
    assert.equal(cut.verdict, 'pass');
  }

  // 3) القطوع الثلاثة المشترطة في خارطة الطريق حاضرة بأسمائها، ومعها القرص
  const kinds = report.cuts.map((c) => c.kind);
  for (const required of ['network', 'identity', 'power', 'disk']) {
    assert.ok(kinds.includes(required as typeof kinds[number]), `القطع ${required} مُقاس`);
  }

  // 4) لا قطعان في وقت واحد: الحاقن أعاد كل قطع قبل التالي
  assert.deepEqual([...h.injector.activeFaults()], []);
  assert.equal(countEvent(h.s, 'fault_injected'), 4);
  assert.equal(countEvent(h.s, 'fault_restored'), 4);

  // 5) التمرين موثَّق في سجل الجهة التي تُديره، وسلسلتها سليمة بعده
  assert.equal(countEvent(h.s, 'chaos_cut_measured'), 4);
  assert.equal(lastDetail(h.s, 'chaos_drill_report').verdict, 'pass');
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
  assert.equal(hasEvent(h.s, 'safe_stop_breach'), false);
  assert.equal(hasEvent(h.s, 'escalated_to_king'), false);

  // 6) كل ضحيّة أعلنت توقفها في سجلها هي، لا في سجل من يقيسها
  for (const victim of Object.values(victims)) {
    assert.equal(victim.s.audit.verifyIntegrity().valid, true);
  }
});

test('القبول: كل قطع يغيّر السلوك فعلًا — قبله يمضي وبعده يُرفض', () => {
  // قطعٌ لا يُبدّل نتيجة الفعل ليس قطعًا. هذا الاختبار يُثبت أن المقاعد حقيقية.
  const h = chaosHarness();
  const { victims, probes, guard } = allProbes();

  // الشبكة: قبل القطع الخروج مسموح
  const before = victims.network!.s.audit.find('egress_allowed').length;
  assert.equal(guard.request('agent:network', { host: PROBE_HOST, port: PROBE_PORT }, T0).allowed, true);
  assert.equal(victims.network!.s.audit.find('egress_allowed').length, before + 1);

  // الهوية: قبل القطع البوابة تعتمد
  assert.equal(victims.identity!.s.gateway.authorize(victims.identity!.issue(), T0).allowed, true);

  for (const probe of probes) h.drill.registerProbe(h.authority, probe);
  const outcome = h.drill.run(h.authority, T0);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.report.verdict, 'pass');

  // بعد القطع (وقبل العودة) كان الرفض هو النتيجة، وقد سُجِّل برمزه
  assert.equal(
    outcome.report.cuts.find((c) => c.kind === 'network')!.observation!.refusalCode,
    'unannounced_egress_attempt',
  );
  assert.equal(
    outcome.report.cuts.find((c) => c.kind === 'identity')!.observation!.refusalCode,
    'command_channel_denied',
  );
});

test('القبول: حذف طور من التمرين يُفشِله ولا يُقصِّره', () => {
  // الحكم على ما أعلنته التهيئة لا على ما قِيس: مِجَسّ ناقص ⇒ CHAOS_CUT_NOT_OBSERVED
  const h = chaosHarness();
  const { probes } = allProbes();
  for (const probe of probes.filter((p) => p.kind !== 'disk')) {
    h.drill.registerProbe(h.authority, probe);
  }
  const outcome = h.drill.run(h.authority, T0);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.report.verdict, 'fail');
  assert.equal(outcome.report.observed, 3);
  assert.equal(outcome.report.declared, 4);
  assert.ok(outcome.report.breaches.includes('disk:CHAOS_CUT_NOT_OBSERVED'));
  assert.equal(hasEvent(h.s, 'safe_stop_breach'), true);
  assert.equal(hasEvent(h.s, 'escalated_to_king'), true, 'الخرق يُصعَّد كما توجب التهيئة');
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});
