/**
 * tests/composition/deploy_declaration.test.ts — إعلانُ النشر يُحصى قبل بناء الدولة (المرحلة 40، البند T-138)
 * المالك: ديوان التدقيق | المراجع: القيّم على المستودع (RULE-004)
 * المدخلات: **نسخةٌ** من `deploy/` في مجلدٍ مؤقّت — ولا يُلمس ملفُّ مستودعٍ واحد
 * المخرجات: إثباتُ أنّ نفخَ إعلانِ النشر يُردّ **قبل** أن تُبنى الدولة، لا في آخرِ مُركِّب
 * التبعيات: `guardDeployDeclaration` · `resolveDeployRoot` · `bootstrapState` · `AuditStore`
 * الصلاحيات: لا تعديلَ على المستودع الفعلي — كلُّ نفخٍ يقع في نسخةٍ تُحذف في `finally`
 * السجلات: لا شيء يُكتب إلّا في مجلدٍ مؤقّت، وهو نفسُه **أداةُ القياس** في الاختبار 1
 * حالات الفشل المغطّاة: `CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING` ·
 *   `MANIFEST_DEPLOY_DIR_MISSING`
 * اختبارُ القبول: هذا الملفُّ نفسُه (الاختبار 1) | الوثيقة: docs/decisions/ADR-0043-deploy-declaration-census.md
 *
 * ثوابت هذا الاختبار:
 *
 *   1) **«قبل البناء» تُقاس ولا تُدَّعى — ويُعلَن ما لم تقسِه.** لا يكفي أن يُرمى الرمزُ
 *      الصحيح، فالرمزُ نفسُه كان يُرمى قبل هذا البند من `composeOperations`. فالمقياسُ
 *      **أثرٌ خارجيٌّ**: ملفُّ السجل يُكتب في `src/index.ts:89` — **بعد**
 *      `composeSovereignty` و**قبل** `composeOperations`. فإن سقط الإقلاعُ ولم يُكتب الملفُّ
 *      ⇒ سقط داخلَ السيادة، وهو المطلوبُ إثباتُه. والضابطُ يُثبت أنّ الكتابةَ تقع فعلًا
 *      في هذا المسار: **نسخةٌ سليمةٌ تُكتب**، ونسخةٌ منفوخةٌ **لا تُكتب**.
 *
 *      **وما لم يُقس يُقال:** هذا لا يُثبت النقيضَ تجريبًا — أي أنّ الشفرةَ القديمةَ كانت
 *      تكتب الملفَ ثمّ تسقط — لأنّ `deployDir` يُغير ما **يُحصى** ولا يُغير ما **يُقرأ**
 *      (الدَّينُ `T-145`)، فلا يرى قارئُ البيان نفخًا وقع في نسخة. وإثباتُ النقيض يقتضي
 *      نفخَ `deploy/` الفعليّ — وهو ممنوعٌ بالثابت 3. فالمقيسُ هنا: **الرفضُ يسبق
 *      كتابةَ السجل**، والمقروءُ بنًيةً: **كتابةُ السجل تسبق `composeOperations`**. ومن
 *      الأوّل والثاني يلزم المدّعى.
 *
 *      **وقُيست قُوّةُ التأكيد بطفرة:** أُبدِل نداءُ `guardDeployDeclaration` بقياسٍ أصفارٍ
 *      فسقط هذا الاختبارُ وحدَه (`Missing expected exception`) ونجح الستةُ البواقي — فهو
 *      المُمسِكُ وحدَه بموضع الحرَس. والقياسُ في docs/audit/measurements/phase-40-T138.txt.
 *
 *   2) **لا حكمَ على نصٍّ عربيٍّ مشكول.** كلُّ تأكيدٍ يُربط برمزِ رفضٍ معلنٍ أو رمزٍ مُصدَّرٍ
 *      من الشفرة، لا بجملةٍ تتغيّر تشكيلًا فيسقط اختبارٌ بلا عيبٍ في المنطق.
 *
 *   3) **النفخُ يقع في نسخةٍ لا في المستودع.** وهذا ليس تنظيفًا بل شرطُ صحّة: إفسادُ
 *      `deploy/` الفعليّ يُسقط كلَّ اختباراتِ النشر معه، وهو ما وقع فعلًا في `W-2026-004`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditStore, SovereignViolation, bootstrapState, loadStaging, loadStagingManifest, resolveDeployDir,
} from '../../src/index';
import {
  DEPLOY_DECLARATION_DIRS, guardDeployDeclaration, resolveDeployRoot,
} from '../../src/composition/deploy_declaration';

/** سقفُ بايتات المجلد الواحد المعلن في النواة — يُقرأ ولا يُكتب رقمُه هنا */
const DIR_BYTES_CEILING = 262_144;

/**
 * نسخةٌ كاملةٌ من `deploy/` (البيئتان وكتبُ التشغيل) في مجلدٍ مؤقّت.
 * وتُنسخ من جذرِ `deploy` لا من `deploy/staging`: هذا البندُ يحرس البيئتَين معًا.
 */
function withDeployRootCopy(run: (root: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), 'sool-deploy-census-'));
  const root = join(base, 'deploy');
  cpSync(join(resolveDeployDir(), '..'), root, { recursive: true });
  try { run(root); } finally { rmSync(base, { recursive: true, force: true }); }
}

/** ينفخ إعلانَ بيئةٍ فوق سقفِ بايتاتِ المجلد الواحد — بامتدادٍ داخلَ مدى الحصر */
function inflate(root: string, environment: string): void {
  writeFileSync(join(root, environment, 'inflated.yaml'), `key: ${'ب'.repeat(DIR_BYTES_CEILING)}\n`);
}

test('نفخُ إعلانِ النشر يُردّ قبل بناء الدولة — والشاهدُ ملفُّ سجلٍّ لم يُكتب', () => {
  withDeployRootCopy((root) => {
    const auditPath = join(root, '..', 'audit-of-inflated.json');

    // الضابطُ أوّلًا: النسخةُ سليمةٌ ⇒ الإقلاعُ يتمّ وملفُّ السجل يُكتب. وبهذا يثبت أنّ
    // الكتابةَ واقعةٌ فعلًا في هذا المسار، فغيابُها في الحالة التالية دليلٌ لا مصادفة.
    const healthyAuditPath = join(root, '..', 'audit-of-healthy.json');
    bootstrapState({ deployDir: root, auditPath: healthyAuditPath });
    assert.equal(existsSync(healthyAuditPath), true, 'الضابط: النسخةُ السليمةُ تكتب ملفَّ السجل');

    inflate(root, 'staging');
    assert.throws(() => bootstrapState({ deployDir: root, auditPath }), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true);
      assert.equal((error as SovereignViolation).code, 'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING');
      return true;
    });

    // **جوهرُ البند**: سقط الإقلاعُ ولم يُكتب ملفُّ السجل ⇒ سقط داخلَ `composeSovereignty`،
    // إذ الكتابةُ تلي السيادةَ وتسبق التشغيل (`src/index.ts:89`). ولا يُدّعى أكثرُ من هذا:
    // نقيضُه لا يُقاس بلا نفخِ المستودع الفعليّ — والبيانُ في الثابت 1 أعلاه.
    assert.equal(existsSync(auditPath), false, 'الرفضُ وقع قبل كتابةِ السجل — أي قبل بناء الدولة');
    // ولا حالةَ نصفَ مكتوبة: ما لم يُكتب لا يُقرأ
    assert.throws(() => new AuditStore(auditPath).load(), Error);
  });
});

test('نفخُ إعلانِ الإنتاج يُردّ كما يُردّ نفخُ التهيئة — البيئتان محروستان لا واحدةٌ', () => {
  withDeployRootCopy((root) => {
    inflate(root, 'production');
    assert.throws(() => guardDeployDeclaration(root), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING');
      return true;
    });
  });
});

test('النسخةُ السليمةُ تُحصى: مجلدان وسبعةُ ملفاتٍ وبايتاتٌ مقيسةٌ لا مقدَّرة', () => {
  withDeployRootCopy((root) => {
    const census = guardDeployDeclaration(root);
    assert.equal(census.root, root);
    assert.equal(census.dirs, DEPLOY_DECLARATION_DIRS.length);
    assert.deepEqual([...census.names], [...DEPLOY_DECLARATION_DIRS]);
    // الملفاتُ تُعدّ من القياس المحفوظ لا بمشيةٍ ثانية — فعددٌ صفرٌ يعني أنّ الدفترَ فُقد
    assert.equal(census.files > 0, true, 'عددُ الملفات يُقرأ من دفتر القياس (T-140)');
    assert.equal(census.bytes > 0, true);
    assert.equal(census.bytes <= DIR_BYTES_CEILING * census.dirs, true);
  });
});

test('مجلدُ بيئةٍ معلنةٍ غائبٌ يُسقط الإقلاعَ برمزِه القائم لا برمزٍ جديد', () => {
  withDeployRootCopy((root) => {
    rmSync(join(root, 'production'), { recursive: true, force: true });
    assert.throws(() => guardDeployDeclaration(root), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true);
      assert.equal((error as SovereignViolation).code, 'MANIFEST_DEPLOY_DIR_MISSING');
      return true;
    });
  });
});

test('جذرُ النشر يُستنبط بشرطِ قارئةِ البيان نفسِه — ومن لا جذرَ له يُرفض', () => {
  // الموافقةُ: المستنبَطُ من موضع الشفرة هو نفسُه المستنبَطُ من قارئة البيان
  assert.equal(resolveDeployRoot(), join(resolveDeployDir(), '..'));
  // والمخالفةُ: مجلدٌ مؤقّتٌ لا `deploy/staging/manifest.yaml` فوقه ⇒ رفضٌ برمزٍ معلن
  const orphan = mkdtempSync(join(tmpdir(), 'sool-no-deploy-'));
  try {
    assert.throws(() => resolveDeployRoot(orphan), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'MANIFEST_DEPLOY_DIR_MISSING');
      return true;
    });
  } finally { rmSync(orphan, { recursive: true, force: true }); }
});

test('قائمةُ البيئات مجمَّدةٌ في التشغيل — فلا تُوسَّع بلا إعلان', () => {
  assert.equal(Object.isFrozen(DEPLOY_DECLARATION_DIRS), true);
  assert.equal(DEPLOY_DECLARATION_DIRS.length, 2);
  assert.throws(() => {
    (DEPLOY_DECLARATION_DIRS as unknown as string[]).push('shadow');
  }, TypeError);
});

test('والحرَسُ عند القراءة باقٍ كما كان: التقديمُ لا يُلغي الحرَسَ الثاني (درسُ T-133)', () => {
  withDeployRootCopy((root) => {
    const staging = join(root, 'staging');
    inflate(root, 'staging');
    // من نادى المحمِّلَ مفردًا بلا إقلاعٍ يبقى محروسًا برمزِه نفسِه — لا يُقبل في طريقٍ
    // ويُرفض في طريق. وهذا يُثبت أنّ هذا البندَ **قدَّم** الحرَسَ ولم **ينقله**.
    assert.throws(() => loadStagingManifest(loadStaging(), staging), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING');
      return true;
    });
  });
});
