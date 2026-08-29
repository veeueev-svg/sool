/**
 * tests/kernel/declared_dir_ascent.test.ts — مصعدُ المجلداتِ المُعلنِ الواحد (المرحلة 40، البند T-145)
 * المالك: المساعد الآلي — Perplexity Computer (الجلسة 67) | المراجع: القيّم على المستودع
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: `src/` قراءةً (حصرُ المصاعد) + جذورٌ مصنوعةٌ في `tmpdir` تُبنى وتُحذف
 * المخرجات: تأكيدُ أنّ الصعودَ آلةٌ واحدةٌ بحدٍّ واحد، وأنّ رموزَ الرفضِ لم تُوحَّد
 * التبعيات: `node:test` · `node:fs` · `node:os` · `node:path`
 * الصلاحيات (RULE-004): يقرأ ولا يكتب في المستودع — كلُّ بناءٍ في جذرٍ مؤقّتٍ يُحذف في `finally`
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: مصعدٌ ثانٍ يُكتب في `src/` · حدٌّ يُنسخ رقمًا في حلقة · مسارٌ مُرجَعٌ
 *   يتغيّر · رمزُ رفضٍ يُوحَّد أو يُبدَّل · مدًى يختلف بين مُستنبِطٍ وآخر · رسالةٌ لا تُنقل
 *   كما أُعلنت · جذرُ نظامِ الملفّاتِ لا يوقف الصعود
 * اختبارُ القبول: هذا الملفُّ نفسُه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-T145.md
 *   · القياسُ الخام: docs/audit/measurements/phase-40-T145.txt
 *
 * ثوابت هذا الملف:
 *
 * 1) **التأكيدُ على رمزٍ ومسارٍ ورقمٍ لا على نصٍّ عربيٍّ مشكول**: نصوصُ الرفضِ تُنقَّح
 *    صياغةً، فلو رُبط الحكمُ بها انكسر على تحسينِ عبارة. ونقلُ الرسالةِ نفسُه يُقاس
 *    **بعلامةٍ لاتينيّةٍ مصنوعةٍ** (`T145-MSG`) لا بنصِّ الوحدةِ الحقيقيّ.
 *
 * 2) **الحدُّ يُقاس سلوكًا لا قراءةً**: لا يكفي أنّ الثابتَ مُعلَنٌ باسمه؛ فيُبنى جذرٌ
 *    مؤقّتٌ ويُصعَد إليه من عمقِ `LIMIT-1` ومن عمقِ `LIMIT` — **فإن اختلف مُستنبِطٌ عن أخيه
 *    في المدى سقط الحكم**. وهذا هو عينُ البرهانِ الذي أظهر الاستقلالَ قبل الإصلاح (§3 من
 *    القياس الخامّ)، مقلوبًا ليُثبت الوحدة.
 *
 * 3) **حرَسُ التكرارِ يقرأ `src/` كلَّه ويستثني باسمٍ مُعلَن**: المستثنى الوحيدُ
 *    `src/production/supervision_checkpoint.ts` (يسقط صامتًا إلى `process.cwd()` — دَينٌ
 *    مُعلَنٌ `T-157`). فمن كتب مصعدًا ثالثًا سقط عليه هذا الحكمُ بلا تعديلٍ فيه.
 *
 * 4) **عدمُ التناسقِ يُقاس ولا يُسوّى**: جذرٌ فيه `deploy/production` بلا `deploy/staging`
 *    يُقبَل في مُستنبِطِ الإنتاجِ ويُرفَض في الآخرَين. **والحكمُ فيه للمراجع** (RULE-004)،
 *    وهذا الاختبارُ يُثبّت الحالَ القائمَ حتّى يقضي فيه صاحبُه — فمن غيّره صامتًا سقط.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import {
  DECLARED_DIR_ASCENT_LIMIT, ascendToDeclaredDir, resolveConfigDir,
} from '../../src/kernel/config';
import { resolveDeployDir } from '../../src/staging/manifest';
import { resolveProductionDeployDir } from '../../src/production/production_manifest';
import { resolveDeployRoot } from '../../src/composition/deploy_declaration';
import { SovereignViolation } from '../../src/kernel/types';

/** جذرُ المستودعِ يُستنبط بالآلةِ المفحوصةِ نفسِها — فلا مسارَ مطلقٌ يُكتب (RULE-006) */
const REPO = dirname(resolveConfigDir());

/** المستثنى المُعلَنُ من حصرِ المصاعد (الثابت 3) — يُسمّى ولا يُعمَّم */
const DECLARED_ASCENT_EXCEPTIONS = ['src/production/supervision_checkpoint.ts'];

/** موضعُ الآلةِ الوحيدة */
const ASCENT_HOME = 'src/kernel/config/paths.ts';

/** يُرجع رمزَ الرفضِ إن رُفض، وإلّا `null` — ولا يُبتلع خطأٌ غيرُ سياديّ (RULE-007) */
function refusalCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof SovereignViolation) return error.code;
    throw error;
  }
}

/** كلُّ ملفّات `src` ذاتِ اللاحقة `.ts` بمسارٍ نسبيٍّ — تُقرأ ولا تُكتب */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(REPO, rel), { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.ts')) found.push(next);
    }
  };
  walk('src');
  return found;
}

/** جذرٌ مصنوعٌ فيه الأدلّةُ الثلاثةُ كلُّها، وعمقٌ من المجلداتِ تحته */
function withCraftedRoot(depth: number, body: (start: string, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-ascent-'));
  try {
    mkdirSync(join(root, 'deploy', 'staging'), { recursive: true });
    mkdirSync(join(root, 'deploy', 'production'), { recursive: true });
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(join(root, 'deploy', 'staging', 'manifest.yaml'), 'manifest:\n');
    writeFileSync(join(root, 'deploy', 'production', 'manifest.yaml'), 'manifest:\n');
    writeFileSync(join(root, 'config', 'royal-authority.yaml'), 'royal_authority:\n');
    const start = join(root, ...Array.from({ length: depth }, (_, i) => `d${i}`));
    if (depth > 0) mkdirSync(start, { recursive: true });
    body(start, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('حدُّ الصعودِ ثابتٌ واحدٌ مُعلَنٌ باسمه، ولا رقمَ منسوخًا في حلقةِ الآلة', () => {
  assert.equal(DECLARED_DIR_ASCENT_LIMIT, 8);
  const home = readFileSync(join(REPO, ASCENT_HOME), 'utf8');
  const loops = home.split('\n').filter((line) => /for \(let i = 0; i </.test(line));
  assert.equal(loops.length, 1);
  assert.match(loops.join('\n'), /DECLARED_DIR_ASCENT_LIMIT/);
});

test('حصرُ المصاعدِ في src/: آلةٌ واحدةٌ ومستثنًى مُعلَنٌ واحد، ولا ثالثَ لهما', () => {
  const measured: string[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(join(REPO, file), 'utf8');
    if (text.includes('dirname(dir)') && text.includes('existsSync(join(dir')) measured.push(file);
  }
  assert.deepEqual(measured.sort(), [ASCENT_HOME, ...DECLARED_ASCENT_EXCEPTIONS].sort());
});

test('هويّةُ المُخرَجات: المسارُ المُرجَعُ لكلِّ مُستنبِطٍ كما كان قبل التوحيد', () => {
  assert.equal(resolveConfigDir(), join(REPO, 'config'));
  assert.equal(resolveDeployRoot(), join(REPO, 'deploy'));
  assert.equal(resolveDeployDir(), join(REPO, 'deploy', 'staging'));
  assert.equal(resolveProductionDeployDir(), join(REPO, 'deploy', 'production'));
  assert.equal(dirname(resolveDeployDir()), resolveDeployRoot());
  assert.equal(dirname(resolveProductionDeployDir()), resolveDeployRoot());
});

test('رموزُ الرفضِ الثلاثةُ محفوظةٌ متمايزةٌ ولم تُوحَّد', () => {
  const orphan = mkdtempSync(join(tmpdir(), 'sool-orphan-'));
  try {
    const codes = [
      refusalCode(() => resolveConfigDir(orphan)),
      refusalCode(() => resolveDeployRoot(orphan)),
      refusalCode(() => resolveDeployDir(orphan)),
      refusalCode(() => resolveProductionDeployDir(orphan)),
    ];
    assert.deepEqual(codes, [
      'CONFIG_DIR_MISSING',
      'MANIFEST_DEPLOY_DIR_MISSING',
      'MANIFEST_DEPLOY_DIR_MISSING',
      'PRODUCTION_MANIFEST_DEPLOY_DIR_MISSING',
    ]);
    assert.equal(new Set(codes).size, 3);
  } finally {
    rmSync(orphan, { recursive: true, force: true });
  }
});

test('المدى مشتركٌ سلوكًا: عمقُ الحدِّ ناقصًا واحدًا يصل، والحدُّ نفسُه يُرفض في الأربعةِ معًا', () => {
  withCraftedRoot(DECLARED_DIR_ASCENT_LIMIT - 1, (start, root) => {
    assert.equal(resolveConfigDir(start), join(root, 'config'));
    assert.equal(resolveDeployRoot(start), join(root, 'deploy'));
    assert.equal(resolveDeployDir(start), join(root, 'deploy', 'staging'));
    assert.equal(resolveProductionDeployDir(start), join(root, 'deploy', 'production'));
  });
  withCraftedRoot(DECLARED_DIR_ASCENT_LIMIT, (start) => {
    const codes = [
      refusalCode(() => resolveConfigDir(start)),
      refusalCode(() => resolveDeployRoot(start)),
      refusalCode(() => resolveDeployDir(start)),
      refusalCode(() => resolveProductionDeployDir(start)),
    ];
    assert.equal(codes.filter((code) => code === null).length, 0);
  });
});

test('الآلةُ تُنقل رمزَها ورسالتَها كما أُعلنا، وتُرجع المُرشَّحَ نفسَه إن كان المُخرَجُ فارغًا', () => {
  withCraftedRoot(0, (start, root) => {
    assert.equal(ascendToDeclaredDir({
      sentinel: ['config', 'royal-authority.yaml'],
      result: [],
      code: 'CONFIG_DIR_MISSING',
      message: 'T145-MSG',
    }, start), root);
  });
  const orphan = mkdtempSync(join(tmpdir(), 'sool-passthrough-'));
  try {
    let seen: SovereignViolation | null = null;
    try {
      ascendToDeclaredDir({
        sentinel: ['T145-NO-SUCH-FILE'],
        result: [],
        code: 'CONFIG_DIR_MISSING',
        message: 'T145-MSG',
      }, orphan);
    } catch (error) {
      seen = error as SovereignViolation;
    }
    assert.ok(seen instanceof SovereignViolation);
    assert.equal(seen.code, 'CONFIG_DIR_MISSING');
    assert.equal(seen.message, 'T145-MSG');
  } finally {
    rmSync(orphan, { recursive: true, force: true });
  }
});

test('جذرُ نظامِ الملفّاتِ يوقف الصعودَ برفضٍ لا بدَورانٍ بلا نهاية', () => {
  assert.equal(refusalCode(() => ascendToDeclaredDir({
    sentinel: ['T145-NO-SUCH-FILE'],
    result: [],
    code: 'CONFIG_DIR_MISSING',
    message: 'T145-MSG',
  }, sep)), 'CONFIG_DIR_MISSING');
});

test('عدمُ التناسقِ المقيسُ يُثبَّت ولا يُسوّى: جذرٌ فيه production بلا staging', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-asym-'));
  try {
    mkdirSync(join(root, 'deploy', 'production'), { recursive: true });
    writeFileSync(join(root, 'deploy', 'production', 'manifest.yaml'), 'manifest:\n');
    const start = join(root, 'deploy', 'production');
    assert.equal(resolveProductionDeployDir(start), join(root, 'deploy', 'production'));
    assert.equal(refusalCode(() => resolveDeployRoot(start)), 'MANIFEST_DEPLOY_DIR_MISSING');
    assert.equal(refusalCode(() => resolveDeployDir(start)), 'MANIFEST_DEPLOY_DIR_MISSING');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
