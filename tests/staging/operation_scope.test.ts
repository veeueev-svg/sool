/**
 * tests/staging/operation_scope.test.ts — النطاق مُنفَّذ عند البوابة لا موصوف (المرحلة 36)
 * المالك: ديوان التدقيق | المدخلات: دولة مهيأة بنطاقها المربوط ببوابة التاج
 * المخرجات: إثبات أن المنع يقع عند البوابة على أمر ملكي صحيح تمامًا
 * التبعيات: bootstrapState + OperationScope + CrownGateway
 * الصلاحيات: القياس فقط | السجلات: scope_opened / scope_closed / scope_refused / staging_incident
 * حالات الفشل: كلها مغلقة برموز وأحداث معلنة
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0020-limited-operation.md
 * ثوابت الاختبار: 1) المنع يُقاس عند البوابة لا في الوحدة وحدها؛ 2) الرفض بحدثه لا بنصه؛
 *   3) الأمر المقيس صحيحٌ سيادةً كي يكون الرفض منسوبًا إلى النطاق وحده.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, OperationScope, SovereignViolation, KNOWN_SOVEREIGN_ACTIONS,
} from '../../src/index';
import { OPERATOR, countEvent, lastDetail } from './helpers';

const NOT_OPERATOR = 'agent:001';

function fresh(): ReturnType<typeof bootstrapState> {
  return bootstrapState({ now: Date.now() });
}

test('النطاق مغلق عند التأسيس — دولةٌ لم تُفتح لها نافذة تعمل كما كانت', () => {
  const s = fresh();
  assert.equal(s.operationScope.active, false);
  assert.equal(s.operationScope.violations().length, 0);
  const forbidden = s.stagingConfig.policy.scope.forbidden_actions[0]!;
  const cmd = s.king.issueCommand(forbidden, 'policy:test', { kind: 'federation' });
  assert.equal(s.gateway.authorize(cmd, Date.now()).allowed, true);
});

test('فتح النطاق لجهة غير مشغّلة يُرفض ويُسجَّل scope_refused (RULE-004)', () => {
  const s = fresh();
  const before = countEvent(s, 'scope_refused');
  const out = s.operationScope.open(NOT_OPERATOR, 'محاولة فتح', Date.now());
  assert.equal(out.ok, false);
  assert.equal(s.operationScope.active, false);
  assert.equal(countEvent(s, 'scope_refused'), before + 1);
});

test('فتح النطاق بلا سبب معلن يُرفض (RULE-006)', () => {
  const s = fresh();
  assert.equal(s.operationScope.open(OPERATOR, '  ', Date.now()).ok, false);
  assert.equal(s.operationScope.active, false);
});

test('فتح النطاق مرتين يُرفض — كي لا يُخفي فتحٌ ثانٍ عدّ خرقٍ سابق', () => {
  const s = fresh();
  assert.equal(s.operationScope.open(OPERATOR, 'نافذة أولى', Date.now()).ok, true);
  assert.equal(s.operationScope.open(OPERATOR, 'نافذة ثانية', Date.now()).ok, false);
});

test('إغلاق نطاق غير مفتوح يُرفض', () => {
  const s = fresh();
  assert.equal(s.operationScope.close(OPERATOR, 'إغلاق', Date.now()).ok, false);
});

test('إغلاق النطاق لجهة غير مشغّلة يُرفض', () => {
  const s = fresh();
  s.operationScope.open(OPERATOR, 'نافذة', Date.now());
  assert.equal(s.operationScope.close(NOT_OPERATOR, 'إغلاق', Date.now()).ok, false);
  assert.equal(s.operationScope.active, true);
});

test('الفتح يُقيّد الأفعال المعلنة في السجل — القيد يُقرأ من خارج الوحدة', () => {
  const s = fresh();
  s.operationScope.open(OPERATOR, 'نافذة تشغيل محدود', Date.now());
  const detail = lastDetail(s, 'scope_opened');
  assert.deepEqual(detail.permitted, [...s.stagingConfig.policy.scope.permitted_actions]);
  assert.deepEqual(detail.forbidden, [...s.stagingConfig.policy.scope.forbidden_actions]);
  assert.equal(detail.maxAgents, s.stagingConfig.policy.scope.max_agents);
});

test('النطاق المفتوح يسمح بفعل معلن ولا يُقيّد حادثًا', () => {
  const s = fresh();
  s.operationScope.open(OPERATOR, 'نافذة', Date.now());
  const permitted = s.stagingConfig.policy.scope.permitted_actions[0]!;
  const decision = s.operationScope.permit(permitted, OPERATOR, Date.now());
  assert.equal(decision.allowed, true);
  assert.equal(s.operationScope.violations().length, 0);
});

test('النطاق المفتوح يمنع فعلًا ممنوعًا ويُقيّده حادثًا حرجًا', () => {
  const s = fresh();
  s.operationScope.open(OPERATOR, 'نافذة', Date.now());
  const forbidden = s.stagingConfig.policy.scope.forbidden_actions[0]!;
  const decision = s.operationScope.permit(forbidden, OPERATOR, Date.now());
  assert.equal(decision.allowed, false);
  assert.equal(s.operationScope.violations().length, 1);
  const detail = lastDetail(s, 'staging_incident');
  assert.equal(detail.kind, 'scope_violation');
  assert.equal(detail.severity, 'critical');
});

test('المنع افتراضٌ لا استثناء: فعل سيادي معروف غير معلن في النطاق يُمنع', () => {
  const s = fresh();
  const policy = s.stagingConfig.policy.scope;
  const neither = KNOWN_SOVEREIGN_ACTIONS.find(
    (a) => !policy.permitted_actions.includes(a) && !policy.forbidden_actions.includes(a),
  )!;
  assert.equal(policy.permitted_actions.includes(neither), false);
  assert.equal(policy.forbidden_actions.includes(neither), false);
  s.operationScope.open(OPERATOR, 'نافذة', Date.now());
  assert.equal(s.operationScope.permit(neither, OPERATOR, Date.now()).allowed, false);
  assert.equal(s.operationScope.violations()[0]?.action, neither);
});

test('قياس فاصل: بوابة التاج ترفض أمرًا ملكيًّا صحيحًا لخرق النطاق وحده', () => {
  const s = fresh();
  const forbidden = s.stagingConfig.policy.scope.forbidden_actions[0]!;
  // الأمر نفسه يُعتمد قبل فتح النطاق — فالرفض بعده منسوب إلى القيد لا إلى عيب في الأمر
  const before = s.king.issueCommand(forbidden, 'policy:a', { kind: 'federation' });
  assert.equal(s.gateway.authorize(before, Date.now()).allowed, true);
  s.operationScope.open(OPERATOR, 'نافذة تشغيل محدود', Date.now());
  const deniedBefore = countEvent(s, 'command_denied');
  const after = s.king.issueCommand(forbidden, 'policy:b', { kind: 'federation' });
  const decision = s.gateway.authorize(after, Date.now());
  assert.equal(decision.allowed, false);
  assert.equal(countEvent(s, 'command_denied'), deniedBefore + 1);
  assert.equal(s.operationScope.violations().length, 1);
  assert.equal(lastDetail(s, 'staging_incident').kind, 'scope_violation');
});

test('البوابة تعتمد الفعل المعلن في النطاق وهو مفتوح — القيد يمنع ولا يُعطّل', () => {
  const s = fresh();
  s.operationScope.open(OPERATOR, 'نافذة تشغيل محدود', Date.now());
  const permitted = s.stagingConfig.policy.scope.permitted_actions[0]!;
  const cmd = s.king.issueCommand(permitted, 'agent:900', { role: 'agent' });
  assert.equal(s.gateway.authorize(cmd, Date.now()).allowed, true);
  assert.equal(s.operationScope.violations().length, 0);
});

test('إغلاق النطاق يعيد سلوك البوابة كما كان ويُقيّد عدد الخروق', () => {
  const s = fresh();
  const forbidden = s.stagingConfig.policy.scope.forbidden_actions[0]!;
  s.operationScope.open(OPERATOR, 'نافذة', Date.now());
  s.gateway.authorize(s.king.issueCommand(forbidden, 'policy:c', { kind: 'federation' }), Date.now());
  assert.equal(s.operationScope.close(OPERATOR, 'انتهت النافذة', Date.now()).ok, true);
  assert.equal(lastDetail(s, 'scope_closed').violations, 1);
  const cmd = s.king.issueCommand(forbidden, 'policy:d', { kind: 'federation' });
  assert.equal(s.gateway.authorize(cmd, Date.now()).allowed, true);
  // ثابت: الخرق مقيَّد ولا يُمحى بإغلاق النافذة (RULE-006)
  assert.equal(s.operationScope.violations().length, 1);
});

test('ربط نطاق ثانٍ بالبوابة يُرفض برمزه — ربطٌ ثانٍ يُخفي قيدًا قائمًا', () => {
  const s = fresh();
  const other = new OperationScope({ audit: s.audit, policy: s.stagingConfig.policy });
  assert.throws(() => s.gateway.bindScope(other), (error: unknown) => {
    assert.equal(error instanceof SovereignViolation, true);
    assert.equal((error as SovereignViolation).code, 'GATEWAY_SCOPE_ALREADY_BOUND');
    return true;
  });
});

test('تقرير النطاق يقول من فتحه وكم خرقًا وقع', () => {
  const s = fresh();
  s.operationScope.open(OPERATOR, 'نافذة', Date.now());
  const forbidden = s.stagingConfig.policy.scope.forbidden_actions[0]!;
  s.operationScope.permit(forbidden, OPERATOR, Date.now());
  const report = s.operationScope.report();
  assert.equal(report.active, true);
  assert.equal(report.operator, OPERATOR);
  assert.equal(report.violations, 1);
});
