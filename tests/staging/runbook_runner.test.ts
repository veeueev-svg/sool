/**
 * tests/staging/runbook_runner.test.ts — الكتاب يُنفَّذ لا يُقرأ (المرحلة 36)
 * المالك: ديوان التدقيق | المدخلات: كتب معلنة في deploy/staging/runbooks + وحدات الدولة
 * المخرجات: إثبات أن خطوة لم يُثبَت أثرها تُفشل الكتاب ولو نُودي فعلها
 * التبعيات: RunbookRunner + buildDeclaredRunbooks + loadDeclaredRunbook
 * الصلاحيات: القياس فقط | السجلات: runbook_started / runbook_step / runbook_step_failed /
 *   runbook_completed / runbook_refused
 * حالات الفشل: كلها مغلقة برموز وأحداث معلنة
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts | الوثيقة: docs/runbooks/README.md
 * ثوابت الاختبار: 1) الفشل يُقرأ من حدثه لا من نصه؛ 2) الكتب المقيسة هي كتب المستودع
 *   المعلنة لا كتبًا تُخترع في الاختبار؛ 3) نجاح الفعل لا يُغني عن التحقّق.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Runbook, RunbookRunner, SovereignViolation, buildRunbook, loadDeclaredRunbook, resolveDeployDir,
} from '../../src/index';
import { OPERATOR, countEvent, lastDetail, stagingHarness } from './helpers';

const NOT_OPERATOR = 'agent:001';

function book(name: string, steps: Runbook['steps']): Runbook {
  return { name, purpose: 'كتاب قياس', steps };
}

test('كل كتاب معلن في التهيئة له ملف خطوات، ولكل خطوة ربطٌ تنفيذي', () => {
  const h = stagingHarness();
  assert.equal(h.books.length, h.policy.runbooks.length);
  for (const built of h.books) {
    const declared = loadDeclaredRunbook(built.name, resolveDeployDir());
    assert.equal(built.steps.length, declared.steps.length);
    for (const step of built.steps) {
      assert.equal(typeof step.act, 'function');
      assert.equal(typeof step.verify, 'function');
    }
  }
});

test('خطوة معلنة بلا ربط تنفيذي تُرفض برمزها — «افعل» بلا فعل', () => {
  const h = stagingHarness();
  const declared = loadDeclaredRunbook('limited-operation', resolveDeployDir());
  const withGhost = {
    ...declared,
    steps: [...declared.steps, { n: declared.steps.length + 1, title: 'خطوة موصوفة بلا تنفيذ', expect: 'لا شيء' }],
  };
  assert.throws(() => buildRunbook(withGhost, {
    audit: h.state.audit, killSwitch: h.state.killSwitch, terminationRoll: h.state.terminationRoll,
    permissions: h.state.permissions, regionMonitor: h.state.regionMonitor,
    heartbeat: h.state.heartbeat, scope: h.scope, kingId: h.state.king.kingId, operator: OPERATOR,
    modeAt: () => 'normal',
  }), (error: unknown) => {
    assert.equal((error as SovereignViolation).code, 'RUNBOOK_STEP_UNBOUND');
    return true;
  });
});

test('التنفيذ لجهة مشغّلة معلنة وحدها، والكتاب غير المعلن يُرفض (RULE-004)', () => {
  const h = stagingHarness();
  const first = h.books[0]!;
  const refusedByActor = h.runner.execute(NOT_OPERATOR, first, Date.now());
  assert.equal(refusedByActor.passed, false);
  const unknown = h.runner.execute(OPERATOR, book('how-to-win', [
    { n: 1, title: 'خطوة', act: () => {}, verify: () => true },
  ]), Date.now());
  assert.equal(unknown.passed, false);
  assert.equal(countEvent(h.state, 'runbook_refused'), 2);
});

test('كتاب بلا خطوات يُرفض، وتنفيذه مرتين يُرفض — لا يُخفي ثانٍ فشل الأول', () => {
  const h = stagingHarness();
  const empty = h.runner.execute(OPERATOR, book('limited-operation', []), Date.now());
  assert.equal(empty.passed, false);
  const first = h.books[0]!;
  assert.equal(h.runner.execute(OPERATOR, first, Date.now()).passed, true);
  const again = h.runner.execute(OPERATOR, first, Date.now());
  assert.equal(again.passed, false);
  assert.equal(again.failures.length, 1);
});

test('نجاح الفعل لا يُغني عن التحقّق: تحقّقٌ سلبي يُفشل الخطوة ويقطع ما بعدها', () => {
  const h = stagingHarness();
  let third = false;
  const result = h.runner.execute(OPERATOR, book('limited-operation', [
    { n: 1, title: 'خطوة تمرّ', act: () => {}, verify: () => true },
    { n: 2, title: 'فعلٌ نُودي وأثرٌ لم يُثبَت', act: () => {}, verify: () => false },
    { n: 3, title: 'خطوة لا يجوز أن تُنفَّذ', act: () => { third = true; }, verify: () => true },
  ]), Date.now());
  assert.equal(result.passed, false);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1]?.acted, true);
  assert.equal(result.steps[1]?.verified, false);
  assert.equal(third, false);
  assert.equal(countEvent(h.state, 'runbook_step_failed'), 1);
  assert.equal(lastDetail(h.state, 'runbook_completed').passed, false);
});

test('الفعل الذي يرمي والتحقّق الذي ينهار كلاهما فشلٌ مقيَّد لا نجاح', () => {
  const h = stagingHarness();
  const threw = h.runner.execute(OPERATOR, book('limited-operation', [
    { n: 1, title: 'فعل ينهار', act: () => { throw new Error('انهار الفعل'); }, verify: () => true },
  ]), Date.now());
  assert.equal(threw.passed, false);
  assert.equal(threw.steps[0]?.acted, false);
  const runner2 = new RunbookRunner({ audit: h.state.audit, policy: h.policy });
  const broke = runner2.execute(OPERATOR, book('incident-response', [
    { n: 1, title: 'تحقّق ينهار', act: () => {}, verify: () => { throw new Error('انهار التحقّق'); } },
  ]), Date.now());
  assert.equal(broke.passed, false);
  assert.equal(broke.steps[0]?.acted, true);
  assert.equal(broke.steps[0]?.verified, false);
});

test('كتب المستودع المعلنة تُنفَّذ كلها بنجاح على دولة سليمة، والمنفّذ يعدّ الناجح وحده', () => {
  const h = stagingHarness();
  for (const built of h.books) {
    const result = h.runner.execute(OPERATOR, built, Date.now());
    assert.equal(result.passed, true, `${built.name}: ${result.failures.join(' | ')}`);
    assert.equal(result.steps.every((s) => s.verified), true);
  }
  assert.deepEqual([...h.runner.passed()].sort(), [...h.policy.runbooks].sort());
  assert.equal(countEvent(h.state, 'runbook_started'), h.books.length);
});
