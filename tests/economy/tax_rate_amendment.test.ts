/**
 * tests/economy/tax_rate_amendment.test.ts — التعديلُ الملكيُّ لنسبة الرسم (T-53 · W-2026-065)
 * معيار القبول (PROGRESS.md §2 / عقد W-2026-065 §4): «مسارٌ ملكيٌّ لتعديل سعر رسم
 * مع حفظ تاريخ الإعلان» — يُسجّل القيمتين معًا، ولا أثرَ رجعيًا، ولا تعديلَ بغير بوابة التاج.
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVENUE_TARGET, UNIT_TARGET, bootstrapState } from '../../src/index';

const NOW = Date.now();
const T1 = NOW + 10_000;
const T2 = NOW + 20_000;

function revenueState() {
  const s = bootstrapState({ now: NOW });
  const royal = (target: string, at = NOW, base?: string, ratePerMille?: number) =>
    s.king.issueCommand('amend_policy', target,
      base === undefined ? { kind: 'economy' } : { kind: 'economy', base, ratePerMille: ratePerMille ?? 0 }, at);
  s.unit.issue(royal(UNIT_TARGET), 10_000_000, 'تمويل أولي', NOW);
  return { s, royal };
}

test('**T-53/قبول 1** — تعديلٌ ملكيٌّ معتمدٌ ينجح ويسجّل القيمتين معًا وبتاريخ السريان', () => {
  const { s, royal } = revenueState();
  const result = s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'compute_usage', 40), 'compute_usage', 40, T1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.previous.ratePerMille, 25, 'القيمةُ السابقةُ في النتيجة');
    assert.equal(result.declaration.ratePerMille, 40, 'القيمةُ الجديدةُ في النتيجة');
    assert.equal(result.declaration.declaredAt, T1, 'تاريخُ السريان هو لحظةُ الاعتماد');
  }
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'النسبةُ الجديدةُ صارت الحاكمة');
  const amended = s.audit.find('rate_amended');
  assert.equal(amended.length, 1);
  const detail = amended[0]?.detail as {
    base: string; from: number; to: number; effectiveFrom: number;
  };
  assert.equal(detail.base, 'compute_usage');
  assert.equal(detail.from, 25, 'السجلُّ يحفظُ القيمةَ القديمة');
  assert.equal(detail.to, 40, 'والسجلُّ يحفظُ القيمةَ الجديدة');
  assert.equal(detail.effectiveFrom, T1);
});

test('**T-53/قبول 2أ** — لا أثرًا رجعيًا: واقعةٌ قبل تاريخِ السريانِ تُقدَّر بالنسبةِ القديمة', () => {
  const { s, royal } = revenueState();
  const beforeAmendment = T1 - 1;
  assert.equal(s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'compute_usage', 40), 'compute_usage', 40, T1).ok, true);
  const oldRate = s.revenue.assess('compute_usage', 'agent:worker-1', 400_000, beforeAmendment, T2);
  assert.equal(oldRate.ok, true);
  assert.equal(oldRate.ok && oldRate.levy.levied, 10_000, 'النسبةُ القديمة 25 في الألف لا 40');
  const newRate = s.revenue.assess('compute_usage', 'agent:worker-2', 400_000, T1, T2);
  assert.equal(newRate.ok, true);
  assert.equal(newRate.ok && newRate.levy.levied, 16_000, 'والنسبةُ الجديدة 40 في الألف بعد السريان');
  assert.equal(newRate.ok && newRate.levy.ratePerMille, 40);
});

test('**T-53/قبول 2ب** — واقعةٌ قبل إعلانِ النسبةِ الأولى تظلُّ مرفوضةً بعد التعديل (ثابت 2 محفوظًا)', () => {
  const { s, royal } = revenueState();
  assert.equal(s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'model_training', 80), 'model_training', 80, T1).ok, true);
  const beforeFirstDeclaration = Date.parse('2026-08-22T00:00:00Z') - 1;
  const refused = s.revenue.assess('model_training', 'agent:lab', 1_000_000, beforeFirstDeclaration, T2);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /رجعي|قبل/);
});

test('**T-53/قبول 3أ** — لا تعديلَ بفعلٍ غير amend_policy ولا بهدفٍ غير بوابة الإيراد', () => {
  const { s } = revenueState();
  const wrongAction = s.king.issueCommand('approve_phase', REVENUE_TARGET, {}, T1);
  assert.equal(s.revenue.amendRate(wrongAction, 'compute_usage', 40, T1).ok, false);
  const wrongTarget = s.king.issueCommand('amend_policy', 'economy:unit', {}, T1);
  const result = s.revenue.amendRate(wrongTarget, 'compute_usage', 40, T1);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /هدف/);
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'لا تغيّرَ بعد الرفض');
  assert.equal(s.audit.find('rate_amended').length, 0);
});

test('**T-53/قبول 3ب** — أمرٌ مزوَّرُ التوقيعِ لا يعتمدُه التاجُ فلا يُعدَّلُ به شيء', () => {
  const { s, royal } = revenueState();
  const genuine = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  const forged = {
    payload: genuine.payload,
    signature: 'bm90LXZhbGlkLXNpZ25hdHVyZQ==',
    keyId: 'key:forged',
  };
  const result = s.revenue.amendRate(forged, 'compute_usage', 40, T1);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /غير معتمد/);
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'الجذرُ لم يتغيّر');
  assert.equal(s.audit.find('rate_amended').length, 0, 'ولا سجلَّ تعديل');
});

test('**T-53/قبول 4** — حدودُ النسبةِ من المصدرِ الواحدِ: صفرٌ وسالبٌ وفوق الألفِ وكسرٌ مرفوضة', () => {
  const { s, royal } = revenueState();
  const command = royal(REVENUE_TARGET, T1);
  for (const bad of [0, -5, 1001, 2.5]) {
    const result = s.revenue.amendRate(command, 'compute_usage', bad, T1);
    assert.equal(result.ok, false, `النسبةُ ${bad} مرفوضة`);
    assert.match(result.ok ? '' : result.reason, /غير سليمة/);
  }
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25);
});

test('**T-53/قبول 5أ** — وعاءٌ غيرُ معلنٍ لا يُعدَّلُ ولو جاءَ الأمرُ بملكِها', () => {
  const { s, royal } = revenueState();
  const result = s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'secret_base', 40), 'secret_base', 40, T1);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /غير معلن/);
});

test('**T-53/قبول 5ب** — لا تعديلَ بلا تغييرٍ ولا بتاريخٍ يسابقُ إعلانَه', () => {
  const { s, royal } = revenueState();
  const noChange = s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'compute_usage', 25), 'compute_usage', 25, T1);
  assert.equal(noChange.ok, false);
  assert.match(noChange.ok ? '' : noChange.reason, /بلا تغيير/);
  // تعديلٌ أولٌ يسري في T1، ثمّ محاولةُ تعديلٍ ثانٍ بتاريخٍ يسابقُ سريانَه
  assert.equal(s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'compute_usage', 40), 'compute_usage', 40, T1).ok, true);
  const backdated = s.revenue.amendRate(royal(REVENUE_TARGET, T1 - 5, 'compute_usage', 50), 'compute_usage', 50, T1 - 5);
  assert.equal(backdated.ok, false);
  assert.match(backdated.ok ? '' : backdated.reason, /يسابق/);
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'التعديلُ المرفوضُ لم يمسّ الحال');
});

test('**T-53/قبول 6** — سجلُّ النِّسَبِ يُعيدُ الإعلاناتِ كلَّها مرتّبةً ولا يُمحى منها شيء', () => {
  const { s, royal } = revenueState();
  assert.equal(s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'compute_usage', 40), 'compute_usage', 40, T1).ok, true);
  assert.equal(s.revenue.amendRate(royal(REVENUE_TARGET, T2, 'compute_usage', 60), 'compute_usage', 60, T2).ok, true);
  const history = s.revenue.rateHistoryOf('compute_usage');
  assert.equal(history.length, 3, 'إعلانُ التهيئةِ وذَانِ التعديلان');
  assert.deepEqual(history.map((h) => h.ratePerMille), [25, 40, 60], 'مرتّبةً بزمنِ سريانها');
  assert.deepEqual(history.map((h) => h.declaredAt), [history[0]?.declaredAt, T1, T2]);
  assert.equal(s.revenue.rateHistoryOf('secret_base').length, 0, 'وعاءٌ غيرُ معلنٍ لا سجلَّ له');
});

test('**T-53/أثرُ القياس** — تغييرُ النسبةِ يغيّرُ مبلغَ الرسمِ فعلًا لا اسمًا', () => {
  const { s, royal } = revenueState();
  const before = s.revenue.assess('compute_usage', 'agent:worker-1', 400_000, NOW, NOW);
  assert.equal(before.ok && before.levy.levied, 10_000);
  assert.equal(s.revenue.amendRate(royal(REVENUE_TARGET, T1, 'compute_usage', 50), 'compute_usage', 50, T1).ok, true);
  const after = s.revenue.assess('compute_usage', 'agent:worker-2', 400_000, T1, T1);
  assert.equal(after.ok && after.levy.levied, 20_000, '50 في الألف من 400000 = 20000');
});

test('**T-53/مجلس 1أ** — إعادةُ الأمرِ نفسِه لا تُعدّل ثانيةً ولو قبلت البوابةُ الإعادة', () => {
  const { s, royal } = revenueState();
  const command = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  assert.equal(s.revenue.amendRate(command, 'compute_usage', 40, T1).ok, true);
  // نسبةٌ تعود ثمّ يُعاد الأمرُ الأوّلُ: لولا الحرسُ لكانت «تغييرًا» يمرّ ببوابةٍ تُعيد قرارَها
  assert.equal(s.revenue.amendRate(royal(REVENUE_TARGET, T1 + 1, 'compute_usage', 25), 'compute_usage', 25, T1 + 1).ok, true);
  const replay = s.revenue.amendRate(command, 'compute_usage', 40, T2);
  assert.equal(replay.ok, false);
  assert.match(replay.ok ? '' : replay.reason, /نُفّذ سابقًا/);
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'الإعادةُ لم تمسّ الحال');
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 3);
  assert.equal(s.audit.find('rate_amended').length, 2);
});

test('**T-53/مجلس 1ب** — الأمرُ مربوطٌ بوعائه ونسبته: توقيعٌ واحدٌ لا يعدّل وعاءً آخر ولا نسبةً أخرى', () => {
  const { s, royal } = revenueState();
  const command = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  const otherBase = s.revenue.amendRate(command, 'model_training', 40, T1);
  assert.equal(otherBase.ok, false);
  assert.match(otherBase.ok ? '' : otherBase.reason, /لا يسمّي/);
  const otherRate = s.revenue.amendRate(command, 'compute_usage', 60, T1);
  assert.equal(otherRate.ok, false);
  assert.match(otherRate.ok ? '' : otherRate.reason, /لا يسمّي/);
  const unbound = s.revenue.amendRate(royal(REVENUE_TARGET, T1), 'compute_usage', 40, T1);
  assert.equal(unbound.ok, false, 'أمرٌ بلا params موقَّعةٍ تسمّي التعديل مرفوض');
  assert.equal(s.audit.find('rate_amended').length, 0);
  // والأمرُ نفسُه لم يُستهلك بالرفض: يُنفَّذ على ما سمّاه
  assert.equal(s.revenue.amendRate(command, 'compute_usage', 40, T1).ok, true);
  const second = s.revenue.amendRate(command, 'model_training', 40, T2);
  assert.equal(second.ok, false, 'ولا يُعاد استعمالُه لوعاءٍ آخر بعد تنفيذه');
  assert.equal(s.revenue.rateFor('model_training')?.ratePerMille !== 40, true);
});

test('**T-53/مجلس 2أ** — سجلُّ النِّسَبِ والأوامرُ المنفَّذةُ تُستعادُ من الشاهدِ وتنجو إعادةَ التشغيل (RATE_AMENDMENT_HISTORY_NOT_DURABLE)', () => {
  const first = revenueState();
  const cmd1 = first.royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  assert.equal(first.s.revenue.amendRate(cmd1, 'compute_usage', 40, T1).ok, true);
  const cmd2 = first.royal(REVENUE_TARGET, T2, 'compute_usage', 60);
  assert.equal(first.s.revenue.amendRate(cmd2, 'compute_usage', 60, T2).ok, true);
  // الدولةُ الثانيةُ تُبنى من التهيئة ثمّ يُرجَعُ لها شاهدُ التعديلين
  const second = revenueState();
  const seen = [
    { base: 'compute_usage', ratePerMille: 40, declaredAt: T1, commandId: cmd1.payload.commandId },
    { base: 'compute_usage', ratePerMille: 60, declaredAt: T2, commandId: cmd2.payload.commandId },
  ];
  second.s.revenue.restoreRateAmendments(seen, 'authority:audit_bureau');
  const history = second.s.revenue.rateHistoryOf('compute_usage');
  assert.equal(history.length, 3, 'إعلانُ التهيئة + التعديلان');
  assert.equal(history.map((d) => d.ratePerMille).join(','), '25,40,60', 'السجلُّ مرتّبٌ بلا محو');
  assert.equal(second.s.revenue.rateFor('compute_usage')?.ratePerMille, 60, 'النسبةُ الحاكمةُ بعد الإرجاع');
  // أمرٌ نُفِّذ قبلَ الإقلاع: إعادتُه بعدَ تعديلٍ لاحقٍ تُرفضُ بالإرجاعِ لا بالبوابةِ وحدها
  const replay = second.s.revenue.amendRate(cmd1, 'compute_usage', 40, T2 + 1);
  assert.equal(replay.ok, false);
  assert.match(replay.ok ? '' : replay.reason, /نُفّذ سابقًا/);
  assert.equal(second.s.revenue.rateFor('compute_usage')?.ratePerMille, 60, 'لا رجوعَ بالأمر المُعاد');
  // والإرجاعُ مرةً ثانيةً لا يُكرِّر
  second.s.revenue.restoreRateAmendments(seen, 'authority:audit_bureau');
  assert.equal(second.s.revenue.rateHistoryOf('compute_usage').length, 3, 'المعرّفُ شاهدُ التفرّد');
});

test('**T-53/مجلس 2ب** — الإرجاعُ فشلٌ مغلق: وعاءٌ دخيلٌ أو نسبةٌ غيرُ سليمةٍ أو إعلانٌ يرجعُ بالزمنِ أو تعديلٌ بلا تغيير', () => {
  const { s } = revenueState();
  assert.throws(() => s.revenue.restoreRateAmendments(
    [{ base: 'undeclared_base', ratePerMille: 40, declaredAt: T1, commandId: 'cmd:x' }], 'authority:audit_bureau'),
    /RECOVERY_RATE_BASE_UNDECLARED/);
  assert.throws(() => s.revenue.restoreRateAmendments(
    [{ base: 'compute_usage', ratePerMille: 0, declaredAt: T1, commandId: 'cmd:x' }], 'authority:audit_bureau'),
    /RECOVERY_RATE_INVALID/);
  assert.throws(() => s.revenue.restoreRateAmendments(
    [{ base: 'compute_usage', ratePerMille: 40, declaredAt: 0, commandId: 'cmd:x' }], 'authority:audit_bureau'),
    /RECOVERY_RATE_ORDER_VIOLATION/);
  assert.throws(() => s.revenue.restoreRateAmendments(
    [{ base: 'compute_usage', ratePerMille: 40, declaredAt: T1, commandId: ' ' }], 'authority:audit_bureau'),
    /RECOVERY_RATE_COMMAND_ID_MISSING/);
  assert.throws(() => s.revenue.restoreRateAmendments(
    [{ base: 'compute_usage', ratePerMille: 25, declaredAt: T1, commandId: 'cmd:x' }], 'authority:audit_bureau'),
    /RECOVERY_RATE_NO_CHANGE/);
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'لا تغيّرَ بعد الرفض');
});
