/**
 * tests/production/production_lifecycle.test.ts — اختبار قبول المرحلة 37
 * شرط القبول في ROADMAP.md: «كل الأقاليم تعمل تحت مرور التاج مع مراقبة مستمرة»
 * معايير القياس المعلنة (لا يُقبل غيرها):
 *   1) زمنٌ حقيقي لا مُمرَّر — يُنتظر بمؤقّت فعلًا
 *   2) حادثٌ يُزرع **بعد** بدء القياس ويُكشف **بلا نداء يدوي**
 *   3) محاولة تجاوز حقيقية لمرور التاج تُرفض وتُقيَّد بالرمز
 *   4) كل إقليم **يعمل** فعلًا — لا يكفي أن يكون قائمًا
 *   5) المسار هو المسار المعلن — كتبٌ مُعلنة في `deploy/production/` تُبنى وتُنفَّذ
 *   6) حكم `passed: true` من ديوان التدقيق على تشغيلٍ دائم
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-37.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BYPASS_ACTION, FEDERATED_ACTION, PROD_REGION_NOT_ACTING, PROD_PASSAGE_UNPROVEN,
} from '../../src/index';
import { productionHarness, OPERATOR, OBSERVER, countEvent, lastDetail, sleep } from './helpers';

test('قبول 37: تشغيل اتحادي دائم — أقاليم تعمل تحت المرور ومراقبة تكشف حادثًا بلا نداء', async () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    // (5) المسار المعلن: الكتب من `deploy/production/` لا من ترتيب يدوي
    assert.deepEqual(h.books.map((b) => b.name), [...h.policy.runbooks]);

    const started = h.operation.begin(OPERATOR, h.books, 'قياس قبول التشغيل الاتحادي', now);
    assert.equal(started.ok, true, `كل الكتب نجحت: ${started.runbooks.flatMap((r) => r.failures).join(' | ')}`);
    assert.equal(started.runbooks.length, h.policy.runbooks.length);

    // (3) محاولة تجاوز حقيقية رُفضت وقُيِّدت — دليل الإنفاذ لا وصفه
    const blocked = h.passage.blockedAttempts();
    assert.ok(blocked.some((b) => b.action === BYPASS_ACTION), 'محاولة التجاوز مقيَّدة');
    assert.ok(countEvent(h.state, 'region_action_bypass_blocked') >= 1);

    // (4) كل إقليم مشترط عمل فعلًا ومرّ بالتاج
    const evidence = h.operation.regionEvidence();
    assert.equal(evidence.length, h.policy.regions.required.length);
    for (const region of evidence) {
      assert.equal(region.active, true, `${region.regionId} قائم`);
      assert.notEqual(region.governor, null, `${region.regionId} له حاكم`);
      assert.ok(region.actionsExecuted >= 1, `${region.regionId} نفّذ فعلًا`);
      assert.ok(region.actionsPassed >= 1, `${region.regionId} استوفى إذن المرور`);
    }

    // (2) حادثٌ يُزرع بعد بدء القياس: أمرٌ يُدرَج ولا يُثبت مصيره
    assert.equal(h.state.loadLedger.declare('cmd:acceptance-37'), true);
    const sweepsBefore = h.supervisor.report().sweeps;

    // (1) زمنٌ حقيقي: يُنتظر ما يكفي لمهلة الأمر ولأربع مسحات على الأقل
    const need = h.policy.loads.pending_max_ms + h.policy.supervision.tick_ms * (h.policy.supervision.min_sweeps + 2);
    await sleep(need);

    const report = h.supervisor.report();
    assert.ok(report.sweeps > sweepsBefore, 'المسح جرى بنفسه بلا نداء');
    assert.ok(report.sweeps >= h.policy.supervision.min_sweeps, `مسحات: ${report.sweeps}`);
    assert.equal(report.running, true, 'المراقبة لم تتوقف من نفسها');
    assert.ok(
      report.incidents.some((i) => i.kind === 'command_loss_over_limit'),
      'الحادث المزروع كُشف بلا نداء يدوي',
    );
    assert.equal(report.critical, 0, 'لا حادث حرج في مسار القبول');
    // كل ماسح معلن جرى فعلًا — لا حرسَ يُوهم بالتغطية
    for (const scanner of h.policy.scanners) {
      assert.ok((report.scannerSweeps[scanner] ?? 0) >= 1, `الماسح ${scanner} جرى`);
    }

    // (6) الحكم من ديوان التدقيق لا من المشغّل
    const verdict = h.operation.judge();
    assert.deepEqual(verdict.breaches, [], `خروق: ${verdict.breaches.join(', ')}`);
    assert.equal(verdict.passed, true);
    assert.equal(verdict.regionsOperating, h.policy.regions.required.length);
    assert.ok(verdict.blockedBypasses >= h.policy.tolerance.min_bypass_proof);
    assert.deepEqual([...verdict.runbooksExecuted].sort(), [...h.policy.runbooks].sort());
    assert.equal(lastDetail(h.state, 'production_verdict').passed, true);
    assert.equal(h.state.audit.find('production_verdict').at(-1)?.actor, OBSERVER);
    assert.equal(h.state.audit.verifyIntegrity().valid, true);
  } finally {
    h.dispose();
  }
});

test('قبول 37: الفعل الإقليمي المُعتمد نفَذ بإذن، ومحاولة بلا إذن لم تنفُذ', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    h.operation.begin(OPERATOR, h.books, 'قياس الإنفاذ', now);
    const executed = h.state.audit.find('region_action_executed');
    assert.ok(executed.length >= h.policy.regions.required.length);
    assert.ok(
      executed.every((e) => (e.detail as { action?: string }).action !== BYPASS_ACTION),
      'الفعل بلا إذن لم يُنفَّذ',
    );
    assert.ok(
      executed.some((e) => (e.detail as { action?: string }).action === FEDERATED_ACTION),
      'الفعل المُعتمد نفَذ',
    );
  } finally {
    h.dispose();
  }
});

test('قبول 37: تشغيلٌ بلا اتحاد قائم يُحكم عليه بالسقوط لا بالسكوت', () => {
  const now = Date.now();
  const h = productionHarness({ now, federate: false });
  try {
    const verdict = h.operation.judge();
    assert.equal(verdict.passed, false);
    assert.ok(verdict.breaches.includes(PROD_REGION_NOT_ACTING) || verdict.breaches.length > 0);
    assert.ok(verdict.breaches.includes(PROD_PASSAGE_UNPROVEN), 'لا دليل إنفاذ بلا محاولة مرفوضة');
    assert.equal(verdict.regionsOperating, 0);
  } finally {
    h.dispose();
  }
});
