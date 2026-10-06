/**
 * tests/economy/tax_rate_amendment.test.ts — التعديلُ الملكيُّ لنسبة الرسم (T-53 · W-2026-065)
 * معيار القبول (PROGRESS.md §2 / عقد W-2026-065 §4): «مسارٌ ملكيٌّ لتعديل سعر رسم
 * مع حفظ تاريخ الإعلان» — يُسجّل القيمتين معًا، ولا أثرَ رجعيًا، ولا تعديلَ بغير بوابة التاج.
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVENUE_TARGET, UNIT_TARGET, bootstrapState } from '../../src/index';
import type { RateAmendmentRecovery } from '../../src/economy/tax';

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
  // الشاهدُ كما دُوِّن حرفًا (rate_amended) — بحقوله كلِّها (الجلسة 6 · ثابت 4)
  const seen = first.s.audit.find('rate_amended').map((e) => witnessOf(e.detail));
  assert.equal(seen.length, 2, 'شاهدا التعديلين');
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

/** يبني شاهدَ الإرجاعِ من تفصيلِ قيدِ rate_amended كما يبنيه rehydrate_fiscal */
function witnessOf(detail: unknown): RateAmendmentRecovery {
  const d = detail as Record<string, unknown>;
  return {
    base: d['base'], from: d['from'], ratePerMille: d['to'], previousDeclaredAt: d['previousDeclaredAt'],
    declaredAt: d['effectiveFrom'], commandId: d['commandId'], commandIssuedAt: d['commandIssuedAt'],
  } as RateAmendmentRecovery;
}

test('**T-53/مجلس 2ب** — الإرجاعُ فشلٌ مغلق: وعاءٌ دخيلٌ أو نسبةٌ غيرُ سليمةٍ أو إعلانٌ يرجعُ بالزمنِ أو تعديلٌ بلا تغيير', () => {
  const { s } = revenueState();
  const D0 = s.revenue.rateFor('compute_usage')!.declaredAt;
  const w = (o: Partial<RateAmendmentRecovery>): RateAmendmentRecovery[] =>
    [{ base: 'compute_usage', from: 25, ratePerMille: 40, previousDeclaredAt: D0, declaredAt: T1, commandId: 'cmd:x', ...o }];
  assert.throws(() => s.revenue.restoreRateAmendments(w({ base: 'undeclared_base' }), 'authority:audit_bureau'),
    /RECOVERY_RATE_BASE_UNDECLARED/);
  assert.throws(() => s.revenue.restoreRateAmendments(w({ ratePerMille: 0 }), 'authority:audit_bureau'),
    /RECOVERY_RATE_INVALID/);
  assert.throws(() => s.revenue.restoreRateAmendments(w({ declaredAt: 0 }), 'authority:audit_bureau'),
    /RECOVERY_RATE_ORDER_VIOLATION/);
  assert.throws(() => s.revenue.restoreRateAmendments(w({ commandId: ' ' }), 'authority:audit_bureau'),
    /RECOVERY_RATE_COMMAND_ID_MISSING/);
  assert.throws(() => s.revenue.restoreRateAmendments(w({ ratePerMille: 25 }), 'authority:audit_bureau'),
    /RECOVERY_RATE_NO_CHANGE/);
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'لا تغيّرَ بعد الرفض');
});

test('**T-53/مجلس 6** — الأمرُ المنفَّذُ حيًّا له حمولتُه: شاهدٌ مخالفٌ بمعرّفِه يُرفض ولا يُتخطّى (RATE_AMENDMENT_LIVE_EXECUTED_CONFLICT_SILENT_SKIP)', () => {
  const { s, royal } = revenueState();
  const cmd = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  assert.equal(s.revenue.amendRate(cmd, 'compute_usage', 40, T1).ok, true);
  const live = witnessOf(s.audit.find('rate_amended')[0]!.detail);
  // مسبارُ grok بحرفه: تنفيذٌ حيٌّ عند 40 ثمّ شاهدٌ بالمعرّفِ نفسِه عند 90 وتاريخٍ لاحق — كان applied=0 بلا رمي
  assert.throws(() => s.revenue.restoreRateAmendments([{ ...live, ratePerMille: 90, declaredAt: T2 }], 'authority:audit_bureau'),
    (e: Error) => e.message === `RECOVERY_RATE_COMMAND_CONFLICT:${cmd.payload.commandId}`);
  // ومخالفةُ حقلٍ واحدٍ غيرِ النسبة تكفي: from · previousDeclaredAt · commandIssuedAt
  for (const o of [{ from: 999 }, { previousDeclaredAt: 1 }, { commandIssuedAt: 1 }]) {
    assert.throws(() => s.revenue.restoreRateAmendments([{ ...live, ...o }], 'authority:audit_bureau'),
      (e: Error) => e.message === `RECOVERY_RATE_COMMAND_CONFLICT:${cmd.payload.commandId}`, JSON.stringify(o));
  }
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 2, 'لا شيءَ طُبِّق بالرفض');
  // سالبةُ الضبط: الشاهدُ طبقَ الأصلِ لما نُفِّذ حيًّا يُتخطّى بأمانٍ ولا يُكرَّر
  s.revenue.restoreRateAmendments([live], 'authority:audit_bureau');
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 2, 'الإعادةُ الأمينةُ لا تُكرِّر');
});

test('**T-53/مجلس 6** — الشاهدُ الجديدُ يصل سلسلتَه: from وpreviousDeclaredAt يُصدَّقان بالسائدة (RECOVERY_RATE_CHAIN_BROKEN) ويُفحصان بنوعهما', () => {
  const { s } = revenueState();
  const D0 = s.revenue.rateFor('compute_usage')!.declaredAt;
  const ok: RateAmendmentRecovery = { base: 'compute_usage', from: 25, ratePerMille: 40, previousDeclaredAt: D0, declaredAt: T1, commandId: 'cmd:c' };
  const run = (o: Record<string, unknown>) => () => s.revenue.restoreRateAmendments([{ ...ok, ...o } as RateAmendmentRecovery], 'authority:audit_bureau');
  assert.throws(run({ from: 999 }), (e: Error) => e.message === 'RECOVERY_RATE_CHAIN_BROKEN');
  assert.throws(run({ previousDeclaredAt: D0 + 1 }), (e: Error) => e.message === 'RECOVERY_RATE_CHAIN_BROKEN');
  assert.throws(run({ from: undefined }), (e: Error) => e.message === 'RECOVERY_RATE_FROM_INVALID');
  assert.throws(run({ previousDeclaredAt: 'أمس' }), (e: Error) => e.message === 'RECOVERY_RATE_PREVIOUS_DECLARED_AT_INVALID');
  assert.throws(run({ commandIssuedAt: 'x' }), (e: Error) => e.message === 'RECOVERY_RATE_COMMAND_ISSUED_AT_INVALID');
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 1, 'لا تغيّرَ بعد الرفض');
  s.revenue.restoreRateAmendments([ok], 'authority:audit_bureau');
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'الشاهدُ الواصلُ سلسلتَه يُرجَع');
});

test('**T-53/مجلس 7** — RATE_AMENDMENT_HISTORY_MUTABLE_REFERENCE_ESCAPE: المرجعُ المُعاد لا يُسرِّبُ الإعلانَ التاريخيَّ', () => {
  const { s } = revenueState();
  const before = s.revenue.rateFor('compute_usage')!.ratePerMille;
  assert.equal(before, 25, 'النسبةُ الأولية 25');
  // المُستدعي يأخذُ تاريخَ الإعلانات
  const history = s.revenue.rateHistoryOf('compute_usage');
  assert.equal(history.length, 1, 'إعلانٌ واحد');
  // يحاول تعديل النسبة بلا أمرٍ ملكي
  (history[0] as { ratePerMille: number }).ratePerMille = 999;
  // لا أثر: النسبة الداخلية لم تتغير
  assert.equal(s.revenue.rateFor('compute_usage')!.ratePerMille, 25, 'المرجعُ المُعاد نسخةٌ لا أصل — التعديلُ بلا أمرٍ ملكيٍّ لا يصل');
  // والتقديرُ يستعملُ النسبة الصحيحة
  const levy = s.revenue.assess('compute_usage', 'agent:external', 1000, NOW, NOW);
  assert.equal(levy.ok && levy.levy.ratePerMille, 25, 'التقديرُ بالنسبة الأصلية لا المُعدَّلة');
  // ومسارُ historyOf لا يُرجِعُ المرجعَ الداخلي
  const again = s.revenue.rateHistoryOf('compute_usage');
  assert.equal(again[0]!.ratePerMille, 25, 'التاريخُ الداخليُّ لم يتأثّر');
});
