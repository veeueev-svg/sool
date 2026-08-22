/**
 * tests/staging/manifest.test.ts — بيان النشر يُقرأ ويُقابَل بالتهيئة (المرحلة 36)
 * المالك: ديوان التدقيق | المدخلات: نسخة من deploy/staging في مجلد مؤقت
 * المخرجات: إثبات أن ملف نشرٍ يخالف التهيئة يُسقط التشغيلة برمز معلن
 * التبعيات: loadStagingManifest + loadDeclaredRunbook | الصلاحيات: لا تعديل على المستودع الفعلي
 * السجلات: لا شيء — الرفض قبل الإقلاع | حالات الفشل: كلها مغلقة برموز معلنة
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts | الوثيقة: docs/runbooks/README.md
 * ثوابت الاختبار: 1) بيانٌ لا يقرأه كود كذبٌ موثَّق؛ 2) التعارض يُسقط ولا يُوفَّق؛
 *   3) الرفض برمزه لا بنصه.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SovereignViolation, loadDeclaredRunbook, loadStaging, loadStagingManifest, resolveDeployDir,
} from '../../src/index';

/** نسخة من مجلد النشر تُعدَّل فيها الملفات وحدها */
function withDeployCopy(run: (dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-deploy-'));
  const dir = join(root, 'staging');
  cpSync(resolveDeployDir(), dir, { recursive: true });
  try { run(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

function refusal(mutate: (dir: string) => void, code: string, run?: (dir: string) => void): void {
  withDeployCopy((dir) => {
    mutate(dir);
    assert.throws(() => (run ? run(dir) : loadStagingManifest(loadStaging(), dir)), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true);
      assert.equal((error as SovereignViolation).code, code);
      return true;
    });
  });
}

function patchManifest(dir: string, from: string, to: string): void {
  const path = join(dir, 'manifest.yaml');
  const text = readFileSync(path, 'utf8');
  assert.equal(text.includes(from), true, `النص المُستبدل غير موجود: ${from}`);
  writeFileSync(path, text.replace(from, to), 'utf8');
}

test('بيان المستودع الفعلي يُقرأ ويطابق التهيئة حرفيًّا', () => {
  const staging = loadStaging();
  const manifest = loadStagingManifest(staging, resolveDeployDir());
  assert.equal(manifest.environment, 'staging');
  assert.equal(manifest.observer, staging.policy.observer_authority);
  assert.notEqual(manifest.operator, manifest.observer);
  assert.deepEqual([...manifest.watches].sort(), [...staging.policy.watches].sort());
  assert.deepEqual([...manifest.runbooks].sort(), [...staging.policy.runbooks].sort());
});

test('مشغّل غير معلن ومراقب مخالف للتهيئة يُسقطان البيان برمزيهما', () => {
  refusal((dir) => patchManifest(dir, 'operator: authority:royal_court', 'operator: agent:001'),
    'MANIFEST_OPERATOR_UNDECLARED');
  refusal((dir) => patchManifest(dir, 'observer: authority:audit_bureau', 'observer: authority:tribunal'),
    'MANIFEST_OBSERVER_MISMATCH');
});

test('حرّاس البيان أو كتبه إن خالفت التهيئة يُسقطان التشغيلة — التعارض لا يُوفَّق', () => {
  refusal((dir) => patchManifest(dir, '    - termination\n', ''), 'MANIFEST_WATCHES_MISMATCH');
  refusal((dir) => patchManifest(dir, '    - halt-and-recover\n', ''), 'MANIFEST_RUNBOOKS_MISMATCH');
  refusal((dir) => patchManifest(dir, 'environment: staging', 'environment: production'),
    'MANIFEST_ENVIRONMENT_MISMATCH');
});

test('كتاب معلن بلا ملف خطوات يُرفض — إعلانٌ بلا إجراء', () => {
  refusal(
    (dir) => rmSync(join(dir, 'runbooks', 'incident-response.yaml')),
    'MANIFEST_RUNBOOK_FILE_MISSING',
    (dir) => loadDeclaredRunbook('incident-response', dir),
  );
});

test('خطوة بلا أثر أو بترقيم مثقوب أو كتابٌ باسمٍ غير اسم ملفه — ثلاثة رفوض بأسمائها', () => {
  refusal(
    (dir) => {
      const path = join(dir, 'runbooks', 'halt-and-recover.yaml');
      const text = readFileSync(path, 'utf8').replace('      expect: المفتاح غير موقَّع قبل النافذة\n', '');
      writeFileSync(path, text, 'utf8');
    },
    'MANIFEST_STEP_NO_EXPECT',
    (dir) => loadDeclaredRunbook('halt-and-recover', dir),
  );
  refusal(
    (dir) => {
      const path = join(dir, 'runbooks', 'halt-and-recover.yaml');
      const text = readFileSync(path, 'utf8').replace('    - n: 1', '    - n: 3');
      writeFileSync(path, text, 'utf8');
    },
    'MANIFEST_STEP_GAP',
    (dir) => loadDeclaredRunbook('halt-and-recover', dir),
  );
  refusal(
    (dir) => {
      const path = join(dir, 'runbooks', 'limited-operation.yaml');
      const text = readFileSync(path, 'utf8').replace('name: limited-operation', 'name: incident-response');
      writeFileSync(path, text, 'utf8');
    },
    'MANIFEST_RUNBOOK_NAME_MISMATCH',
    (dir) => loadDeclaredRunbook('limited-operation', dir),
  );
});
