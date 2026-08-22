/**
 * tests/production/production_manifest.test.ts — بيان النشر يُقابَل بالتهيئة (المرحلة 37)
 * المالك: ديوان التدقيق | المدخلات: نسخة من deploy/production/manifest.yaml معدَّلة
 * المخرجات: رفض التشغيل عند أي تعارض بين البيان والتهيئة
 * التبعيات: loadProductionManifest, resolveProductionDeployDir, loadProduction
 * الصلاحيات: لا تعديل على بيان المستودع الفعلي
 * حالات الفشل المقيسة: مجلد ناقص، ملف ناقص، بلا عقدة، بيئة مخالفة، مشغّل غير معلن،
 *   مراقب مخالف، مراقب هو المشغّل، بلا سبب، أقاليم/ماسحات/كتب مخالفة
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 * ثابت الاختبار: البيان الفعلي في المستودع يُقبل — وإلّا كان القياس على غير المنشور
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadProduction, loadProductionManifest, resolveProductionDeployDir, SovereignViolation,
} from '../../src/index';

const PRODUCTION = loadProduction();
const SOURCE = join(resolveProductionDeployDir(), 'manifest.yaml');

/** يُبدّل سطرًا أو مقطعًا في نسخةٍ من البيان الفعلي ثم يقيس الرفض */
function refusal(mutate: (yaml: string) => string, code: string): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-prod-manifest-'));
  try {
    writeFileSync(join(root, 'manifest.yaml'), mutate(readFileSync(SOURCE, 'utf8')), 'utf8');
    assert.throws(() => loadProductionManifest(PRODUCTION, root), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true, String(error));
      assert.equal((error as SovereignViolation).code, code);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('البيان الفعلي في المستودع يُقرأ ويُطابق التهيئة', () => {
  const manifest = loadProductionManifest(PRODUCTION);
  assert.equal(manifest.environment, 'production');
  assert.equal(manifest.observer, PRODUCTION.policy.observer_authority);
  assert.notEqual(manifest.operator, manifest.observer);
  assert.ok(manifest.reason.length >= 3);
  assert.deepEqual([...manifest.regions].sort(), [...PRODUCTION.policy.regions.required].sort());
  assert.deepEqual([...manifest.scanners].sort(), [...PRODUCTION.policy.scanners].sort());
  assert.deepEqual([...manifest.runbooks].sort(), [...PRODUCTION.policy.runbooks].sort());
});

test('مجلد نشرٍ بلا بيان يُرفض، وملفٌ غائب يُرفض', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-prod-empty-'));
  try {
    assert.throws(() => loadProductionManifest(PRODUCTION, root), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'PRODUCTION_MANIFEST_MISSING');
      return true;
    });
    // ومجلدٌ لا يوجد فيه deploy/production أصلًا يُرفض عند الحلّ
    mkdirSync(join(root, 'nowhere'), { recursive: true });
    assert.throws(() => resolveProductionDeployDir(join(root, 'nowhere')), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'PRODUCTION_MANIFEST_DEPLOY_DIR_MISSING');
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('بيانٌ بلا عقدة manifest أو ببيئة مخالفة يُرفض', () => {
  refusal(() => 'other:\n  value: 1\n', 'PRODUCTION_MANIFEST_NO_ROOT');
  refusal((y) => y.replace('environment: production', 'environment: staging'),
    'PRODUCTION_MANIFEST_ENVIRONMENT_MISMATCH');
});

test('الجهات: مشغّل غير معلن، ومراقب مخالف للتهيئة، ومراقبٌ هو المشغّل (RULE-004)', () => {
  refusal((y) => y.replace('operator: authority:royal_court', 'operator: official:region:core'),
    'PRODUCTION_MANIFEST_OPERATOR_UNDECLARED');
  refusal((y) => y.replace('observer: authority:audit_bureau', 'observer: authority:someone_else'),
    'PRODUCTION_MANIFEST_OBSERVER_MISMATCH');
  // المشغّل نفسه في الموضعين: يُقاس بعد مطابقة المراقب — فيُبدَّل المشغّل إلى جهة المراقبة
  refusal(
    (y) => y
      .replace('operator: authority:royal_court', 'operator: authority:audit_bureau'),
    'PRODUCTION_MANIFEST_OPERATOR_UNDECLARED',
  );
  refusal((y) => y.replace(/reason: .*\n/, 'reason: x\n'), 'PRODUCTION_MANIFEST_NO_REASON');
});

test('القوائم: أقاليم أو ماسحات أو كتب تخالف التهيئة تُسقط التشغيلة', () => {
  refusal((y) => y.replace('    - "region:services"\n', ''),
    'PRODUCTION_MANIFEST_REGIONS_MISMATCH');
  refusal((y) => y.replace('    - "region:services"', '    - "region:atlantis"'),
    'PRODUCTION_MANIFEST_REGIONS_MISMATCH');
  refusal((y) => y.replace('    - passage\n', ''), 'PRODUCTION_MANIFEST_SCANNERS_MISMATCH');
  refusal((y) => y.replace('    - king-absence', '    - moon-landing'),
    'PRODUCTION_MANIFEST_RUNBOOKS_MISMATCH');
});
