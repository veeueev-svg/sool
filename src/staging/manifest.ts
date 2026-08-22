/**
 * src/staging/manifest.ts — قارئ بيان التشغيل وخطوات الكتب المعلنة (المرحلة 36)
 * المالك: الديوان الملكي يُعلن — والقارئ يرفض ما خالف التهيئة (RULE-005)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: `deploy/staging/manifest.yaml` و`deploy/staging/runbooks/*.yaml`
 * المخرجات: بيانٌ مُتحقَّق منه وخطواتٌ معلنة تُقابل بما يُنفَّذ فعلًا
 * التبعيات: `parseSimpleYaml`، `loadStaging()`
 * الصلاحيات: القراءة والرفض؛ ولا يُنفّذ القارئ خطوة ولا يُصلح إعلانًا ناقصًا
 * السجلات: لا يكتب — الرفض قبل الإقلاع يرمي `SovereignViolation` برمز معلن
 * ثوابت هذه الوحدة:
 *   1) **البيان يُقرأ أو لا يُكتب**: ملف نشرٍ لا يقرأه كود كذبٌ موثَّق — وهذا الملف
 *      يُقابَل حرفيًّا بـ`config/staging.yaml` عند كل تشغيلة
 *   2) **التعارض يُسقط ولا يُوفَّق**: بيانٌ يُعلن حرسًا لا تعلنه التهيئة يُرفض، ولا
 *      يُختار «الأشدّ» تلقائيًّا — لأن الاختيار الصامت يُخفي خطأً في أحدهما
 *   3) **لكل كتاب معلن ملف خطوات**: كتابٌ في التهيئة بلا ملف خطوات إعلانٌ بلا إجراء
 *   4) **لا خطوة بلا تحقّق معلن**: كل خطوة تُعلن `expect` — فما لا يُعلن أثره لا يُقاس
 *   5) **الأرقام متّصلة من 1**: ترقيمٌ مثقوب يعني خطوةً حُذفت من الإعلان وبقيت في الكود
 * حالات الفشل (كلها مغلقة): بيان مفقود ⇒ رفض؛ مشغّل غير معلن ⇒ رفض؛ مراقب مخالف
 *   للتهيئة ⇒ رفض؛ المشغّل هو المراقب ⇒ رفض؛ حرس مخالف ⇒ رفض؛ كتاب مخالف ⇒ رفض؛
 *   ملف خطوات مفقود ⇒ رفض؛ اسم داخل الملف مخالف لاسمه ⇒ رفض؛ خطوة بلا عنوان أو
 *   بلا `expect` ⇒ رفض؛ ترقيم مثقوب أو مكرَّر ⇒ رفض
 * اختبار القبول: tests/staging/manifest.test.ts
 * الوثيقة المرتبطة: docs/runbooks/README.md
 */
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { EntityId, SovereignViolation } from '../kernel/types';
import {
  loadYamlFile, StagingConfig, WatchKind, STAGING_OPERATORS,
} from '../kernel/config';

export interface StagingManifest {
  readonly environment: string;
  readonly operator: EntityId;
  readonly observer: EntityId;
  readonly reason: string;
  readonly watches: readonly WatchKind[];
  readonly runbooks: readonly string[];
}

export interface DeclaredStep {
  readonly n: number;
  readonly title: string;
  readonly expect: string;
}

export interface DeclaredRunbook {
  readonly name: string;
  readonly purpose: string;
  readonly steps: readonly DeclaredStep[];
}

/** يبحث عن مجلد النشر صعودًا من هذا الملف — كما يفعل `resolveConfigDir` للتهيئة */
export function resolveDeployDir(startDir = __dirname): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'deploy', 'staging', 'manifest.yaml'))) return join(dir, 'deploy', 'staging');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new SovereignViolation('مجلد النشر غير موجود: deploy/staging', 'MANIFEST_DEPLOY_DIR_MISSING');
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

/** ثوابت 1 و2: يُقابَل البيان بالتهيئة ويُرفض التعارض */
export function loadStagingManifest(staging: StagingConfig, deployDir = resolveDeployDir()): StagingManifest {
  const path = join(deployDir, 'manifest.yaml');
  if (!existsSync(path)) {
    throw new SovereignViolation('بيان التشغيل المحدود غير موجود', 'MANIFEST_MISSING');
  }
  const raw = loadYamlFile(path).manifest as StagingManifest | undefined;
  if (!raw) throw new SovereignViolation('بيان التشغيل بلا عقدة manifest', 'MANIFEST_NO_ROOT');
  if (raw.environment !== 'staging') {
    throw new SovereignViolation(
      `بيئة البيان ليست التشغيل المحدود: ${raw.environment}`, 'MANIFEST_ENVIRONMENT_MISMATCH',
    );
  }
  if (!STAGING_OPERATORS.includes(raw.operator)) {
    throw new SovereignViolation(
      `مشغّل غير معلن في البيان: ${raw.operator} (RULE-004)`, 'MANIFEST_OPERATOR_UNDECLARED',
    );
  }
  if (raw.observer !== staging.policy.observer_authority) {
    throw new SovereignViolation(
      'مراقب البيان يخالف جهة المراقبة في التهيئة — تعارضٌ يُسقط ولا يُوفَّق',
      'MANIFEST_OBSERVER_MISMATCH',
    );
  }
  if (raw.operator === raw.observer) {
    throw new SovereignViolation(
      'المشغّل هو المراقب في البيان — لا شهادة لأحد على نفسه (RULE-004)',
      'MANIFEST_OBSERVER_IS_OPERATOR',
    );
  }
  if (typeof raw.reason !== 'string' || raw.reason.trim().length < 3) {
    throw new SovereignViolation('بيان بلا سبب معلن (RULE-006)', 'MANIFEST_NO_REASON');
  }
  if (!Array.isArray(raw.watches) || !sameSet(raw.watches, [...staging.policy.watches])) {
    throw new SovereignViolation(
      'حرّاس البيان يخالفون حرّاس التهيئة', 'MANIFEST_WATCHES_MISMATCH',
    );
  }
  if (!Array.isArray(raw.runbooks) || !sameSet(raw.runbooks, [...staging.policy.runbooks])) {
    throw new SovereignViolation(
      'كتب البيان تخالف كتب التهيئة', 'MANIFEST_RUNBOOKS_MISMATCH',
    );
  }
  return {
    environment: raw.environment,
    operator: raw.operator,
    observer: raw.observer,
    reason: raw.reason.trim(),
    watches: [...raw.watches],
    runbooks: [...raw.runbooks],
  };
}

/** ثوابت 3 و4 و5: لكل كتاب ملف خطوات، ولكل خطوة عنوانٌ وأثرٌ معلن وترقيم متّصل */
export function loadDeclaredRunbook(name: string, deployDir = resolveDeployDir()): DeclaredRunbook {
  const path = join(deployDir, 'runbooks', `${name}.yaml`);
  if (!existsSync(path)) {
    throw new SovereignViolation(
      `كتاب معلن بلا ملف خطوات: ${name} — إعلانٌ بلا إجراء`, 'MANIFEST_RUNBOOK_FILE_MISSING',
    );
  }
  const raw = loadYamlFile(path).runbook as DeclaredRunbook | undefined;
  if (!raw) throw new SovereignViolation(`ملف كتاب بلا عقدة runbook: ${name}`, 'MANIFEST_RUNBOOK_NO_ROOT');
  if (raw.name !== name) {
    throw new SovereignViolation(
      `اسم الكتاب داخل الملف يخالف اسم الملف: ${raw.name} ≠ ${name}`, 'MANIFEST_RUNBOOK_NAME_MISMATCH',
    );
  }
  if (typeof raw.purpose !== 'string' || raw.purpose.trim().length < 3) {
    throw new SovereignViolation(`كتاب بلا غرض معلن: ${name}`, 'MANIFEST_RUNBOOK_NO_PURPOSE');
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new SovereignViolation(`كتاب بلا خطوات: ${name}`, 'MANIFEST_RUNBOOK_NO_STEPS');
  }
  const seen = new Set<number>();
  for (const step of raw.steps) {
    if (typeof step.n !== 'number' || !Number.isInteger(step.n) || step.n < 1) {
      throw new SovereignViolation(`خطوة بترقيم غير صحيح في ${name}`, 'MANIFEST_STEP_BAD_NUMBER');
    }
    if (seen.has(step.n)) {
      throw new SovereignViolation(`ترقيم مكرَّر في ${name}: ${step.n}`, 'MANIFEST_STEP_DUPLICATE');
    }
    seen.add(step.n);
    if (typeof step.title !== 'string' || step.title.trim().length < 3) {
      throw new SovereignViolation(`خطوة بلا عنوان في ${name}: ${step.n}`, 'MANIFEST_STEP_NO_TITLE');
    }
    if (typeof step.expect !== 'string' || step.expect.trim().length < 3) {
      throw new SovereignViolation(
        `خطوة بلا أثر معلن في ${name}: ${step.n} — ما لا يُعلن أثره لا يُقاس`,
        'MANIFEST_STEP_NO_EXPECT',
      );
    }
  }
  for (let i = 1; i <= raw.steps.length; i++) {
    if (!seen.has(i)) {
      throw new SovereignViolation(
        `ترقيم مثقوب في ${name}: الخطوة ${i} مفقودة`, 'MANIFEST_STEP_GAP',
      );
    }
  }
  return {
    name: raw.name,
    purpose: raw.purpose.trim(),
    steps: [...raw.steps].sort((a, b) => a.n - b.n),
  };
}
