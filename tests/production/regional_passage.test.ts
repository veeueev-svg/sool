/**
 * tests/production/regional_passage.test.ts — مرور التاج على الأفعال الإقليمية (المرحلة 37)
 * المالك: ديوان التدقيق | المدخلات: دولة مهيأة باتحاد قائم + بوابة التاج
 * المخرجات: منعٌ مقيَّد لكل فعل بلا إذن، وإذنٌ واحدٌ لفعل واحد
 * التبعيات: RegionalPassage, GovernorRegistry, CrownGateway
 * الصلاحيات: قياس فقط | السجلات: تصدرها الوحدة المختبَرة
 * حالات الفشل المقيسة: فاتح غير مشغّل، فتح مزدوج، أمر بغير approve_phase، هدف مخالف،
 *   وسائط مخالفة، إذن مكدَّس، إذن مستهلك، إذن منتهٍ، فعل بلا إذن
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEDERATED_ACTION } from '../../src/index';
import { productionHarness, OPERATOR, OBSERVER, countEvent, lastDetail } from './helpers';

const REGION = 'region:core';
const DOMAIN = 'infrastructure';

function scene(now = Date.now()) {
  const h = productionHarness({ now });
  const seat = h.state.governors.governorOf(REGION);
  assert.ok(seat, 'حاكم إقليم النواة جالس');
  const approve = (
    action = FEDERATED_ACTION, regionId = REGION, domain = DOMAIN, at = now,
  ) => h.state.king.issueCommand('approve_phase', regionId, { domain, action, kind: 'federated_passage' }, at);
  return { h, governor: seat.governor, approve, now };
}

test('الفتح: لجهة مشغّلة معلنة بسبب معلن، ولا فتح ثانٍ', () => {
  const { h, now } = scene();
  try {
    assert.equal(h.passage.open(OBSERVER, 'المراقب يفتح', now).ok, false, 'المراقب لا يفتح (RULE-004)');
    assert.equal(h.passage.open(OPERATOR, '  ', now).ok, false, 'لا فتح بلا سبب معلن');
    assert.equal(h.passage.open(OPERATOR, 'تشغيل اتحادي', now).ok, true);
    assert.equal(h.passage.active, true);
    assert.equal(h.passage.operator, OPERATOR);
    assert.equal(h.passage.open(OPERATOR, 'فتح ثانٍ', now).ok, false);
    assert.equal(countEvent(h.state, 'region_passage_refused'), 3);
    assert.equal(countEvent(h.state, 'region_passage_opened'), 1);
  } finally { h.dispose(); }
});

test('الإغلاق: لا إغلاق بلا فتح، والإغلاق يُقفل النافذة ويُقيَّد بحصيلتها', () => {
  const { h, now } = scene();
  try {
    assert.equal(h.passage.close(OPERATOR, 'إغلاق بلا فتح', now).ok, false);
    h.passage.open(OPERATOR, 'تشغيل اتحادي', now);
    assert.equal(h.passage.close(OPERATOR, 'x', now).ok, false, 'لا إغلاق بلا سبب معلن');
    assert.equal(h.passage.close(OPERATOR, 'انتهى القياس', now + 5).ok, true);
    assert.equal(h.passage.active, false);
    assert.equal(h.passage.wasOpenAt(now + 2), true, 'الفعل داخل النافذة يُقاس');
    assert.equal(h.passage.wasOpenAt(now + 50), false, 'وما بعد الإغلاق لا يُقاس');
    assert.equal(lastDetail(h.state, 'region_passage_closed').blocked, 0);
  } finally { h.dispose(); }
});

test('المنح: لا إذن خارج تشغيل مفتوح، ولا إذن بلا أمر ملكي معتمد', () => {
  const { h, approve, now } = scene();
  try {
    assert.equal(h.passage.grant(approve(), { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION }, now).ok,
      false, 'لا إذن خارج تشغيل مفتوح');
    h.passage.open(OPERATOR, 'تشغيل اتحادي', now);
    // فعل الأمر يجب أن يكون approve_phase — لا أمرًا سياديًّا آخر
    const wrongAction = h.state.king.issueCommand('amend_policy', REGION, { domain: DOMAIN, action: FEDERATED_ACTION }, now);
    assert.equal(h.passage.grant(wrongAction, { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION }, now).ok, false);
    // هدف الأمر يجب أن يكون الإقليم نفسه
    assert.equal(
      h.passage.grant(approve(FEDERATED_ACTION, 'region:services'), { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION }, now).ok,
      false, 'إذنٌ لغير موضعه',
    );
    // ولا إذن عامّ: الوسائط تُطابق النطاق والفعل
    assert.equal(
      h.passage.grant(approve(FEDERATED_ACTION, REGION, 'research'), { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION }, now).ok,
      false, 'وسائط لا تطابق النطاق',
    );
    assert.equal(
      h.passage.grant(approve('فعل آخر'), { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION }, now).ok,
      false, 'وسائط لا تطابق الفعل',
    );
    assert.ok(countEvent(h.state, 'region_passage_refused') >= 5);
    assert.equal(countEvent(h.state, 'region_passage_granted'), 0);
  } finally { h.dispose(); }
});

test('المنح: إذنٌ واحد لفعل واحد — ولا تكديس أذون قائمة', () => {
  const { h, approve, now } = scene();
  try {
    h.passage.open(OPERATOR, 'تشغيل اتحادي', now);
    const request = { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION };
    assert.equal(h.passage.grant(approve(), request, now).ok, true);
    assert.equal(h.passage.grant(approve(), request, now).ok, false, 'إذن قائم لم يُستهلك');
    assert.equal(h.passage.report().granted, 1);
  } finally { h.dispose(); }
});

test('العبور: الإذن يُستهلك مرة واحدة، والثانية تُمنع وتُقيَّد', () => {
  const { h, governor, approve, now } = scene();
  try {
    h.passage.open(OPERATOR, 'تشغيل اتحادي', now);
    const request = { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION };
    h.passage.grant(approve(), request, now);
    assert.equal(h.passage.check(governor, request, now).allowed, true);
    assert.equal(h.passage.check(governor, request, now).allowed, false, 'لا استعمال ثانٍ');
    assert.equal(h.passage.blockedAttempts().length, 1);
    assert.equal(h.passage.report().passed, 1);
    assert.equal(countEvent(h.state, 'region_action_passed'), 1);
    assert.equal(countEvent(h.state, 'region_action_bypass_blocked'), 1);
  } finally { h.dispose(); }
});

test('العبور: إذنٌ منتهٍ ليس إذنًا — لا إذن دائم', () => {
  const { h, governor, approve, now } = scene();
  try {
    h.passage.open(OPERATOR, 'تشغيل اتحادي', now);
    const request = { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION };
    h.passage.grant(approve(), request, now);
    const after = now + h.policy.regions.passage_ttl_ms + 1;
    assert.equal(h.passage.check(governor, request, after).allowed, false);
    assert.equal(h.passage.blockedAttempts()[0]?.action, FEDERATED_ACTION);
  } finally { h.dispose(); }
});

test('الإنفاذ: فعل الحاكم بلا إذن يُرفض عند سجل الحكّام نفسه — لا في نسخة موازية', () => {
  const { h, governor, now } = scene();
  try {
    h.passage.open(OPERATOR, 'تشغيل اتحادي', now);
    const result = h.state.governors.act(governor, {
      regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION,
    }, now);
    assert.equal(result.ok, false, 'لا فعل إقليمي بلا مرور التاج');
    assert.equal(countEvent(h.state, 'region_action_bypass_blocked'), 1);
    assert.equal(countEvent(h.state, 'region_action_executed'), 0);
  } finally { h.dispose(); }
});

test('الإنفاذ: الفعل بإذن ينفُذ، ويُقيَّد مروره قبل تنفيذه', () => {
  const { h, governor, approve, now } = scene();
  try {
    h.passage.open(OPERATOR, 'تشغيل اتحادي', now);
    const request = { regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION };
    assert.equal(h.passage.grant(approve(), request, now).ok, true);
    const result = h.state.governors.act(governor, request, now);
    assert.equal(result.ok, true, `الفعل نفَذ: ${'reason' in result ? result.reason : ''}`);
    const passedSeq = h.state.audit.find('region_action_passed').at(-1)?.seq ?? 0;
    const executedSeq = h.state.audit.find('region_action_executed').at(-1)?.seq ?? 0;
    assert.ok(passedSeq < executedSeq, 'المرور قبل التنفيذ لا بعده');
  } finally { h.dispose(); }
});

test('المرور المغلق لا يغيّر سلوك الدولة القائمة — كما فُعل بالنطاق في المرحلة 36', () => {
  const { h, governor, now } = scene();
  try {
    // لم يُفتح تشغيل اتحادي: الفعل الإقليمي يُحكم كما كان قبل المرحلة 37
    const result = h.state.governors.act(governor, {
      regionId: REGION, domain: DOMAIN, action: FEDERATED_ACTION,
    }, now);
    assert.equal(result.ok, true, 'دولةٌ لم يُفتح لها تشغيل تعمل كما كانت');
    assert.equal(countEvent(h.state, 'region_action_bypass_blocked'), 0);
  } finally { h.dispose(); }
});

test('الربط مرة واحدة: مرورٌ ثانٍ لا يُربط بسجل الحكّام', () => {
  const { h } = scene();
  try {
    assert.throws(() => h.state.governors.bindPassage(h.passage), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'GOVERNOR_PASSAGE_ALREADY_BOUND');
      return true;
    });
  } finally { h.dispose(); }
});
