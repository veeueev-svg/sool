/**
 * src/kernel/config.ts — واجهة تهيئة الدولة (تصديرٌ فقط، لا منطق)
 * المالك: القيّم على المستودع | المرحلة: 2 (فُكّك في ورشة الهيكلة — الإصدار 0.24.0)
 * المدخلات: لا شيء | المخرجات: كل مُحمِّلات `src/kernel/config/`
 * حالات الفشل: لا شيء هنا — كل فشل مغلق يقع في وحدته المعلنة أدناه
 *
 * القاعدة: **لا يُكتب منطق في هذا الملف.** كان 2504 سطرًا يجمع ستة عشر مُحمِّلًا،
 * فصار كلُّ مُحمِّلٍ في وحدةٍ باسم نطاقه. من يضيف سياسةً جديدة يضيف ملفًا في
 * `src/kernel/config/` ويصدّره من هنا؛ ومن يضيفها هنا يعيد بناء عنق الزجاجة.
 * الخريطة والحدود: `ARCHITECTURE.md` §«حدود الحجم».
 */
export * from './config/paths';
export * from './config/yaml';
// المرحلة 39 (T-75): سقوفُ العدد المعلن — تسكن النواةَ لا الملفَّ الذي تحكمه (RULE-005)
export * from './config/declaration_limits';
export * from './config/declaration_budget';
// T-131: سجلُّ التعدادات المغلقة وحرسُها — يُقرأ من الإقلاع ومن الاختبارات
export * from './config/closed_enums';
export * from './config/declaration_reach';
export * from './config/declaration_work';
export * from './config/declaration_census';
export * from './config/royal_authority';
export * from './config/quotas';
export * from './config/regions';
export * from './config/economy';
export * from './config/external';
export * from './config/contracts';
export * from './config/enterprises';
export * from './config/services';
export * from './config/research';
export * from './config/scale';
export * from './config/recovery';
export * from './config/persistence';
export * from './config/load';
export * from './config/chaos';
export * from './config/termination';
export * from './config/staging';
export * from './config/production_policy';
export * from './config/production';
// المرحلة 39 (T-16): سياسةُ الحصر على مستوى النواة والحاوية — إكمالُ المعيار C-09
export * from './config/confinement';
export * from './config/reproduction';
export * from './config/inference';
// المرحلة 39 (T-31 · T-23): سياسةُ النية على مستوى المعاملات، والقنواتُ المعلنة — إكمالُ C-12
export * from './config/intent';
export * from './config/channels';
