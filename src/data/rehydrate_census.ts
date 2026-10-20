/**
 * src/data/rehydrate_census.ts — حصرُ إرجاعِ أصنافِ اليوميّة (المرحلة 39، البند W-2026-040)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: `DURABLE_KINDS` من تهيئة الثبات، ونطاقُ التدوين المعلن في config/persistence.yaml
 * المخرجات: تقريرُ حصرٍ مقروء، وسقوطٌ مُسمًّى عند الإقلاع إن كان في النطاق صنفٌ بلا دعوى
 * التبعيات: أنواعُ النواة وتهيئةُ الثبات فقط — لا نظامَ ملفاتٍ ولا وحدةَ حالة (فلا حلقةَ استيراد)
 * الصلاحيات: يقرأ ويحكم؛ لا يُدوّن قيدًا ولا يُصلح نطاقًا ولا يُنشئ مستهلكًا
 * السجلات: لا يكتب سجلًّا — حكمُه استثناءٌ سياديٌّ أو تقريرٌ يُطبع في المسبار
 * حالات الفشل (كلها مغلقة):
 *   - صنفٌ في النطاق بلا مستهلكِ إرجاعٍ ولا إعفاءٍ مُعلَن ⇒ PERSISTENCE_REHYDRATE_KIND_UNCLAIMED
 *   - صفٌّ في جدول الدعاوى لصنفٍ ليس في `DURABLE_KINDS` ⇒ PERSISTENCE_REHYDRATE_CLAIM_STALE
 *   - صنفٌ مكرّرٌ في جدول الدعاوى ⇒ PERSISTENCE_REHYDRATE_CLAIM_DUPLICATE
 *   - إعفاءٌ بسببٍ خارج المُعجم المغلق ⇒ PERSISTENCE_REHYDRATE_EXEMPTION_UNKNOWN
 *   - صفٌّ بمستهلكٍ وإعفاءٍ معًا، أو بلا واحدٍ منهما ⇒ PERSISTENCE_REHYDRATE_CLAIM_NOT_EXCLUSIVE
 * اختبارات الوحدة: tests/data/rehydrate_census.test.ts
 * اختبار القبول: tests/data/durable_rehydrate.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · القياسُ الخام: docs/test-reports/phase-39-W-2026-040-measurements.txt
 * ثوابت هذه الوحدة:
 *   1) **لكلِّ صنفٍ دعوى واحدةٌ مغلقة**: إمّا مستهلكُ إرجاعٍ مسمًّى بمساره، وإمّا إعفاءٌ بسببٍ
 *      من مُعجمٍ مغلق. ولا حالةَ ثالثة اسمُها «معلومٌ ضمنًا» — فالضمنيُّ هو الذي أنتج العلّة.
 *   2) **الحصرُ يُقاس على النطاق لا على الجدول**: من وسّع `scope` في التهيئة ولم يُضف صفًّا
 *      هنا يسقط عند الإقلاع. والعكسُ صحيح: صفٌّ لصنفٍ لا وجودَ له في التعداد يسقط أيضًا،
 *      وإلّا صار الجدولُ ذاكرةً لأصنافٍ ماتت (RULE-001: لا حرسَ على معدوم).
 *   3) **السقوطُ قبل أوّلِ إرجاع**: يُنادى الحصرُ قبل قراءةِ قيدٍ واحد، لأنّ إرجاعًا ناقصًا
 *      يُنتج دولةً تظنُّ نفسَها كاملةً — وهو أسوأُ من دولةٍ ترفض الإقلاع.
 *   4) **الحصرُ لا يُنشئ مستهلكًا**: يُعلن ما هو قائمٌ في الشفرة. ولو أنشأ لصار حكمًا على
 *      عملِ نفسِه — وذلك ما تمنعه RULE-004.
 *   6) **الجدولُ يُحقَن ليُكذَّب الحاجزُ نفسُه**: `censusRehydrate` و`assertRehydrateCensus`
 *      تأخذان جدولَ الدعاوى وسيطًا افتراضيُّه الجدولُ الحقيقيّ. وذلك ليس بابًا خلفيًّا بل
 *      شرطُ برهان: حاجزٌ لم يُرَ ساقطًا قطُّ ليس حاجزًا، والجدولُ الحقيقيُّ تامٌّ فلا يُسقطه
 *      شيءٌ اليوم — فلو لم يُحقَن لبقيت دعوى «يكشف الصنفَ غيرَ المُدَّعى» بلا اختبارٍ يُصدّقها.
 *   5) **الإعفاءُ ليس بابًا**: كلُّ سببِ إعفاءٍ له حرسٌ **ساكنٌ** خارجَ هذه الوحدة في
 *      `scripts/check_rehydrate_census.ts` يقرأ الشفرةَ **شجرةَ نحوٍ** ويُسقط الإعفاءَ إن بطل موجبُه.
 *      فالإعفاءُ هنا **دعوى**، وبرهانُها هناك.
 */
import { SovereignViolation } from '../kernel/types';
import { DURABLE_KINDS } from '../kernel/config/persistence';
import type { DurableKind } from '../kernel/config/persistence';

/**
 * مُعجمُ أسبابِ الإعفاء — **مغلقٌ**. سببٌ خارجَه يسقط، فلا يُعفى صنفٌ بعبارةٍ تُخترع لحظتَها.
 *   · `compaction_marker`: علامةُ ضغطٍ لا حالةَ تُستعاد — يستهلكها الضاغطُ لا المُرجِع.
 *   · `declared_without_producer`: مُعلَنٌ في النطاقِ ولا مُنتِجَ له في `src/**` — دَينٌ مُعلَن،
 *     ولا يجوز أن يبقى إعفاءً إن ظهر له مُنتِج (يُبرهن عليه الحاجزُ الساكن).
 */
export const REHYDRATE_EXEMPTION_REASONS = Object.freeze([
  'compaction_marker', 'declared_without_producer',
] as const);

export type RehydrateExemptionReason = (typeof REHYDRATE_EXEMPTION_REASONS)[number];

/** دعوى صنفٍ واحد: مستهلكٌ مسمًّى، أو إعفاءٌ بسببٍ مُعلَن — ولا ثالثَ لهما */
export interface RehydrateClaim {
  readonly kind: DurableKind;
  /** مسارُ الوحدة التي تستهلك الصنفَ عند الإرجاع، أو `null` إن كان الصنفُ مُعفًى */
  readonly consumer: string | null;
  readonly exemption: RehydrateExemptionReason | null;
  /** الحجّةُ نصًّا: تُقرأ في التقرير ولا يُبنى عليها حكمٌ آليّ */
  readonly why: string;
}

/**
 * جدولُ الدعاوى — يُحرَّر يدًا مع كلِّ صنفٍ يُضاف، وهذا هو المقصود:
 * إضافةُ صنفٍ إلى النطاقِ تُصبح فعلًا مُعلَنًا لا سطرًا في ملفِّ تهيئةٍ يُنسى أثرُه.
 */
export const REHYDRATE_CLAIMS: readonly RehydrateClaim[] = Object.freeze([
  { kind: 'audit_entry', consumer: 'src/data/persistence.ts', exemption: null, why: 'يُعاد بناءُ سلسلة السجل الأبديّ منه ثم تُستبدل ذرّيًّا' },
  { kind: 'memory_record', consumer: 'src/data/persistence.ts', exemption: null, why: 'ذاكرةُ الوكلاء تُستورد لقطةً واحدة' },
  { kind: 'memory_share', consumer: 'src/data/persistence.ts', exemption: null, why: 'مشاركاتُ الذاكرة تُستورد مع الذاكرة نفسِها' },
  { kind: 'knowledge_fact', consumer: 'src/data/persistence.ts', exemption: null, why: 'حقائقُ المعرفة تُستورد لقطةً واحدة' },
  { kind: 'archive_snapshot', consumer: null, exemption: 'declared_without_producer', why: 'مُعلَنٌ في النطاق ولا مُنتِجَ له في src/**: لقطةُ الأرشيف الملكيّ تُكتب حدثَ تدقيقٍ باسمها لا قيدَ يوميّة. دَينٌ مُعلَنٌ — إمّا يُنتَج ويُستهلَك، وإمّا يُنزع من النطاق بقرارٍ مُعلَن' },
  { kind: 'journal_compacted', consumer: null, exemption: 'compaction_marker', why: 'علامةُ ضغطٍ لا حالة: يستهلكها src/data/journal_compaction.ts عند الضغط، ولا معنى لإرجاعها حالةً عند الإقلاع' },
  { kind: 'ledger_entry', consumer: 'src/data/rehydrate_state.ts', exemption: null, why: 'قيودُ الدفتر تُعاد قيدًا قيدًا فتُبنى الأرصدةُ من مجموعها' },
  { kind: 'contract_record', consumer: 'src/data/rehydrate_state.ts', exemption: null, why: 'سجلُّ العقود وتسلسلُه يُعادان' },
  { kind: 'population_batch', consumer: 'src/data/rehydrate_state.ts', exemption: null, why: 'دفعاتُ السكان تُعاد بأعدادها' },
  { kind: 'population_terminated', consumer: 'src/data/rehydrate_state.ts', exemption: null, why: 'المنتهون يُعادون فلا يُحسبون أحياءً بعد الإقلاع' },
  { kind: 'treasury_disbursement', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'مصروفاتُ الخزينة تُعاد ويشهد الدفترُ بكلٍّ منها' },
  { kind: 'treasury_state', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'حالُ الخزينة يُعاد لقطةً' },
  { kind: 'budget_appropriation', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'بنودُ الموازنة وسقوفُها والمستهلَكُ منها تُعاد' },
  { kind: 'tax_levy', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'الجباياتُ تُعاد فلا تُجبى مرّتين' },
  { kind: 'unit_supply', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'المعروضُ من الوحدة يُعاد فلا يُصدَر فوق المُعلَن' },
  { kind: 'external_account', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'الحساباتُ الخارجيّة تُعاد بحدودها' },
  { kind: 'external_payment', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'المدفوعاتُ الخارجيّة تُعاد فتبقى الحدودُ اليوميّةُ محسوبة' },
  { kind: 'partner_assessment', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'تقييماتُ الشركاء تُعاد' },
  { kind: 'partner_breach', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null, why: 'مخالفاتُ الشركاء تُعاد فلا تُنسى سابقةٌ بإقلاع' },
  { kind: 'ministry_state', consumer: 'src/data/rehydrate_governance.ts', exemption: null, why: 'حالُ الوزارات يُعاد قبل التعيينات — حرسُ المناصب يسأل عن وزارةِ كلِّ منصب' },
  { kind: 'office_definition', consumer: 'src/data/rehydrate_governance.ts', exemption: null, why: 'تعريفاتُ المناصب تُعاد' },
  { kind: 'appointment_proposal', consumer: 'src/data/rehydrate_governance.ts', exemption: null, why: 'اقتراحاتُ التعيين تُعاد بحالها' },
  { kind: 'office_holder', consumer: 'src/data/rehydrate_governance.ts', exemption: null, why: 'أصحابُ المناصب يُعادون فلا يُجمع قضاءٌ وادّعاءٌ بإقلاع' },
]);

/** تقريرُ الحصر: أعدادٌ تُقاس وقوائمُ تُقرأ — لا حكمَ حسنٍ ولا وصف */
export interface RehydrateCensusReport {
  /** عددُ الأصناف في التعداد المغلق `DURABLE_KINDS` */
  readonly declared: number;
  /** الأصنافُ المشمولةُ بالنطاق المعلن */
  readonly inScope: readonly DurableKind[];
  /** أصنافٌ في النطاق لها مستهلكُ إرجاعٍ مسمًّى */
  readonly claimed: readonly DurableKind[];
  /** أصنافٌ في النطاق مُعفاةٌ بسببٍ من المُعجم المغلق */
  readonly exempt: readonly DurableKind[];
  /** أصنافٌ في النطاق بلا دعوى — كلُّ عضوٍ هنا سببُ سقوطٍ عند الإقلاع */
  readonly unclaimed: readonly DurableKind[];
  /** أصنافٌ لها صفٌّ في الجدول وليست في النطاق — تُذكر ولا تُسقط: النطاق تهيئةٌ تضيق وتتّسع */
  readonly outOfScope: readonly DurableKind[];
}

/** فهرسُ الدعاوى بمفتاح الصنف — يُبنى مرّةً ويُحرس بأربعةِ أبواب */
function claimIndex(claims: readonly RehydrateClaim[]): ReadonlyMap<DurableKind, RehydrateClaim> {
  const known = new Set<string>(DURABLE_KINDS);
  const index = new Map<DurableKind, RehydrateClaim>();
  for (const claim of claims) {
    if (!known.has(claim.kind)) {
      throw new SovereignViolation(
        `دعوى إرجاعٍ لصنفٍ ليس في التعداد المغلق: ${claim.kind}`,
        'PERSISTENCE_REHYDRATE_CLAIM_STALE',
      );
    }
    if (index.has(claim.kind)) {
      throw new SovereignViolation(
        `دعوى إرجاعٍ مكرّرةٌ للصنف: ${claim.kind} — دعويانِ لصنفٍ واحدٍ تُخفيان أيَّهما حكَم`,
        'PERSISTENCE_REHYDRATE_CLAIM_DUPLICATE',
      );
    }
    if (claim.exemption !== null && !REHYDRATE_EXEMPTION_REASONS.includes(claim.exemption)) {
      throw new SovereignViolation(
        `سببُ إعفاءٍ خارجَ المُعجم المغلق: ${claim.exemption} (${claim.kind})`,
        'PERSISTENCE_REHYDRATE_EXEMPTION_UNKNOWN',
      );
    }
    // **الحصرُ المتبادلُ يُنفَّذ لا يُوصَف**: الثابتُ (1) يقول «دعوى واحدةٌ مغلقة»، وكان
    // الجدولُ يقبل صفًّا بمستهلكٍ وإعفاءٍ معًا فيُخفي أيَّهما حكَم — ورفعه المراجعُ (أ)
    // بالرمز RC-CLAIM-XOR-NOT-RUNTIME-ENFORCED. فصار الحصرُ حرسًا يرمي، لا نصًّا يُقرأ.
    if ((claim.consumer !== null) === (claim.exemption !== null)) {
      throw new SovereignViolation(
        `دعوى إرجاعٍ ليست واحدةً مغلقة: ${claim.kind} — `
        + (claim.consumer !== null
          ? 'مستهلكٌ وإعفاءٌ معًا، ولا يُعرف أيُّهما حكَم'
          : 'لا مستهلكَ ولا إعفاء، وصفٌّ لا يقول شيئًا لا يُدَّعى به'),
        'PERSISTENCE_REHYDRATE_CLAIM_NOT_EXCLUSIVE',
      );
    }
    index.set(claim.kind, claim);
  }
  return index;
}

/**
 * يحصر النطاقَ المُعلَنَ مقابلَ جدول الدعاوى. يقرأ ولا يرمي إلّا على فسادِ الجدولِ نفسِه —
 * أمّا حكمُ «صنفٌ بلا دعوى» فيُترك لـ`assertRehydrateCensus` ليُقاس قبل أن يُسقِط.
 */
export function censusRehydrate(
  scope: readonly DurableKind[],
  claims: readonly RehydrateClaim[] = REHYDRATE_CLAIMS,
): RehydrateCensusReport {
  const index = claimIndex(claims);
  const inScope = DURABLE_KINDS.filter((k) => scope.includes(k));
  const claimed: DurableKind[] = [];
  const exempt: DurableKind[] = [];
  const unclaimed: DurableKind[] = [];
  for (const kind of inScope) {
    const claim = index.get(kind);
    if (claim === undefined) unclaimed.push(kind);
    else if (claim.consumer !== null) claimed.push(kind);
    else exempt.push(kind);
  }
  return {
    declared: DURABLE_KINDS.length,
    inScope,
    claimed,
    exempt,
    unclaimed,
    outOfScope: DURABLE_KINDS.filter((k) => !scope.includes(k)),
  };
}

/**
 * الحاجزُ نفسُه: يُنادى عند الإقلاع **قبل** قراءةِ قيدٍ واحد. وصنفٌ في النطاقِ بلا دعوى
 * يُسقط الإقلاعَ برمزٍ مُسمًّى — لا يُدوَّن على القرصِ ثمّ يُسقَط صمتًا كما كان.
 */
export function assertRehydrateCensus(
  scope: readonly DurableKind[],
  claims: readonly RehydrateClaim[] = REHYDRATE_CLAIMS,
): RehydrateCensusReport {
  const report = censusRehydrate(scope, claims);
  if (report.unclaimed.length > 0) {
    throw new SovereignViolation(
      `أصنافٌ في نطاق التدوين بلا مستهلكِ إرجاعٍ ولا إعفاءٍ مُعلَن: ${report.unclaimed.join(', ')} — `
      + 'صنفٌ يُدوَّن على القرص ولا يُستعاد يُنتج دولةً تظنُّ نفسَها كاملة. '
      + 'يُضاف صفٌّ في REHYDRATE_CLAIMS بمستهلكٍ مسمًّى أو بإعفاءٍ بسببٍ من المُعجم المغلق، '
      + 'أو يُنزع الصنفُ من scope في config/persistence.yaml',
      'PERSISTENCE_REHYDRATE_KIND_UNCLAIMED',
    );
  }
  return report;
}

/**
 * **الإعفاءُ يُقاسُ على المكتوبِ** (W-2026-040 · معالجةُ مجلسِ المراجعةِ الثالثة): دعوى
 * `declared_without_producer` («لا مُنتِجَ له») نفيٌ لا يُحسَمُ ساكنًا في العموم — فالتحويلُ
 * عبرَ `as unknown as` يُفلتُ من نظامِ الأنواع (`COMPUTED_PRODUCER_BYPASSES_DECLARED_WITHOUT_PRODUCER`).
 * فتُقاسُ عندَ نقطةِ الاختناقِ: قيدٌ في اليوميّةِ لصنفٍ يُدّعى أن لا منتِجَ له **يُكذِّبُ الدعوى**،
 * والإقلاعُ يسقطُ برمزِه قبلَ أن يُعيدَ شيئًا — لا يُفقَدُ المكتوبُ صامتًا بإعفاءٍ كاذب.
 */
export function assertExemptionsHold(
  writtenKinds: Iterable<string>,
  claims: readonly RehydrateClaim[] = REHYDRATE_CLAIMS,
): void {
  const exempt = new Set(claims.filter((c) => c.exemption === 'declared_without_producer').map((c) => c.kind));
  const contradicted = [...new Set([...writtenKinds].filter((k) => exempt.has(k as DurableKind)))].sort();
  if (contradicted.length > 0) {
    throw new SovereignViolation(
      `أصنافٌ مُعفاةٌ بحجّةِ «لا مُنتِجَ لها» ولها في اليوميّةِ قيودٌ مكتوبة: ${contradicted.join(', ')} — `
      + 'الدعوى كاذبةٌ بشهادةِ القرص، وإرجاعٌ يتجاهلُها يُفقِدُ المكتوبَ صامتًا. يُسمّى للصنفِ '
      + 'مستهلكٌ في REHYDRATE_CLAIMS أو يُنزَعُ منتِجُه',
      'PERSISTENCE_REHYDRATE_EXEMPTION_CONTRADICTED',
    );
  }
}
