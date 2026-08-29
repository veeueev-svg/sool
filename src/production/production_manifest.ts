/**
 * src/production/production_manifest.ts — بيان التشغيل الاتحادي (المرحلة 37)
 * المالك: الديوان الملكي يُعلن، وديوان التدقيق يراقب — ولا يوفَّق بينهما عند التعارض
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: `deploy/production/manifest.yaml` و`deploy/production/runbooks/*.yaml`
 * المخرجات: بيان مُتحقَّق منه مقابل `config/production.yaml`، وكتب خطوات معلنة
 * التبعيات: loadYamlFile, ProductionConfig, loadDeclaredRunbook (تُعاد استعمالًا لا نسخًا)
 * الصلاحيات: القراءة والرفض؛ ولا يُشغّل البيان شيئًا بنفسه
 * السجلات: لا تسجّل الوحدة — من يقرأ البيان هو من يُقيّد قراءته
 * ثوابت هذه الوحدة:
 *   1) **البيان يُقابل بالتهيئة**: ماسحٌ أو كتابٌ في البيان لا يوافق التهيئة تعارضٌ
 *      يُسقط الإقلاع — لأن السياسة واحدة لا اثنتان (RULE-005)
 *   2) **الأقاليم المُعلنة في البيان هي المشترطة نفسها**: بيانٌ ينقص إقليمًا يُخفي
 *      شرط قبولٍ كاملًا
 *   3) **المشغّل ليس المراقب** (RULE-004)
 *   4) **الإعلان بلا خطوات لا يُعدّ كتابًا**: يُعاد استعمال مُحقِّق الخطوات نفسه
 *      المستعمل في المرحلة 36، فلا يُقاس كتابان بمقياسين
 * حالات الفشل (كلها مغلقة): ملف غائب/بلا عقدة/بيئة مخالفة/مشغّل غير معلن/مراقب مخالف/
 *   بلا سبب/ماسحات مخالفة/كتب مخالفة/أقاليم مخالفة ⇒ رفض صريح برمز
 * اختبار القبول: tests/production/production_manifest.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { EntityId, SovereignViolation } from '../kernel/types';
import {
  loadYamlFile, ProductionConfig, ScannerKind, PRODUCTION_OPERATORS, ascendToDeclaredDir,
} from '../kernel/config';

export interface ProductionManifest {
  readonly environment: string;
  readonly operator: EntityId;
  readonly observer: EntityId;
  readonly reason: string;
  readonly regions: readonly EntityId[];
  readonly scanners: readonly ScannerKind[];
  readonly runbooks: readonly string[];
}

/** يبحث عن مجلد نشر التشغيل الاتحادي صعودًا — كما تفعل نظيرتها في المرحلة 36 */
export function resolveProductionDeployDir(startDir = __dirname): string {
  // T-145: المصعدُ مشتركٌ، **والدليلُ والرمزُ غيرُ دليلِ نطيرتِها ورمزِها — والفرقُ
  // محفوظٌ لا مُسوَّى**: توحيدُ رمزٍ أو شرطٍ تغييرُ عقدٍ يحكم فيه المراجع (RULE-004).
  return ascendToDeclaredDir({
    sentinel: ['deploy', 'production', 'manifest.yaml'],
    result: ['deploy', 'production'],
    code: 'PRODUCTION_MANIFEST_DEPLOY_DIR_MISSING',
    message: 'مجلد النشر غير موجود: deploy/production',
  }, startDir);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

/** ثوابت 1 و2 و3 */
export function loadProductionManifest(
  production: ProductionConfig,
  deployDir = resolveProductionDeployDir(),
): ProductionManifest {
  const path = join(deployDir, 'manifest.yaml');
  if (!existsSync(path)) {
    throw new SovereignViolation('بيان التشغيل الاتحادي غير موجود', 'PRODUCTION_MANIFEST_MISSING');
  }
  const raw = loadYamlFile(path).manifest as ProductionManifest | undefined;
  if (!raw) {
    throw new SovereignViolation('بيان التشغيل بلا عقدة manifest', 'PRODUCTION_MANIFEST_NO_ROOT');
  }
  if (raw.environment !== 'production') {
    throw new SovereignViolation(
      `بيئة البيان ليست التشغيل الاتحادي: ${raw.environment}`,
      'PRODUCTION_MANIFEST_ENVIRONMENT_MISMATCH',
    );
  }
  if (!PRODUCTION_OPERATORS.includes(raw.operator)) {
    throw new SovereignViolation(
      `مشغّل غير معلن في البيان: ${raw.operator} (RULE-004)`,
      'PRODUCTION_MANIFEST_OPERATOR_UNDECLARED',
    );
  }
  if (raw.observer !== production.policy.observer_authority) {
    throw new SovereignViolation(
      'مراقب البيان يخالف جهة المراقبة في التهيئة — تعارضٌ يُسقط ولا يُوفَّق',
      'PRODUCTION_MANIFEST_OBSERVER_MISMATCH',
    );
  }
  if (raw.operator === raw.observer) {
    throw new SovereignViolation(
      'المشغّل هو المراقب في البيان — لا شهادة لأحد على نفسه (RULE-004)',
      'PRODUCTION_MANIFEST_OBSERVER_IS_OPERATOR',
    );
  }
  if (typeof raw.reason !== 'string' || raw.reason.trim().length < 3) {
    throw new SovereignViolation('بيان بلا سبب معلن (RULE-006)', 'PRODUCTION_MANIFEST_NO_REASON');
  }
  if (!Array.isArray(raw.regions) || !sameSet(raw.regions, [...production.policy.regions.required])) {
    throw new SovereignViolation(
      'أقاليم البيان تخالف الأقاليم المشترطة — بيانٌ يُخفي شرط قبول',
      'PRODUCTION_MANIFEST_REGIONS_MISMATCH',
    );
  }
  if (!Array.isArray(raw.scanners) || !sameSet(raw.scanners, [...production.policy.scanners])) {
    throw new SovereignViolation(
      'ماسحات البيان تخالف ماسحات التهيئة',
      'PRODUCTION_MANIFEST_SCANNERS_MISMATCH',
    );
  }
  if (!Array.isArray(raw.runbooks) || !sameSet(raw.runbooks, [...production.policy.runbooks])) {
    throw new SovereignViolation(
      'كتب البيان تخالف كتب التهيئة',
      'PRODUCTION_MANIFEST_RUNBOOKS_MISMATCH',
    );
  }
  return {
    environment: raw.environment,
    operator: raw.operator,
    observer: raw.observer,
    reason: raw.reason.trim(),
    regions: [...raw.regions],
    scanners: [...raw.scanners],
    runbooks: [...raw.runbooks],
  };
}
