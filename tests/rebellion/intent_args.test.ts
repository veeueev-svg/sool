/**
 * tests/rebellion/intent_args.test.ts — حاجزُ النية على مستوى المعاملات (المرحلة 39، T-31)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: خطواتٌ معلنةٌ بقيودِ معاملات + نداءاتٌ مطابقةٌ ومنحرفة
 * المخرجات: قبولٌ أو رفضٌ برمزه، وتعليقُ المنحرف عبر وحدةِ الكشف
 * التبعيات: normalizePlan · matchStep · bootstrapState().deception
 * حالات الفشل: تُقرأ برمزها (`ARG_*` · `PLAN_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 * ثابتُ هذا الملف: **اسمُ الأداةِ وحده = صفرُ معاملاتٍ مباحة** — والاختصارُ تضييقٌ لا توسيع.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, loadIntent, matchStep, normalizePlan, stepOf, argFingerprint,
} from '../../src/index';

const LIMITS = loadIntent().limits;

function withAgent() {
  const s = bootstrapState();
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), {
    blueprintId: 'worker', template: 'limited_worker', maxInstances: 5, generation: 1,
    purpose: 'عمل محدود',
  });
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count: 1, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  const id = res.ok ? res.created[0]! : '';
  s.agents.start(id, 'ministry:interior');
  return { s, id };
}

function normalized(declaration: readonly unknown[]) {
  return normalizePlan(declaration as never, LIMITS);
}

test('اسمُ الأداةِ وحده يُقرأ خطوةً بصفرِ معاملاتٍ مباحة', () => {
  const plan = normalized(['calc']);
  assert.equal(plan.ok, true);
  const step = plan.ok ? plan.steps[0]! : stepOf('x');
  assert.equal(step.tool, 'calc');
  assert.equal(Object.keys(step.args).length, 0);
  assert.equal(matchStep(step, {}).allowed, true);
  const withArg = matchStep(step, { path: '/etc/passwd' });
  assert.equal(withArg.allowed, false);
  assert.equal(withArg.allowed === false && withArg.code, 'ARG_UNDECLARED');
});

test('قيدُ القيمِ المحصورة: المعلنةُ تُقبل وغيرُها تُرفض برمزها', () => {
  const plan = normalized([{ tool: 'write', args: { path: { kind: 'exact', values: ['/tmp/a'] } } }]);
  assert.equal(plan.ok, true);
  const step = plan.ok ? plan.steps[0]! : stepOf('x');
  assert.equal(matchStep(step, { path: '/tmp/a' }).allowed, true);
  const bad = matchStep(step, { path: '/etc/shadow' });
  assert.equal(bad.allowed === false && bad.code, 'ARG_VALUE_NOT_DECLARED');
  assert.equal(bad.allowed === false && bad.arg, 'path');
});

test('قيدُ المدى: داخلُه مقبولٌ وخارجُه مرفوضٌ وغيرُ الرقمِ نوعٌ مخالف', () => {
  const plan = normalized([{ tool: 'calc', args: { a: { kind: 'range', min: 0, max: 10 } } }]);
  const step = plan.ok ? plan.steps[0]! : stepOf('x');
  assert.equal(matchStep(step, { a: 0 }).allowed, true);
  assert.equal(matchStep(step, { a: 10 }).allowed, true);
  const over = matchStep(step, { a: 11 });
  assert.equal(over.allowed === false && over.code, 'ARG_OUT_OF_RANGE');
  const wrong = matchStep(step, { a: 'كثير' });
  assert.equal(wrong.allowed === false && wrong.code, 'ARG_TYPE_MISMATCH');
});

test('قيدُ السابقة: ما بدأ بها يُقبل وما خرج عنها يُرفض', () => {
  const plan = normalized([{ tool: 'write', args: { path: { kind: 'prefix', prefix: '/tmp/' } } }]);
  const step = plan.ok ? plan.steps[0]! : stepOf('x');
  assert.equal(matchStep(step, { path: '/tmp/x/y' }).allowed, true);
  const escape = matchStep(step, { path: '/var/log' });
  assert.equal(escape.allowed === false && escape.code, 'ARG_PREFIX_MISMATCH');
  const wrongType = matchStep(step, { path: 7 });
  assert.equal(wrongType.allowed === false && wrongType.code, 'ARG_TYPE_MISMATCH');
});

test('خطةٌ فارغةٌ أو خطوةٌ بلا أداةٍ تُرفض برمزها', () => {
  const empty = normalized([]);
  assert.equal(empty.ok === false && empty.rejection.code, 'PLAN_EMPTY');
  const nameless = normalized([{ args: {} }]);
  assert.equal(nameless.ok === false && nameless.rejection.code, 'PLAN_CONSTRAINT_INVALID');
  const blank = normalized(['   ']);
  assert.equal(blank.ok === false && blank.rejection.code, 'PLAN_CONSTRAINT_INVALID');
});

test('حدودُ الخطة من التهيئة تُسقط الخطةَ المنتفخة — لا حدَّ نائم', () => {
  const tooManySteps = normalized(
    Array.from({ length: LIMITS.maxStepsPerPlan + 1 }, (_, i) => `t${i}`),
  );
  assert.equal(tooManySteps.ok === false && tooManySteps.rejection.code, 'PLAN_STEP_LIMIT');

  const args: Record<string, unknown> = {};
  for (let i = 0; i <= LIMITS.maxArgsPerStep; i += 1) {
    args[`a${i}`] = { kind: 'exact', values: ['x'] };
  }
  const tooManyArgs = normalized([{ tool: 'calc', args }]);
  assert.equal(tooManyArgs.ok === false && tooManyArgs.rejection.code, 'PLAN_ARG_LIMIT');

  const values = Array.from({ length: LIMITS.maxValuesPerArg + 1 }, (_, i) => `v${i}`);
  const tooManyValues = normalized([{ tool: 'calc', args: { a: { kind: 'exact', values } } }]);
  assert.equal(tooManyValues.ok === false && tooManyValues.rejection.code, 'PLAN_VALUE_LIMIT');

  const long = 'x'.repeat(LIMITS.maxValueChars + 1);
  const tooLong = normalized([{ tool: 'calc', args: { a: { kind: 'exact', values: [long] } } }]);
  assert.equal(tooLong.ok === false && tooLong.rejection.code, 'PLAN_VALUE_LIMIT');
});

test('قيدٌ معطوبٌ يُرفض: قيمٌ فارغةٌ ومدًى مقلوبٌ وسابقةٌ فارغةٌ ونوعٌ غيرُ معلن', () => {
  const noValues = normalized([{ tool: 'c', args: { a: { kind: 'exact', values: [] } } }]);
  assert.equal(noValues.ok === false && noValues.rejection.code, 'PLAN_CONSTRAINT_INVALID');
  const flipped = normalized([{ tool: 'c', args: { a: { kind: 'range', min: 9, max: 1 } } }]);
  assert.equal(flipped.ok === false && flipped.rejection.code, 'PLAN_CONSTRAINT_INVALID');
  const emptyPrefix = normalized([{ tool: 'c', args: { a: { kind: 'prefix', prefix: '' } } }]);
  assert.equal(emptyPrefix.ok === false && emptyPrefix.rejection.code, 'PLAN_CONSTRAINT_INVALID');
  const unknown = normalized([{ tool: 'c', args: { a: { kind: 'regex', pattern: '.*' } } }]);
  assert.equal(unknown.ok === false && unknown.rejection.code, 'PLAN_CONSTRAINT_INVALID');
});

test('قيمةٌ ليست نصًّا ولا رقمًا ولا منطقًا تُرفض نوعًا', () => {
  const plan = normalized([{ tool: 'c', args: { a: { kind: 'exact', values: ['x'] } } }]);
  const step = plan.ok ? plan.steps[0]! : stepOf('c');
  const objectArg = matchStep(step, { a: { nested: true } as never });
  assert.equal(objectArg.allowed === false && objectArg.code, 'ARG_TYPE_MISMATCH');
});

test('بصمةُ المعاملاتِ مرتَّبةٌ فلا يُخفي ترتيبُ الحقولِ موعدًا', () => {
  assert.equal(argFingerprint({ b: 2, a: 1 }), argFingerprint({ a: 1, b: 2 }));
  assert.equal(argFingerprint({ a: 1, b: 2 }), 'a=1&b=2');
  assert.equal(argFingerprint({}), '');
});

test('وحدةُ الكشف تقبل النداءَ المطابقَ لقيودِ الخطة', () => {
  const { s, id } = withAgent();
  assert.equal(
    s.deception.declarePlan(id, [{ tool: 'compute', args: { n: { kind: 'range', min: 1, max: 4 } } }]),
    true,
  );
  assert.equal(s.deception.observe(id, 'compute', { n: 2 }).allowed, true);
  assert.equal(s.deception.verdict(id).deceptive, false);
  assert.equal(s.agents.get(id)?.status, 'running');
});

test('معاملٌ لم يُعلَن انحرافُ نيةٍ يُعلَّق به الوكيلُ ويُصعَّد', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, ['compute']);
  const verdict = s.deception.observe(id, 'compute', { path: '/etc/shadow' });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /ARG_UNDECLARED/);
  assert.equal(s.deception.verdict(id).deceptive, true);
  assert.equal(s.agents.get(id)?.status, 'suspended');
  assert.equal(s.audit.find('intent_argument_divergence').length, 1);
  assert.equal(s.audit.find('escalated_to_king').length >= 1, true);
});

test('قيمةٌ خارج المُعلَنِ انحرافٌ ولو كانت الأداةُ داخل الخطة', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, [{ tool: 'compute', args: { n: { kind: 'exact', values: [1, 2] } } }]);
  assert.equal(s.deception.observe(id, 'compute', { n: 1 }).allowed, true);
  const drift = s.deception.observe(id, 'compute', { n: 99 });
  assert.equal(drift.allowed, false);
  assert.match(drift.reason, /ARG_VALUE_NOT_DECLARED/);
  assert.equal(s.agents.get(id)?.status, 'suspended');
});

test('خطةٌ ترفضها السياسةُ لا تُسجَّل — ولا تنفيذَ بعدها', () => {
  const { s, id } = withAgent();
  const args: Record<string, unknown> = {};
  for (let i = 0; i <= LIMITS.maxArgsPerStep; i += 1) {
    args[`a${i}`] = { kind: 'exact', values: ['x'] };
  }
  assert.equal(s.deception.declarePlan(id, [{ tool: 'compute', args } as never]), false);
  assert.equal(s.deception.stepsOf(id), undefined);
  assert.equal(s.deception.observe(id, 'compute').allowed, false);
  assert.equal(s.audit.find('plan_refused').length >= 1, true);
});

test('الخطةُ المعلنةُ تُقرأ بقيودها ولا تُعدَّل بعد الإعلان', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, [{ tool: 'compute', args: { n: { kind: 'range', min: 0, max: 3 } } }]);
  const steps = s.deception.stepsOf(id);
  assert.equal(steps?.length, 1);
  assert.equal(steps?.[0]!.tool, 'compute');
  assert.deepEqual(s.deception.planOf(id), ['compute']);
  assert.equal(s.deception.declarePlan(id, ['compute', 'read_public_data']), false);
  assert.equal(s.audit.find('plan_amendment_refused').length, 1);
});

test('حاجزُ النية في سجلِ الأدوات يقيس المعاملَ لا الأداةَ وحدها', () => {
  const { s, id } = withAgent();
  s.tools.register({
    name: 'writer', requiredCapability: 'compute', maxCallsPerWindow: 10, windowMs: 60_000,
    handler: (args: Record<string, unknown>) => String(args.path),
  } as never);
  s.permissions.grant(
    s.king.issueCommand('grant_capability', id),
    { entity: id, capability: 'compute', expiresAt: Date.now() + 3_600_000 },
  );
  s.deception.declarePlan(id, [{ tool: 'writer', args: { path: { kind: 'prefix', prefix: '/tmp/' } } }]);
  assert.equal(s.tools.invoke(id, 'writer', { path: '/tmp/ok' }, ['compute']).ok, true);
  const escape = s.tools.invoke(id, 'writer', { path: '/etc/passwd' }, ['compute']);
  assert.equal(escape.ok, false);
  assert.match(escape.ok ? '' : escape.reason, /ARG_PREFIX_MISMATCH/);
  assert.equal(s.audit.find('intent_gate_denied').length, 1);
});
