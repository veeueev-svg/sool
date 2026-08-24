/**
 * src/kernel/config/declaration_limits.ts — سقوفُ العدد المعلن (T-75)
 * المالك: القيّم على المستودع | المرحلة: 39 (دَينُ سقوفِ العدد)
 * المدخلات: عددٌ مقيسٌ من قائمةٍ في تهيئة | المخرجات: مرورٌ أو فشلٌ مغلق
 * حالات الفشل: عددٌ معلنٌ فوق السقف ⇒ `CONFIG_DECLARATION_OVER_CEILING` (فشل مغلق)
 *
 * **ولِمَ سكنت هذه السقوفُ الشفرةَ ولم تسكن الملفَّ الذي تحكمه؟**
 * في T-49 أُعلن سقفُ عددِ الحسابات وبنودِ الموازنة **في `config/economy.yaml`**، وكان ذلك
 * صحيحًا هناك: السقفُ يحكم عددًا **يقوم في التشغيل** بعد الإقلاع، والتهيئةُ تسبقه فتحدّه.
 * أمّا هنا فالمحكومُ هو **الإعلانُ نفسُه**. فلو كُتب `max_kinds` في `config/enterprises.yaml`
 * لكان ملفٌ فيه ألفُ نوعٍ يمرّ **بأن يكتب في نفسه `max_kinds: 1000`** — سقفٌ يوسّعه من يحكمه،
 * وهو عينُ ما يمنعه RULE-005 («لا توسّع من داخل الوحدة التي تحكمها السياسة»).
 * فالسقفُ على الإعلان **لا يُعلن في الملف الذي يحكمه**، بل يسكن النواةَ ثابتًا سياديًّا
 * كنظيره `SOVEREIGN_ACCOUNTS` — يُغيَّر بتعديل شفرةٍ تمرّ على البوابة، لا بسطرٍ في بيانات.
 *
 * **ولِمَ تُسقَفُ قوائمُ دونَ قوائم (البند T-129)؟**
 * قيس في الجلسة 48 بـ`npm run probe:declaration-scope` أنّ **49 موضعًا** في **18 محمّلًا**
 * ترفض القائمةَ الفارغة، وأنّ **16 قائمةً مفتوحةَ العدد** قَبِلت 1024 إعلانًا بلا رفضٍ واحد.
 * وقيس معها أنّ **17 قائمةً أخرى** كلُّ عنصرٍ فيها يُقابل **تعدادًا مغلقًا** في النواة
 * (`CHAOS_KNOWN_FAULTS` · `KNOWN_SOVEREIGN_ACTIONS` · `STAGING_KNOWN_WATCHES` …) فهي محدودةٌ
 * بحجمِ التعداد أصلًا؛ وسقفٌ لا يقع **ثابتٌ نائمٌ** يُطمأنُ إليه ولا يحرس، فاستُثنيت
 * مُعلنةً في `docs/audit/measurements/phase-39-T129.txt` لا مسكوتًا عنها.
 */
import { SovereignViolation } from '../types';

/**
 * سقوفُ العدد المعلن، مقيسةً على ما هو قائمٌ اليوم لا مخترعةً:
 * `config/enterprises.yaml` يعلن **4** موادَّ و**3** أنواعٍ و**4** فحوصٍ و**4** جهاتِ تعليق.
 * فالسقوفُ أدناه تُبقي متّسعًا معلنًا للنموّ **ولا تُبقي بابًا بلا حدّ** — وكلُّ رفعٍ لها
 * أثرٌ في التاريخ يقرؤه من يأتي، لا سطرٌ يمرّ في تهيئة.
 */
export const DECLARATION_CEILINGS = Object.freeze({
  /** موادُّ الإنتاج المعلنة */
  materials: 64,
  /** أنواعُ المنشآت المعلنة */
  enterprise_kinds: 32,
  /** فحوصُ الجودة المعلنة وأوزانها */
  quality_checks: 16,
  /** الجهاتُ التي تملك تعليقًا — منشأةً كانت أو قناةً خارجيّة (المُعلن اليوم: 4 و4) */
  suspend_authorities: 8,

  // البند T-129: بقيّةُ محمّلات النواة — كلُّ سقفٍ أدناه مقيسٌ من المُعلن اليوم (بين قوسين)
  // مضروبًا بمدًى يلائم نموَّ مجاله، مُدوّرًا إلى قوّةِ اثنين. وما كان مجالُه أوسعَ
  // (وثائقُ بحثٍ · نظائرُ خارجيّةٌ · قنواتٌ) تُرك له مدًى أوسع.

  /** أقاليمُ الاتحاد المعلنة — `config/regions.yaml` (4) */
  regions: 32,
  /** موارِدُ الحصص المعلنة — `config/quotas.yaml` (4) */
  quota_resources: 32,
  /** أوعيةُ الرسوم المعلنة — `config/economy.yaml` (3) */
  revenue_rates: 32,
  /** النظائرُ الخارجيّةُ المعلنة — `config/external.yaml` (3)؛ مجالٌ يُتوقّع أن يكثر */
  counterparties: 64,
  /** عواملُ تقدير مخاطر العقود وأوزانُها — `config/contracts.yaml` (5) */
  contract_risk_factors: 16,
  /** أنواعُ العقود المعلنة — `config/contracts.yaml` (3) */
  contract_kinds: 32,
  /** مصادرُ بيانات الخدمات المعلنة — `config/services.yaml` (5) */
  service_sources: 32,
  /** عملياتُ الخدمة الواحدة — `config/services.yaml` (2 لكلّ خدمة) */
  service_operations: 32,
  /** وثائقُ مصادر البحث المعلنة — `config/research.yaml` (3)؛ مجالٌ يُتوقّع أن يكثر */
  research_sources: 64,
  /** القنواتُ المعلنة — `config/channels.yaml` (2)؛ مجالٌ يُتوقّع أن يكثر */
  channels: 64,
  /** أنواعُ التفاعل في القناة الواحدة — `config/channels.yaml` (2 و1) */
  channel_kinds: 16,
  /** مشتركو القناة الواحدة — `config/channels.yaml` (2 و3) */
  channel_participants: 32,
  /** أبوابُ السلامة المشترطة — `config/inference.yaml` (8) */
  safety_categories: 32,
  /** المنافذُ البنيويّةُ المعلنة — `config/confinement.yaml` (2)؛ وكلُّ منفذٍ يُدرَج في منشور المنع */
  infrastructure_ports: 16,
});

/** اسمُ سقفٍ معلن — لا يُحرس عددٌ بسقفٍ مصنوعٍ في موضع النداء */
export type DeclarationCeiling = keyof typeof DECLARATION_CEILINGS;

/**
 * يحرس عددًا معلنًا بسقفه السياديّ.
 * **والرفضُ يحمل العددَين مقيسَين** (`N/M`) لا نصًّا عامًّا: من بلغ سقفًا يجب أن يقرأ
 * كم أعلن وكم السقف، وإلّا صار الحاجزُ لغزًا يُحلّ بقراءة الشفرة.
 * @param ceiling اسمُ السقف السياديّ
 * @param count العددُ المقيسُ من التهيئة
 * @param label ما يُسمّى في نصّ الرفض (عربيّةً، فالرسالةُ تُقرأ لا تُحلَّل)
 */
export function guardDeclaredCount(
  ceiling: DeclarationCeiling, count: number, label: string,
): void {
  const max = DECLARATION_CEILINGS[ceiling];
  // ثابتٌ قابلٌ للوقوع: سقفٌ صفرٌ أو سالبٌ يُقعد الدولةَ عن الإقلاع، فيُردّ في مكانه
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new SovereignViolation(
      `سقفُ إعلانٍ غيرُ صالحٍ في النواة: ${ceiling}`, 'CONFIG_DECLARATION_CEILING_INVALID',
    );
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new SovereignViolation(
      `عددٌ غيرُ مقيسٍ في التهيئة: ${label}`, 'CONFIG_DECLARATION_COUNT_UNMEASURED',
    );
  }
  if (count > max) {
    throw new SovereignViolation(
      `${label} فوق السقف المعلن — بلغ: ${count}/${max}. `
      + 'السقفُ على العدد المعلن يسكن النواةَ لا الملفَّ الذي يحكمه (RULE-005)',
      'CONFIG_DECLARATION_OVER_CEILING',
    );
  }
}
