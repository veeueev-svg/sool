/**
 * src/services/research/research_guards.ts — حرَسُ مدخل البحث: الشرطُ دالّةٌ تُقرأ لا كتلةٌ تُقلَّب (المرحلة 39، البند T-113)
 * المالك: وزارة البحث (والحرَس مقروءٌ للمدقّق وحده في ملفه)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمرٌ ملكيٌّ موقَّع + `ResearchInput` + لحظةٌ + تهيئةُ الوحدة + مِجساتُ حالٍ للقراءة فقط
 * المخرجات: `null` إن جاز إقامةُ البحث، أو **وصفُ الرفض** (`code` و`reason` و`extra`) —
 *          والرفضُ **يُقيَّده المُنادي** في السلسلة بحدثه المعلن `human_research_refused`
 * التبعيات: `./research_types` فقط — لا سجلَّ ولا بوابةَ ولا وقتًا تقرؤه من نفسها
 * الصلاحيات (RULE-004): الحرَسُ لا يعتمد ولا ينفّذ؛ يرجع سببًا ويكتبه صاحبُ الدور
 * السجلات: لا يكتب الحرَس سجلًّا — والمِجسُّ `activeCount` هو نفسه نداءُ `active(now)` في الصنف
 *          فيبقى أثرُ القراءة في السلسلة كما كان عددًا وترتيبًا
 * حالات الفشل (كلها مغلقة): جهةٌ غير الباحث المعلن ⇒ رفض؛ معرّفٌ أو قسمٌ أو وظيفةٌ أو مستفيدٌ
 *          أو غرضٌ أو مدةٌ أو سقفٌ أو نوعُ دراسةٍ أو خروجٌ أو مصدرٌ أو مسارُ تاجٍ مخالف ⇒ رفض
 * اختبارات الوحدة: tests/services/human_research.test.ts
 * اختبار القبول: tests/services/research_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0014-human-research.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **نصٌّ منقولٌ حرفيًّا** من `HumanResearchRegistry.start` بترتيبِ شروطه نفسِه ورموزِه
 *    نفسِها ونصوصِه نفسِها — بلا إصلاحٍ ولا تحسين. **وترتيبُ الشروط سلوكٌ لا تنسيق**: أوّلُ
 *    شرطٍ يقع هو الرمزُ الذي يراه الفاعل، ومن أعاد ترتيبها غيّر عقدًا مُختبَرًا.
 *
 * 2) **الحرَسُ دالّةٌ نقيّة**: لا يكتب سجلًّا ولا يُعدّل حالًا ولا يقرأ `Date.now()` —
 *    فيُختبَر وحده، ولا يصير بوابةً بأثرٍ خفيّ.
 *
 * 3) **الحالُ يُقرأ بمِجسّ لا بخريطة**: الحرَسُ لا يملك خرائطَ السجل، فلا يستطيع تثبيتًا
 *    ولو أراد (نظيرُ ما قرّره ADR-0032 §4 لأبواب الإرجاع: الفحصُ كلُّه قبل التثبيت).
 *
 * 4) **الاعتمادُ ليس هنا**: `gateway.authorize` يبقى في الصنف بعد رجوع `null` من هذا الحرَس،
 *    فلا تُنقل سلطةُ الإجازة إلى وحدةِ فحص (RULE-004).
 */
import { DeclaredResearchSource, HumanResearchDeps, ResearchInput } from './research_types';

/** وصفُ الرفض كما يُقيّده المُنادي: رمزٌ ونصٌّ وحقولٌ زائدةٌ معلنة */
export interface ResearchRefusal {
  readonly code: string;
  readonly reason: string;
  readonly extra?: Record<string, unknown>;
}

/** أقلُّ ما يحتاجه الحرَس من حالِ السجل — مِجساتُ قراءةٍ لا خرائط */
export interface ResearchStartState {
  readonly hasResearch: (researchId: string) => boolean;
  /** نفسُ نداء `active(now).length` في الصنف — فأثرُ القراءة في السلسلة كما كان */
  readonly activeCount: (now: number) => number;
  readonly sourceOf: (sourceId: string) => DeclaredResearchSource | undefined;
  readonly sourceInvalidated: (sourceId: string) => boolean;
  readonly allowedSourceType: (type: string) => boolean;
}

/** الأمرُ الملكيُّ كما يقرؤه الحرَس: فعلٌ وهدفٌ لا أكثر — لا توقيعَ ولا اعتماد */
export interface ResearchCommandPath {
  readonly payload: { readonly action: string; readonly target: string };
}

/**
 * حرَسُ **إقامة البحث**.
 * يُرجع `null` إن جاز مرورُ الطلب إلى بوابة التاج، أو وصفَ الرفض بترتيب الشروط المعلن.
 */
export function guardResearchStart(
  command: ResearchCommandPath,
  input: ResearchInput,
  now: number,
  deps: HumanResearchDeps,
  state: ResearchStartState,
): ResearchRefusal | null {
  const refuse = (code: string, reason: string, extra: Record<string, unknown> = {}): ResearchRefusal =>
    ({ code, reason, extra });
  if (input.researcher !== deps.researchOperator) {
    return refuse('RESEARCH_OPERATOR_REFUSED', 'إجراء البحث لوزارة البحث المعلنة وحدها (RULE-004)');
  }
  if (typeof input.researchId !== 'string' || !input.researchId.startsWith('research:')) {
    return refuse('RESEARCH_ID_REFUSED', 'معرّف البحث يجب أن يبدأ research:');
  }
  if (state.hasResearch(input.researchId)) return refuse('RESEARCH_DUPLICATE_REFUSED', 'بحث قائم بهذا المعرّف');
  if (typeof input.departmentId !== 'string' || !input.departmentId.startsWith('mirror:')) {
    return refuse('RESEARCH_DEPARTMENT_REFUSED', 'لا بحث بلا قسم مرآة معلن');
  }
  if (!deps.departmentActive(input.departmentId, now)) {
    return refuse('RESEARCH_DEPARTMENT_INACTIVE', 'قسم المرآة غير قائم أو منته أو وظيفته غير قائمة — فشل مغلق');
  }
  if (typeof input.functionMinistry !== 'string' || !input.functionMinistry.startsWith('ministry:')) {
    return refuse('RESEARCH_FUNCTION_REFUSED', 'وظيفة البحث يجب أن تكون وزارة قائمة');
  }
  if (deps.departmentFunction(input.departmentId) !== input.functionMinistry) {
    return refuse('RESEARCH_FUNCTION_MISMATCH', 'وظيفة البحث لا تطابق الوظيفة التي يعكسها قسم المرآة');
  }
  if (!input.beneficiary.startsWith(deps.beneficiaryPrefix)) {
    return refuse('RESEARCH_BENEFICIARY_SCOPE_REFUSED', 'مستفيد البحث خارج agent:* — لا سلطة على بشر');
  }
  if (typeof input.purpose !== 'string' || input.purpose.trim().length < 3) {
    return refuse('RESEARCH_PURPOSE_REFUSED', 'لا بحث بلا غرض معلن');
  }
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
    return refuse('RESEARCH_TERM_REFUSED', 'لا بحث بلا نهاية صحيحة مستقبلية');
  }
  if (input.expiresAt - now > deps.maxTermMs) {
    return refuse('RESEARCH_TERM_LIMIT_REFUSED', 'مدة البحث تتجاوز الحد المعلن ولا تقرّب', { maxTermMs: deps.maxTermMs });
  }
  if (state.activeCount(now) >= deps.maxConcurrentResearches) {
    return refuse('RESEARCH_CONCURRENCY_LIMIT', 'عدد البحوث المتزامنة بلغ الحد المعلن', {
      active: state.activeCount(now), max: deps.maxConcurrentResearches,
    });
  }
  if (input.studyType !== 'theoretical') {
    const code = input.studyType === 'survey' || input.studyType === 'questionnaire' || input.studyType === 'contact'
      ? 'RESEARCH_CONTACT_REFUSED' : 'RESEARCH_INTERVENTION_REFUSED';
    return refuse(code, 'البحث النظري وحده مسموح؛ لا تجربة ولا تدخل ولا رصد ولا مسح ولا تواصل');
  }
  if (!Number.isSafeInteger(input.egressCalls) || input.egressCalls !== 0) {
    return refuse('RESEARCH_NETWORK_EGRESS_REFUSED', 'لا خروج شبكي لجمع بيانات؛ الطلب غير الصفري مرفوض');
  }
  if (deps.maxEgressCalls !== 0) {
    return refuse('RESEARCH_EGRESS_QUOTA_REFUSED', 'حصة egress_calls ليست صفرا؛ لا بحث حتى تعود بوابة المنع الثانية');
  }
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length === 0) {
    return refuse('RESEARCH_SOURCES_REFUSED', 'لا بحث بلا مصدر وثيقة معلن');
  }
  if (input.sourceIds.length > deps.maxSourcesPerResearch) {
    return refuse('RESEARCH_SOURCE_LIMIT', 'عدد مصادر البحث يتجاوز الحد المعلن', {
      sources: input.sourceIds.length, max: deps.maxSourcesPerResearch,
    });
  }
  const seen = new Set<string>();
  for (const sourceId of input.sourceIds) {
    if (typeof sourceId !== 'string' || !sourceId.startsWith('source:')) {
      return refuse('RESEARCH_PERSONAL_DATA_REFUSED', 'بيانات شخصية أو معرف غير source:* مرفوضان صراحة', { sourceId: String(sourceId) });
    }
    if (seen.has(sourceId)) return refuse('RESEARCH_SOURCE_DUPLICATE', 'مصدر البحث مكرّر', { sourceId });
    seen.add(sourceId);
    const source = state.sourceOf(sourceId);
    if (!source || !state.allowedSourceType(source.type)) {
      return refuse('RESEARCH_SOURCE_UNDECLARED_REFUSED', 'مصدر مجهول النوع يرفض البحث كله ولا يكمله', { sourceId });
    }
    if (state.sourceInvalidated(sourceId)) {
      return refuse('RESEARCH_SOURCE_INVALIDATED', 'مصدر معلن سحبت صلاحيته؛ البحث يرفض ولا يستبدله', { sourceId });
    }
  }
  if (command.payload.action !== 'establish_research' || command.payload.target !== input.researchId) {
    return refuse('RESEARCH_CROWN_PATH_REFUSED', 'إقامة البحث بفعل establish_research وهدف مطابق فقط (RULE-003)');
  }
  return null;
}
