/**
 * tests/kernel/config_paths.test.ts — قبول قابلية النقل: لا مسار جهازٍ في مسار التهيئة (البند T-118)
 * المالك: القيّم على المستودع | المدخلات: موقع التنفيذ، ونسخ تهيئة في مسارات مؤقتة
 * المخرجات: مجلد تهيئة محلول صعودًا أو رفض مغلق CONFIG_DIR_MISSING | التبعيات: src/kernel/config
 * الصلاحيات: قراءة تهيئة فقط؛ لا قرار سيادي ولا كتابة في السجل | السجلات: لا شيء
 * حالات الفشل: مسار مطلق أو اعتماد على مجلد العمل ⇒ فشل صريح لا صامت
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/scale/scale_lifecycle.test.ts وresearch_lifecycle
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md §13
 * ثوابت الاختبار:
 *   1) **الحلّ صعودًا من موقع التنفيذ لا من مجلد العمل**: تغيير `cwd` لا يغيّر النتيجة،
 *      وإلا فكل أداةٍ تُشغَّل من مجلدٍ آخر تسقط بلا سبب ظاهر.
 *   2) **النسخة المنقولة تعمل**: تهيئة منسوخة إلى مسارٍ مؤقت تُحمَّل بلا معرفة مسبقة بمسارها.
 *   3) **الغياب فشل مغلق** (RULE-007): بلا تهيئة لا تخمين ولا قيمة افتراضية.
 *   4) **الحاجز مُختبَر لا معلن**: أداة `check_absolute_paths.sh` تسقط عند مسار مطلق مزروع.
 *   5) **المسار المزروع يُركّب من أجزاء وقت التشغيل**: لو كُتب حرفًا في هذا الملف لأسقط الحاجزَ
 *      على المستودع نفسه — فيصير الاختبار سببَ ما يدّعي منعَه.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScale, resolveConfigDir } from '../../src/kernel/config';

/** جذر المستودع مشتقّ من موقع هذا الملف المبني (dist/tests/kernel) لا من مسار مكتوب. */
const REPO_ROOT = join(__dirname, '..', '..', '..');

test('مجلد التهيئة يُحلّ صعودًا من موقع التنفيذ ويحمل الملف السيادي المعلن', () => {
  const dir = resolveConfigDir();
  assert.equal(existsSync(join(dir, 'royal-authority.yaml')), true);
  assert.equal(existsSync(join(dir, 'scale.yaml')), true);
});

test('تغيير مجلد العمل لا يغيّر مجلد التهيئة المحلول — لا اعتماد على cwd', () => {
  const before = process.cwd();
  const elsewhere = mkdtempSync('/tmp/sool-cwd-');
  try {
    const expected = resolveConfigDir();
    process.chdir(elsewhere);
    assert.equal(resolveConfigDir(), expected);
    assert.equal(loadScale().policy.default, 'deny');
  } finally {
    process.chdir(before);
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('نسخة تهيئة منقولة إلى مسار مؤقت تُحمَّل بلا مسار مكتوب مسبقًا', () => {
  const root = mkdtempSync('/tmp/sool-portable-');
  const dir = join(root, 'config');
  cpSync(resolveConfigDir(), dir, { recursive: true });
  const config = loadScale(dir);
  assert.equal(config.policy.population_max, loadScale().policy.population_max);
  rmSync(root, { recursive: true, force: true });
});

test('مجلد بلا تهيئة يُرفض برمزه المعلن ولا يُخمَّن — RULE-007', () => {
  const empty = mkdtempSync('/tmp/sool-empty-');
  let code: string | null = null;
  try {
    resolveConfigDir(empty);
  } catch (error) {
    code = (error as { code?: string }).code ?? null;
  }
  rmSync(empty, { recursive: true, force: true });
  assert.equal(code, 'CONFIG_DIR_MISSING');
});

test('حاجز المسارات المطلقة يمرّ على المستودع كما هو', () => {
  const out = execFileSync('bash', [join(REPO_ROOT, 'scripts', 'check_absolute_paths.sh')], { encoding: 'utf8' });
  assert.match(out, /✓/);
});

test('حاجز المسارات المطلقة يسقط عند مسار جهازٍ مزروع — الحاجز مُمارَس لا معلن', () => {
  const planted = join(REPO_ROOT, 'src', '__t118_probe.ts');
  // يُركّب من أجزاء لا يُكتب حرفًا: وجوده حرفًا هنا يُسقِط الحاجز على المستودع نفسه.
  const machineRoot = ['', 'home', 'someone', 'sool', 'config'].join('/');
  writeFileSync(planted, `export const PLANTED = '${machineRoot}';\n`);
  let failed = false;
  try {
    execFileSync('bash', [join(REPO_ROOT, 'scripts', 'check_absolute_paths.sh')], { encoding: 'utf8' });
  } catch {
    failed = true;
  } finally {
    rmSync(planted, { force: true });
  }
  assert.equal(failed, true);
});
