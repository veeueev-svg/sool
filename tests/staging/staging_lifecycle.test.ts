/**
 * tests/staging/staging_lifecycle.test.ts — قبول المرحلة 36 (شرط ROADMAP.md)
 * «تشغيل مقيَّد لمدة مراقبة كاملة بلا حادث حرج»
 * المالك: ديوان التدقيق | المدخلات: دولة مهيأة + بيان النشر + كتب التشغيل المعلنة
 * المخرجات: حكمٌ واحد على نافذة مقيسة بزمن حقيقي، وإثبات أن الخرق يُسقطها
 * التبعيات: StagingRun (النطاق + المنفّذ + المراقب + الدفتر) | الصلاحيات: القياس فقط
 * السجلات: staging_run_started / staging_run_finished / staging_verdict
 * حالات الفشل: كلها مغلقة | الوثيقة: docs/runbooks/limited-operation.md
 * ثوابت الاختبار:
 *   1) **الزمن حقيقي**: النافذة تُنتظر فعلًا بمؤقّت، ولا يُمرّر زمنٌ موهوم — وإلّا كان
 *      شرط «مدة مراقبة كاملة» دعوى لا قياسًا.
 *   2) **المسار هو المسار المعلن**: `StagingRun` هو ما يُشغّل، لا نداءٌ يدوي مرتّب في الاختبار.
 *   3) **الحكم من الدفتر لا من المشغّل**: ولا يُقاس النجاح بعدم رمي استثناء.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SovereignViolation, bootstrapState } from '../../src/index';
import { OBSERVER, OPERATOR, countEvent, lastDetail, stagingHarness } from './helpers';

test('قبول: تشغيل مقيَّد لمدة مراقبة كاملة بلا حادث حرج يمرّ بحكم الدفتر', async () => {
  const h = stagingHarness();
  const policy = h.policy;
  const startedAt = Date.now();
  const verdict = await h.run.run(OPERATOR, h.books, 'قبول المرحلة 36: تشغيل محدود مراقَب');
  const elapsed = Date.now() - startedAt;

  // (1) النافذة استُنفدت زمنًا حقيقيًّا لا مُمرَّرًا
  assert.equal(elapsed >= policy.window.duration_ms, true, `الزمن المنقضي ${elapsed}`);
  assert.equal(verdict.durationMs >= policy.window.duration_ms, true);
  assert.equal(verdict.requiredMs, policy.window.duration_ms);

  // (2) المراقبة وقعت بلا يد بشرية: مسحات فوق الحد وكل حرس معلن مسح فعلًا
  assert.equal(verdict.ticks >= policy.window.min_ticks, true, `عدد المسحات ${verdict.ticks}`);
  const report = h.monitor.report();
  for (const watch of policy.watches) {
    assert.equal((report.watchTicks[watch] ?? 0) >= 1, true, `الحرس ${watch} لم يمسح`);
  }
  assert.equal(report.failedTicks, 0);
  assert.equal(h.monitor.running, false);

  // (3) بلا حادث حرج — شرط القبول حرفيًّا
  assert.equal(verdict.criticalIncidents, 0);
  assert.equal(h.state.killSwitch.status.engaged, false);

  // (4) الكتب نُفّذت لا قُرئت، والنطاق فُتح وأُغلق
  assert.deepEqual([...verdict.runbooksExecuted].sort(), [...policy.runbooks].sort());
  assert.equal(countEvent(h.state, 'scope_opened'), 1);
  assert.equal(countEvent(h.state, 'scope_closed'), 1);
  assert.equal(h.scope.active, false);

  // (5) الحكم واحد ومقيَّد، وأصدره المراقب لا المشغّل
  assert.equal(verdict.passed, true, verdict.breaches.join(' | '));
  assert.deepEqual(verdict.breaches, []);
  assert.equal(verdict.escalated, false);
  assert.equal(h.state.audit.find('staging_verdict').at(-1)?.actor, OBSERVER);
  assert.equal(lastDetail(h.state, 'staging_run_finished').passed, true);
  assert.equal(h.state.audit.verifyIntegrity().valid, true);
});

test('خرق النطاق أثناء النافذة: حادث حرج يوقف الدولة ويُسقط حكم النافذة', async () => {
  const h = stagingHarness();
  const forbidden = h.policy.scope.forbidden_actions[0]!;
  // خرقٌ يقع من داخل النافذة: أمرٌ ملكي صحيح لفعل ممنوع يُرفض عند بوابة التاج
  setTimeout(() => {
    const cmd = h.state.king.issueCommand(forbidden, 'policy:probe', { kind: 'federation' });
    h.state.gateway.authorize(cmd, Date.now());
  }, Math.max(1, Math.floor(h.policy.window.duration_ms / 4)));

  const verdict = await h.run.run(OPERATOR, h.books, 'قياس: خرق نطاق داخل النافذة');
  assert.equal(verdict.passed, false);
  assert.equal(verdict.criticalIncidents >= 1, true);
  assert.equal(h.scope.violations().length, 1);
  assert.equal(h.state.killSwitch.status.engaged, true);
  assert.equal(countEvent(h.state, 'staging_critical_halt'), 1);
  assert.equal(verdict.breaches.includes('STAGE_CRITICAL_INCIDENT'), true);
  assert.equal(verdict.breaches.includes('STAGE_STATE_HALTED'), true);
  assert.equal(verdict.escalated, true);
});

test('الرفض قبل أي أثر: مشغّل غير معلن ودولة موقوفة وتشغيلة مستهلكة', async () => {
  const h = stagingHarness();
  await assert.rejects(() => h.run.run('agent:001', h.books, 'محاولة'), (error: unknown) => {
    assert.equal((error as SovereignViolation).code, 'STAGERUN_OPERATOR_UNDECLARED');
    return true;
  });
  await assert.rejects(() => h.run.run(OBSERVER, h.books, 'محاولة'), (error: unknown) => {
    assert.equal((error as SovereignViolation).code, 'STAGERUN_OPERATOR_UNDECLARED');
    return true;
  });
  // لا نطاق فُتح ولا مؤقّت عمل ولا كتاب نُفّذ — الرفض قبل الأثر
  assert.equal(h.scope.active, false);
  assert.equal(h.monitor.running, false);
  assert.equal(h.runner.passed().length, 0);
  assert.equal(countEvent(h.state, 'staging_run_refused') >= 2, true);

  const halted = stagingHarness();
  halted.state.killSwitch.engage(halted.state.king.kingId, 'all', 'قياس: إيقاف قائم قبل النافذة');
  await assert.rejects(() => halted.run.run(OPERATOR, halted.books, 'محاولة'), (error: unknown) => {
    assert.equal((error as SovereignViolation).code, 'STAGERUN_STATE_HALTED');
    return true;
  });

  const missing = stagingHarness();
  await assert.rejects(
    () => missing.run.run(OPERATOR, missing.books.slice(1), 'محاولة'),
    (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'STAGERUN_RUNBOOK_MISSING');
      return true;
    },
  );
});

test('التأسيس يبقى مختومًا بسجل state_online وحده، ورقم المرحلة 36 بعد التشغيل المحدود', () => {
  const s = bootstrapState({ now: Date.now() });
  const online = s.audit.find('state_online');
  assert.equal(online.length, 1);
  assert.equal((online[0]?.detail as { phase: number }).phase, 36);
  // النطاق مربوط بالبوابة ومغلق، والمراقب مبني ولا يعمل: من يفتح النافذة يبدأ المؤقّت
  assert.equal(s.operationScope.active, false);
  assert.equal(s.incidentMonitor.running, false);
  assert.equal(s.stagingManifest.observer, s.stagingConfig.policy.observer_authority);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
