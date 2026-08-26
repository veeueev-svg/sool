/**
 * tests/governance/generated_numbers.test.ts — فاحصُ الأرقام المنقولة (المرحلة 40، البند T-128)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_generated_numbers.sh` و`ARCHITECTURE.md` و`version.json` وشجرةُ `src/`
 * المخرجات: تأكيدٌ أن الفاحص يمرّ على المستودع كما هو، ويسقط على كل رقمٍ تأخّر عن مصدره
 * التبعيات: `node:child_process` (يشغّل الفحص كما تشغّله البوابة) · `node:fs`
 * الصلاحيات (RULE-004): الاختبار يقرأ ويعبث مؤقّتًا ويستعيد؛ لا يُصحّح رقمًا ولا يُرقّي حالة
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: عددُ ملفاتٍ متأخّر · عددُ أسطرٍ متأخّر · صفٌّ لمجلدٍ غير موجود ·
 *   مجلدٌ فيه شفرةٌ ولا صفَّ له · tests.total يخالف المُشغّل · total ≠ passing ·
 *   المُشغّلُ فيه فشلٌ · حصيلةٌ غيرُ مقروءة · صيغةُ الجدول تغيّرت فصار الفحصُ أعمى
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-T128.md · ARCHITECTURE.md §«خريطة المجلدات»
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الفحص لا يعيد كتابته**: يشغّل الملفَّ الصدفيَّ عينَه الذي تشغّله البوابة
 *    (كأخيه declaration_gate.test.ts)، فلا يمرّ اختبارٌ على منطقِ نسخةٍ ثانية.
 *
 * 2) **العبثُ مؤقّت ومُستعاد دائمًا**: كل حالةٍ سلبية تكتب نسخةً معطوبة ثم تُرجع الأصل في
 *    `finally` — ولو سقط التأكيد. وما أُنشئ من ملفٍّ أو مجلدٍ يُحذف.
 *
 * 3) **المقيسُ رمزُ الخروج لا نصُّ الرسالة**: العلّةُ التي أوجبت هذا الفاحص أنّ جدولَ المجلدات
 *    تأخّر ثمانيةَ عشرَ صفًّا من خمسةٍ وعشرين بلا أن يُسقط شيئًا — فالمقيسُ هو الإسقاط.
 *
 * 4) **حصيلةُ المُشغّل تُمرَّر مصنوعةً في هذا الملف** (`SOOL_TESTS_TALLY`) لا مقروءةً من
 *    `dist/.tests.tap`: إذ لا تكتمل الحصيلةُ الحقيقيّةُ إلا بعد انتهاء المُشغّل، فلا تُقرأ من
 *    داخله. **فالمُختبرُ هو منطقُ المقابلة، والمقابلةُ على الحصيلة الحقيقيّة تقع في البوابة
 *    بعد الاختبارات** — وهو انحرافٌ معلن (RULE-008).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  mkdtempSync,
  cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const SCRIPT = 'scripts/check_generated_numbers.sh';
const ARCH = 'ARCHITECTURE.md';
const VERSION = 'version.json';

/**
 * ينسخ ما يقرأه الفاحص (جدولُ المجلدات والرقمُ المُعلن وشجرةُ `src/`) إلى جذرٍ في
 * tmpdir يُمرَّر بـ`SOOL_CHECK_ROOT`، فلا تُحرّف حالةٌ سلبيّةٌ ملفًّا حقيقيًّا ولا تُنشئ مجلدًا
 * في `src/` الحقيقيّ (W-2026-004: node يشغّل ملفّاتِ الاختبار بالتوازي، فما حرّفته واحدةٌ
 * تقرأه أخرى حكمًا).
 */
function withRoot(
  mutate: (root: string) => void,
  assertOn: (r: { code: number; out: string }, root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-num-'));
  try {
    cpSync(join(ROOT, ARCH), join(root, ARCH));
    cpSync(join(ROOT, VERSION), join(root, VERSION));
    cpSync(join(ROOT, 'src'), join(root, 'src'), { recursive: true });
    mutate(root);
    assertOn(runCheck(undefined, root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** حصيلةُ مُشغّلٍ مصنوعة: تُطابق ما يقوله version.json إلا حيث يُقصد الخلاف */
function tallyFile(tests: number, pass: number, fail: number, body?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-tally-'));
  const path = join(dir, 'tests.tap');
  writeFileSync(path, body ?? `TAP version 13\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n`);
  return path;
}

function declaredTests(root: string = ROOT): number {
  const v = JSON.parse(readFileSync(join(root, VERSION), 'utf8')) as { tests: { total: number } };
  return v.tests.total;
}

function runCheck(tally?: string, root?: string): { code: number; out: string } {
  const n = declaredTests(root ?? ROOT);
  const path = tally ?? tallyFile(n, n, 0);
  const r = spawnSync('bash', [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: root === undefined
      ? { ...process.env, SOOL_TESTS_TALLY: path }
      : { ...process.env, SOOL_TESTS_TALLY: path, SOOL_CHECK_ROOT: root },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** يعبث بملفٍّ **في الجذر المنسوخ** لا في المستودع، ويشترط أن يكون العبثُ غيّر شيئًا */
function withTampered(
  file: string,
  mutate: (text: string) => string,
  assertOn: (r: { code: number; out: string }) => void,
): void {
  withRoot((root) => {
    const p = join(root, file);
    const before = readFileSync(p, 'utf8');
    const next = mutate(before);
    assert.notEqual(next, before, `العبثُ لم يغيّر شيئًا في ${file} — فالتأكيدُ لا يقيس شيئًا`);
    writeFileSync(p, next);
  }, (r) => assertOn(r));
}

// ------------------------------------------------------------------ المسار الموجَب

test('T-128: الفاحص يمرّ على المستودع كما هو، ويعلن الجدولَ والحصيلة معًا', () => {
  const r = runCheck();
  assert.equal(r.code, 0, `الفاحصُ يسقط على المستودع كما هو:\n${r.out}`);
  assert.match(r.out, /جدولُ المجلدات: \d+ صفًّا/);
  assert.match(r.out, /عددُ الاختبارات/);
});

// ------------------------------------------- أبوابُ الرفض: جدولُ المجلدات مقابل الشجرة

test('T-128: عددُ ملفاتٍ متأخّرٌ في صفٍّ يُسقط الفحص', () => {
  withTampered(
    ARCH,
    (t) => t.replace(/^\| `src\/data\/` \| 10 \|/m, '| `src/data/` | 4 |'),
    (r) => {
      assert.equal(r.code, 1, `الجدولُ تأخّر ولم يُسقط الفحص:\n${r.out}`);
      assert.match(r.out, /src\/data/);
    },
  );
});

test('T-128: عددُ أسطرٍ متأخّرٌ في صفٍّ يُسقط الفحص — وهو عينُ ما وقع في الجلسة 43', () => {
  withTampered(
    ARCH,
    (t) => t.replace(/^(\| `src\/data\/` \| 10 \|) 2390 \|/m, '$1 928 |'),
    (r) => {
      assert.equal(r.code, 1, `الأسطرُ تأخّرت ولم يُسقط الفحص:\n${r.out}`);
      assert.match(r.out, /src\/data/);
    },
  );
});

test('T-128: صفٌّ لمجلدٍ غير موجود يُسقط الفحص — فالصفُّ الذي لا مجلدَ له وهم', () => {
  withTampered(
    ARCH,
    (t) =>
      t.replace(
        /^\| `src\/data\/` \|/m,
        '| `src/ministry_of_nothing/` | 3 | 400 | مجلدٌ لا وجودَ له | لا أحد |\n| `src/data/` |',
      ),
    (r) => {
      assert.equal(r.code, 1, `صفٌّ لمجلدٍ معدومٍ مرّ:\n${r.out}`);
      assert.match(r.out, /ministry_of_nothing/);
    },
  );
});

test('T-128: مجلدٌ فيه شفرةٌ ولا صفَّ يغطّيه يُسقط الفحص — فما لا يُذكر لا يُراجَع', () => {
  withRoot(
    (root) => {
      // المجلدُ يُنشأ في شجرةِ الجذر المنسوخ، ولا يُلمس `src/` الحقيقيّ (W-2026-004)
      const dir = join(root, 'src', 'unlisted_probe');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'probe.ts'), 'export const probe = 1;\n');
    },
    (r) => {
      assert.equal(r.code, 1, `مجلدٌ غيرُ مذكورٍ مرّ:\n${r.out}`);
      // يُنسب المجلدُ الذي لا صفَّ له إلى أقربِ صفٍّ يغطّيه، فيتأخّر مجموعُ ذاك الصفّ — ويُسمّى المُتّهم
      assert.match(r.out, /unlisted_probe/);
      assert.match(r.out, /لا صفَّ لها/);
    },
  );
});

test('T-128: إن تغيّرت صيغةُ الجدول فلا يمرّ الفحصُ أعمى، بل يسقط', () => {
  withTampered(
    ARCH,
    (t) => t.replace(/^\| `src\//gm, '- `src/'),
    (r) => {
      assert.equal(r.code, 1, `صيغةُ الجدول ضاعت والفحصُ مرّ:\n${r.out}`);
      assert.match(r.out, /لم يُقرأ صفٌّ واحد/);
    },
  );
});

// -------------------------------------- أبوابُ الرفض: عددُ الاختبارات مقابل المُشغّل

test('T-128: tests.total يخالف خرجَ المُشغّل يُسقط الفحص', () => {
  const n = declaredTests();
  const r = runCheck(tallyFile(n + 7, n + 7, 0));
  assert.equal(r.code, 1, `الرقمُ المنقولُ تأخّر ولم يُسقط الفحص:\n${r.out}`);
  assert.match(r.out, /يتأخّر/);
});

test('T-128: total ≠ passing يُسقط الفحص — فلا يُعلن نجاحُ ما لم ينجح', () => {
  const n = declaredTests();
  const r = runCheck(tallyFile(n, n - 1, 0));
  assert.equal(r.code, 1, `اختلافُ المجموع عن الناجح مرّ:\n${r.out}`);
});

test('T-128: فشلٌ في المُشغّل يُسقط الفحص — ولا يُعلن عددٌ فوق فشل', () => {
  const n = declaredTests();
  const r = runCheck(tallyFile(n, n, 3));
  assert.equal(r.code, 1, `عددٌ أُعلن فوق فشلٍ:\n${r.out}`);
  assert.match(r.out, /فاشلًا/);
});

test('T-128: حصيلةٌ غيرُ مقروءةٍ تُسقط الفحص — والرقمُ الذي لا يُقرأ لا يُصدَّق', () => {
  const r = runCheck(tallyFile(0, 0, 0, 'TAP version 13\nok 1 - لا حصيلةَ في آخره\n'));
  assert.equal(r.code, 1, `حصيلةٌ ناقصةٌ مرّت:\n${r.out}`);
  assert.match(r.out, /غيرُ مقروءة/);
});

// ------------------------------------------------- ما لا يفعله الفاحص، ويُقاس أنه لا يفعله

test('T-128: الفاحصُ يقرأ ولا يُصلح — لا يعدّل ARCHITECTURE.md ولا version.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-num-ro-'));
  try {
    cpSync(join(ROOT, ARCH), join(root, ARCH));
    cpSync(join(ROOT, VERSION), join(root, VERSION));
    cpSync(join(ROOT, 'src'), join(root, 'src'), { recursive: true });
    const archBefore = readFileSync(join(root, ARCH), 'utf8');
    const versionBefore = readFileSync(join(root, VERSION), 'utf8');
    const n = declaredTests(root);
    runCheck(tallyFile(n + 11, n + 11, 0), root); // يسقط، ولا يُصحّح الرقمَ إلى ما قِيس
    assert.equal(readFileSync(join(root, ARCH), 'utf8'), archBefore, 'الفاحصُ عدّل الجدول — والإصلاحُ فعلُ جهةٍ لا أداة');
    assert.equal(readFileSync(join(root, VERSION), 'utf8'), versionBefore, 'الفاحصُ عدّل version.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
