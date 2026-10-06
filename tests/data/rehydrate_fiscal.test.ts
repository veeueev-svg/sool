/**
 * tests/data/rehydrate_fiscal.test.ts — قبولُ دوامِ الماليّة والنافذة الخارجيّة (المرحلة 39، البند T-125)
 * شرطُ القبول المعلن في PROGRESS.md: «الوحداتُ المشتقّة لا تُدوَّن — تُقاس الفجوة أوّلًا
 * ثم تُغلق بأبوابٍ ذرّيّة». والرقمُ المقيس في docs/audit/measurements/phase-39-T125.txt:
 * قبلَ هذا البند كان كلُّ شيءٍ يعود صفرًا — مصروفان ⇒ 0، بندٌ مستهلَكٌ 1,800,000 ⇒ 0،
 * إصدارُ 100,000,000 ⇒ 0 — وأخطرُ منها أنّ **سقفَ الموازنة يُعاد تعبئتُه** بإقلاعٍ
 * (متاحٌ 60,000,000 والدفترُ يشهد بصرفِ 1,500,000). وهذا الملف يُثبت أثرَ الإغلاق.
 * المالك: وزارة البيانات | المدخلات: تهيئةٌ مؤقتة ومجلدُ يوميّة | المخرجات: حالةٌ تنجو أو رفض
 * التبعيات: bootstrapState — والبذرُ كلُّه بالأبواب المعلنة لا بحقلٍ خاص
 * الصلاحيات: الكتابة عبر الواجهات العامة وحدها
 * السجلات: treasury_restored · budget_restored · revenue_restored · unit_restored ·
 *           external_accounts_restored · payments_restored · partner_risk_restored
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir ولا يكتب في المستودع
 * اختبارات الوحدة: tests/data/persistence.test.ts | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/decisions/ADR-0031-fiscal-durability.md
 *
 * ثوابت هذا الاختبار:
 *   1) لا كتابة بحقلٍ خاص: كلُّ بذرةٍ تمرّ بالباب المعلن كما يمرّ به المشغّل.
 *   2) الإقلاعُ الثاني دولةٌ جديدةٌ بالكامل — لا كائنَ مشتركًا بين الإقلاعين.
 *   3) التأكيد على الأرقام والرموز لا على النصوص العربية المشكولة.
 *   4) **`T0` مُقيَّدٌ بتاريخِ إعلانِ نِسَبِ الجباية** في `config/economy.yaml`: الجبايةُ
 *      الرجعيّة مرفوضة، فتاريخٌ قبل الإعلان يُفشل البذرَ لا الشرطَ (RULE-005).
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROYAL_COURT, UNIT_TARGET, bootstrapState } from '../../src/index';
import { rehydrateFiscalFromJournal } from '../../src/data/rehydrate_fiscal';
import type { DurableRecord } from '../../src/data/persistence';

/** ثابت 4: بعد أحدثِ `declared_at` في نِسَب الجباية المعلنة */
const T0 = Date.parse('2026-08-23T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const FOREIGN = 'ministry:foreign_affairs';
const COMPUTE = 'external:compute-provider';
const AUDITOR = 'authority:audit_bureau';
const KIND_COMPUTE = 'contract:compute-capacity';

type State = ReturnType<typeof bootstrapState>;

function scene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rehydrate-fiscal-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = T0) => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** بذرٌ ماليٌّ كامل بالأبواب المعلنة: إصدارٌ وحرقٌ وبندٌ وصرفٌ وجبايةٌ وحسابٌ ودفعةٌ وخطر */
function seed(s: State, now = T0): void {
  const royal = (target: string) => s.king.issueCommand('amend_policy', target, { kind: 'external' }, now);
  const royalOpen = (target: string) => s.king.issueCommand('open_external_account', target, { kind: 'external' }, now);

  s.ministries.establish(royal(FOREIGN), {
    ministryId: FOREIGN, name: 'وزارة الخارجية', mandate: ['foreign_affairs'],
    proposedBy: ROYAL_COURT,
  }, now);
  for (const cp of s.externalConfig.counterparties) {
    s.egress.declare(royalOpen(cp.host), {
      host: cp.host, port: cp.port, purpose: cp.purpose,
      expiresAt: now + 60 * DAY, maxCallsPerMinute: 60,
    }, now);
  }

  const issued = s.unit.issue(royal(UNIT_TARGET), 100_000_000, 'رأس مال تشغيلي معلن', now);
  assert.equal(issued.ok, true, 'الإصدار شرطُ ما بعده');
  assert.equal(s.unit.burn(royal(UNIT_TARGET), 4_000_000, 'إتلاف معلن', now).ok, true);

  const declared = s.budget.declare(royal('budget:foreign'), {
    line: 'budget:foreign', owner: FOREIGN, ceiling: 60_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now);
  assert.equal(declared.ok, true, 'البند شرطُ الصرف');

  s.ledger.openAccount('expense:operations', 'expense', 'تشغيل معلن', now);
  const disbursed = s.treasury.disburse({
    line: 'budget:foreign', amount: 1_500_000, to: 'expense:operations',
    purpose: 'تشغيل معلن ضمن بند قائم', by: 'ministry:finance',
  }, now + 2);
  assert.equal(disbursed.ok, true, 'الصرف شرطُ ما يُقاس');

  const levy = s.revenue.assess('compute_usage', COMPUTE, 2_000_000, now, now);
  assert.equal(levy.ok, true, 'التقدير شرطُ التحصيل');
  if (levy.ok) assert.equal(s.revenue.collect(levy.levy.levyId, now).ok, true);

  const opened = s.externalAccounts.open(royalOpen(COMPUTE), {
    counterparty: COMPUTE, expiresAt: now + 90 * DAY, requestedBy: FOREIGN,
    justification: 'تشغيل معلن ضمن نطاق وزارة الخارجية',
  }, now);
  assert.equal(opened.ok, true, 'الحساب شرطُ الدفعة');
  const paid = s.payments.pay({
    accountId: COMPUTE, amount: 300_000, line: 'budget:foreign',
    purpose: 'سعة حساب معلنة', requestedBy: FOREIGN,
  }, now);
  assert.equal(paid.ok, true, 'الدفعة مقيسة في التقرير');

  const assessed = s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: [], assessedBy: AUDITOR,
    justification: 'تقدير معلن لنوع عقد قائم',
  }, now);
  assert.equal(assessed.ok, true, 'التقدير واقعةٌ تُدوَّن');
  // T-67: الإخلالُ يُنسب إلى عقدٍ قائمٍ لا إلى النظيرِ جملةً — فيُوقَّع أوّلًا
  const contract = s.contracts.sign(
    s.king.issueCommand('open_external_account', KIND_COMPUTE, { kind: 'external' }, now),
    {
      kindId: KIND_COMPUTE, value: 3_000_000, endsAt: now + 30 * 24 * 60 * 60 * 1000,
      proposedBy: FOREIGN, purpose: 'تعهّد معلن ينجو الإقلاع',
    }, now,
  );
  assert.equal(contract.ok, true, 'العقد المُخِلّ يجب أن يقوم أوّلًا');
  if (!contract.ok) return;
  assert.equal(
    s.partnerRisk.noteBreach(AUDITOR, contract.contract.contractId, 'تأخر تسليم معلن', now), true,
  );
}

test('T-125: الماليّةُ والنافذةُ الخارجيّةُ تنجو الإقلاع — لا صفرَ بعد اليوم', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    seed(first);
    const before = {
      treasury: first.treasury.report(),
      budget: first.budget.report(),
      revenue: first.revenue.report(),
      unit: first.unit.report(),
      accounts: first.externalAccounts.report(T0),
      payments: first.payments.report(T0),
      risk: first.partnerRisk.report(T0),
    };
    assert.equal(before.budget.spent, 1_800_000, 'المستهلَك = صرفٌ + دفعةٌ خارجيّة');
    assert.equal(before.unit.issued, 100_000_000);

    const second = sc.boot(T0 + DAY);
    // الرقمُ المقيس قبل البند: كلُّ هذه كانت 0
    assert.equal(second.treasury.report().disbursements, before.treasury.disbursements);
    assert.equal(second.treasury.report().totalDisbursed, before.treasury.totalDisbursed);
    assert.equal(second.budget.report().spent, 1_800_000, 'المستهلَك لا يُنسى');
    assert.equal(second.budget.report().active, before.budget.active);
    assert.equal(second.revenue.report().collectedTotal, before.revenue.collectedTotal);
    assert.equal(second.revenue.report().collected, 1);
    assert.equal(second.unit.report().issued, 100_000_000);
    assert.equal(second.unit.report().burned, 4_000_000);
    assert.equal(second.unit.report().consistent, true, 'العدّادُ مرآةُ الدفتر');
    assert.equal(second.externalAccounts.report(T0 + DAY).opened, before.accounts.opened);
    assert.equal(second.payments.report(T0 + DAY).payments, 1);
    assert.equal(second.partnerRisk.report(T0 + DAY).assessments, before.risk.assessments);
    assert.equal(second.partnerRisk.report(T0 + DAY).breaches, 1);

    const report = second.rehydratedFiscal;
    assert.notEqual(report, null, 'التقريرُ يُكشف فلا يُدَّعى الإرجاع');
    assert.deepEqual(report?.silent, [], 'لا نظامَ صامتًا بعد التوسيع');
    assert.equal(report?.budgetLines, 1);
    assert.equal(report?.disbursements, before.treasury.disbursements);
  } finally {
    sc.clean();
  }
});

test('T-125: السقفُ لا يُعاد تعبئتُه بإقلاع — والصرفُ يبقى ممكنًا بعده', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const second = sc.boot(T0 + DAY);

    // كان قبل البند: `available` تعود 60,000,000 كأنّ شيئًا لم يُصرف — خلقُ قدرةِ صرف.
    assert.equal(second.budget.available('budget:foreign'), 60_000_000 - 1_800_000);

    // وكان الصرفُ بعد الإقلاع مرفوضًا أصلًا: «لا صرف بلا بند موازنة قائم».
    const again = second.treasury.disburse({
      line: 'budget:foreign', amount: 500_000, to: 'expense:operations',
      purpose: 'تشغيل معلن بعد الإقلاع', by: 'ministry:finance',
    }, T0 + DAY);
    assert.equal(again.ok, true, 'الدولةُ تصرف بعد إعادة التشغيل');
    assert.equal(second.budget.report().spent, 2_300_000);

    // ومعرّفُ المصروف لا يتصادم بقيدٍ قائم: العدّادُ ارتفع بالإرجاع لا عاد صفرًا.
    assert.equal(second.treasury.report().disbursements, 3);
  } finally {
    sc.clean();
  }
});

test('T-125: التجميدُ ينجو الإقلاع — حرسٌ لا يُفكّ بإعادة تشغيل', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    seed(first);
    const frozen = first.treasury.freeze(
      first.king.issueCommand('declare_emergency', 'treasury:general', { kind: 'external' }, T0),
      'شبهةٌ معلنة تستوجب الوقف', T0,
    );
    assert.equal(frozen.ok, true);

    const second = sc.boot(T0 + DAY);
    assert.equal(second.treasury.isFrozen(), true, 'التجميدُ حالةٌ تُدوَّن لا ذاكرةُ عمليّة');
    assert.equal(second.rehydratedFiscal?.treasuryFrozen, true);
    const refused = second.treasury.disburse({
      line: 'budget:foreign', amount: 1_000, to: 'expense:operations',
      purpose: 'محاولة صرف من خزينة مجمَّدة', by: 'ministry:finance',
    }, T0 + DAY);
    assert.equal(refused.ok, false, 'خزينةٌ مجمَّدةٌ لا تصرف ولو بعد إقلاع');
  } finally {
    sc.clean();
  }
});

test('T-125: اليوميّةُ لا تتضاعف بالإقلاع — الوسيطُ يُربط بعد الإرجاع', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    seed(first);
    const FISCAL = new Set([
      'treasury_disbursement', 'treasury_state', 'budget_appropriation', 'tax_levy',
      'unit_supply', 'external_account', 'external_payment', 'partner_assessment',
      'partner_breach',
    ]);
    const fiscalCount = (s: State): number =>
      (s.journal?.read() ?? []).filter((r) => FISCAL.has(r.kind)).length;

    const afterSeed = fiscalCount(first);
    assert.ok(afterSeed > 0, 'البذرُ يُدوَّن');

    // لو رُبط الوسيطُ قبل الإرجاع لأُعيد تدوينُ كلِّ ما استُعيد فتضاعف العدد إقلاعًا بعد إقلاع.
    const audits = (s: State): number =>
      (s.journal?.read() ?? []).filter((r) => r.kind === 'audit_entry').length;
    const second = sc.boot(T0 + DAY);
    assert.equal(fiscalCount(second), afterSeed, 'إقلاعٌ لا يُدوَّن فيه قيدٌ ماليٌّ جديد');
    // يُقرأ **قبل** الإقلاع الثالث: القراءةُ من الملف لا لقطةٌ مجمَّدة في الكائن.
    const auditsAfterSecond = audits(second);
    const third = sc.boot(T0 + 2 * DAY);
    assert.equal(fiscalCount(third), afterSeed, 'ولا في الثالث');
    assert.equal(third.journal?.verify().valid, true, 'السلسلةُ سليمةٌ بعد ثلاثة إقلاعات');

    // انحرافٌ يُعلن (RULE-008): اليوميّةُ **تنمو** بكلِّ إقلاعٍ نموًّا محدودًا، لأنّ كلَّ
    // بابِ إرجاعٍ يُقيّد استعادتَه في السجل الأبديّ (RULE-006) والسجلُّ مُدوَّنٌ منذ T-27.
    // فالنموُّ سبعةُ قيودٍ لسبعة أنظمةٍ لا تضاعُفُ حالةٍ — وذاك تاريخٌ يُطلب لا حشوٌ.
    assert.ok(audits(third) > auditsAfterSecond, 'إقلاعُ الإرجاع نفسُه واقعةٌ تُقيَّد');
  } finally {
    sc.clean();
  }
});

test('T-125: أبوابُ الإرجاع ترفض ما لا يُصدَّق — لا استعادةَ حالةٍ محرَّمة', () => {
  const sc = scene();
  try {
    const s = sc.boot();
    seed(s);
    const line = s.budget.get('budget:foreign')!;

    // سقفٌ فوق السقف الكلّي المعلن في config/economy.yaml (ثابت 4 في budget.ts)
    assert.throws(
      () => s.budget.restore([{ ...line, ceiling: Number.MAX_SAFE_INTEGER }], 'ministry:data'),
      (e: Error) => e.message === 'RECOVERY_BUDGET_CEILING_TOTAL',
    );
    // مصروفٌ فوق سقف بنده: حالةٌ لا تُنتجها بوابةُ الحجز، فلا تُستعاد
    assert.throws(
      () => s.budget.restore([{ ...line, spent: line.ceiling + 1 }], 'ministry:data'),
      (e: Error) => e.message === 'RECOVERY_BUDGET_OVERSPENT',
    );
    // عدّادٌ يخالف الدفتر: العدّادُ مرآةٌ لا حجّةٌ فوقه
    assert.throws(
      () => s.unit.restore(1_000, 0, 'ministry:data'),
      (e: Error) => e.message === 'RECOVERY_UNIT_INCONSISTENT',
    );
    assert.throws(
      () => s.unit.restore(5, 9, 'ministry:data'),
      (e: Error) => e.message === 'RECOVERY_UNIT_COUNTER_INVALID',
    );
    // مصروفٌ بلا قيدٍ في الدفتر: دعوى صرفٍ بلا شاهد
    assert.throws(
      () => s.treasury.restore({
        disbursements: [{ ...s.treasury.history()[0]!, entryId: 'disb:لا-وجود-له' }],
        frozen: false, frozenReason: null, sequence: 9,
      }, 'ministry:data'),
      (e: Error) => e.message === 'RECOVERY_TREASURY_ENTRY_MISSING',
    );
    // حسابٌ خارجيٌّ لنظيرٍ غير معلن في التهيئة (RULE-005)
    assert.throws(
      () => s.externalAccounts.restore(
        [{ ...s.externalAccounts.list()[0]!, accountId: 'external:نظيرٌ-مختلق' }], 'ministry:data',
      ),
      (e: Error) => e.message === 'RECOVERY_ACCOUNT_UNDECLARED',
    );
    // نوعُ خطرٍ غير معلن: نوعٌ يُمحى من التهيئة لا يُعاد إحياؤه بيوميّةٍ قديمة
    assert.throws(
      () => s.partnerRisk.restore(
        [{ ...s.partnerRisk.history()[0]!, kindId: 'contract:مختلق' }], [], 0, 'ministry:data',
      ),
      (e: Error) => e.message === 'RECOVERY_RISK_KIND_UNDECLARED',
    );
    // دفعةٌ لحسابٍ لا وجودَ له: أجلٌ لا يُطالب به أحد
    assert.throws(
      () => s.payments.restore(
        [{ ...s.payments.history()[0]!, accountId: 'external:لا-حساب' }], 0, 'ministry:data',
      ),
      (e: Error) => e.message === 'RECOVERY_PAYMENT_ACCOUNT_MISSING',
    );
  } finally {
    sc.clean();
  }
});

test('T-53/مجلس 2: سجلُّ نِسَبِ الجبايةِ ينجو الإقلاع — من قيودِ السجلِ الأبديِّ لا من الذاكرة (RATE_AMENDMENT_HISTORY_NOT_DURABLE)', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    const at = T0 + 3 * 60 * 1000;
    const cmd = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    const amended = first.revenue.amendRate(cmd, 'compute_usage', 40, at);
    assert.equal(amended.ok, true, 'التعديل شرطُ القياس');
    // واقعةٌ تُقدَّرُ بالنسبةِ الجديدةِ فتشهدُ السجلُّ أثرَه
    const levy = first.revenue.assess('compute_usage', 'external:compute-provider', 2_000_000, at + 1, at + 1);
    assert.equal(levy.ok, true, 'التقدير بالنسبة الجديدة شرطُ الشاهد');

    const second = sc.boot(T0 + DAY);
    const history = second.revenue.rateHistoryOf('compute_usage');
    assert.equal(history.length, 2, 'إعلانُ التهيئة + التعديل');
    assert.equal(history[1]?.ratePerMille, 40, 'الإعلانُ التشغيليُّ 40‰ لم يُمحَ بالإقلاع');
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'النسبةُ الحاكمةُ بعد الإقلاع');
    assert.equal(second.rehydratedFiscal?.rateAmendments, 1, 'تقريرُ الإرجاعِ يشهدُ بالتعديل');
    // والأمرُ المنفَّذُ قبلَ الإقلاعِ لا يُنفَّذُ ثانيةً بعدَ تعديلٍ لاحق
    const at2 = T0 + DAY + 60_000;
    const cmd60 = second.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 60 }, at2);
    assert.equal(second.revenue.amendRate(cmd60, 'compute_usage', 60, at2).ok, true, 'تعديلٌ لاحقٌ بعد الإقلاع');
    const replay = second.revenue.amendRate(cmd, 'compute_usage', 40, T0 + DAY + 120_000);
    assert.equal(replay.ok, false, 'إعادةُ الأمرِ القديمِ مرفوضة');
    assert.match(replay.ok ? '' : replay.reason, /نُفّذ سابقًا/);
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 60, 'لا رجوعَ بالأمر المُعاد');
  } finally {
    sc.clean();
  }
});

test('T-53/مجلس 3: شاهدُ rate_amended التالفُ يُسقط الإرجاعَ برمزٍ مسمًّى ولا يُسقَطُ صمتًا (RATE_AMENDMENT_MALFORMED_AUDIT_BYPASS)', () => {
  const sc = scene();
  try {
    const s = sc.boot();
    const at = T0 + 60_000;
    const good = { base: 'compute_usage', from: 30, to: 40, effectiveFrom: at, commandId: 'cmd:probe-1' };
    const entry = (detail: unknown): DurableRecord => ({
      seq: 1, at, kind: 'audit_entry', prevHash: '0', hash: '1',
      payload: { kind: 'rate_amended', detail },
    });
    const run = (detail: unknown) => rehydrateFiscalFromJournal([entry(detail)], { revenue: s.revenue }, 'ministry:data');
    // مسبارُ gpt في الجلسة 3 بحرفه — كان RESULT { rateAmendments: 0 } بلا رمي
    assert.throws(() => run({ ...good, to: 'not-a-number' }), (e: Error) => e.message === 'RECOVERY_RATE_INVALID');
    // مسبارُ grok: قيدٌ بلا commandId
    const { commandId: _drop, ...noCommand } = good;
    assert.throws(() => run(noCommand), (e: Error) => e.message === 'RECOVERY_RATE_COMMAND_ID_MISSING');
    assert.throws(() => run({ ...good, effectiveFrom: 'أمس' }), (e: Error) => e.message === 'RECOVERY_RATE_DECLARED_AT_INVALID');
    assert.throws(() => run(null), (e: Error) => e.message.startsWith('RECOVERY_RATE_BASE_UNDECLARED'));
    assert.throws(() => run({ ...good, base: 'لا-وعاء' }), (e: Error) => e.message === 'RECOVERY_RATE_BASE_UNDECLARED:لا-وعاء');
    assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 1, 'الرفضُ لا يُغيّر السجل');
    // سالبةُ الضبط: الشاهدُ السليمُ نفسُه يُرجَع
    assert.equal(run(good).rateAmendments, 1);
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40);
  } finally {
    sc.clean();
  }
});

test('T-53/مجلس 5: شاهدان بمعرّفِ أمرٍ واحدٍ ونسبتَين مختلفتَين يُرفضان برمزٍ مسمًّى — لا يُمحى الثاني بصمت (RATE_AMENDMENT_DUPLICATE_COMMAND_CONFLICT_SILENT_SKIP)', () => {
  const sc = scene();
  try {
    const s = sc.boot();
    const at = T0 + 60_000;
    const first = { base: 'compute_usage', from: 30, to: 80, effectiveFrom: at, commandId: 'cmd:dup-1' };
    const second = { base: 'compute_usage', from: 30, to: 90, effectiveFrom: at + 60_000, commandId: 'cmd:dup-1' };
    const entry = (detail: unknown, seq: number): DurableRecord => ({
      seq, at, kind: 'audit_entry', prevHash: String(seq - 1), hash: String(seq),
      payload: { kind: 'rate_amended', detail },
    });
    // شاهدان بمعرّفٍ واحد وحمولتَين مختلفتَين — كان يُمحى الثاني بلا رمز
    assert.throws(
      () => rehydrateFiscalFromJournal([entry(first, 1), entry(second, 2)], { revenue: s.revenue }, 'ministry:data'),
      (e: Error) => e.message === 'RECOVERY_RATE_COMMAND_CONFLICT:cmd:dup-1',
    );
    // الشاهدُ الأول طُبِّق والثاني رُفض — فالنسبةُ 80‰ لا 90‰
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 80, 'الشاهدُ المرفوضُ لم يُطبَّق');
    const same = { base: 'compute_usage', from: 30, to: 80, effectiveFrom: at, commandId: 'cmd:dup-1' };
    const report = rehydrateFiscalFromJournal([entry(first, 1), entry(same, 2)], { revenue: s.revenue }, 'ministry:data');
    assert.equal(report.rateAmendments, 2, 'الإعادةُ الأمينةُ: شاهدان شُوهِدا ولا رميَ');
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 80, 'والإعادةُ لم تُكرَّر');
  } finally {
    sc.clean();
  }
});
