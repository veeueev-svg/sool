/**
 * tests/governance/generated_numbers.test.ts — فاحصُ الأرقام المنقولة (المرحلة 40، البند T-128)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_generated_numbers.sh` · `ARCHITECTURE.md` · `version.json` · `src/`
 * المخرجات: تأكيدٌ أن الفاحص يمرّ على المستودع كما هو، ويسقط على كل رقمٍ تأخّر عن مصدره
 * التبعيات: `node:child_process` (يشغّل الفحص كما تشغّله البوابة) · `node:fs`
 * الصلاحيات (RULE-004): الاختبار يقرأ ويعبث مؤقّتًا ويستعيد؛ لا يُصحّح رقمًا ولا يُرقّي حالة
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: عددُ ملفاتٍ متأخّر · عددُ أسطرٍ متأخّر · صفٌّ لمجلدٍ غير موجود ·
 *   مجلدٌ فيه شفرةٌ ولا صفَّ له · tests.total يخالف المُشغّل · total ≠ passing · فشلٌ ·
 *   حصيلةٌ غيرُ مقروءة · صيغةٌ تغيّرت · مشيةٌ سقطت · سقوطٌ بلا `not ok` · حصرٌ أعمى ×2 ·
 *   حصيلةٌ متعددةُ النتائج (GN-05)
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-T128.md · ARCHITECTURE.md §«خريطة المجلدات»
 *
 * ثوابت هذا الملف:
 * 1) **يقيس الفحص لا يعيد كتابته**: يشغّل الملفَّ الصدفيَّ عينَه (كـdeclaration_gate.test.ts).
 * 2) **العبثُ مؤقّت ومُستعاد**: كل حالةٍ سلبية تُرجع الأصل في `finally` وما أُنشئ يُحذف.
 * 3) **المقيسُ رمزُ الخروج**: الإسقاطُ هو المقيس لا نصُّ الرسالة.
 *
 * 4) **حصيلةُ المُشغّل تُمرَّر مصنوعةً** (`SOOL_TESTS_TALLY`) لا مقروءةً من `dist/.tests.tap`:
 *    فلا تكتمل الحقيقيّةُ إلا بعد انتهاء المُشغّل. **فالمُختبرُ منطقُ المقابلة، والمقابلةُ على
 *    الحصيلة الحقيقيّة تقع في البوابة** — انحرافٌ معلن (RULE-008).
 * 5) **(T-154) مُشغّلُ حالاتِ المشية مصنوعٌ في جذرٍ مؤقّت**: أبوابُ `[GN-01…GN-05]` تُقاس بجذرٍ
 *    `package.json`ـه أمرُ اختبارٍ صدفيٌّ يُصنع لكلِّ حالة — فلا تُشغّل المجموعةُ الحقيقيّةُ داخلَها.
 * 6) **(T-154) كلُّ فرعٍ يسأل عن وجودِ ملفٍّ يُثبَّت مساره** بـ`SOOL_TESTS_RUN_LOG`.
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
 * ينسخ ما يقرأه الفاحص (جدولُ المجلدات والرقمُ المُعلن وشجرةُ `src/`) إلى جذرٍ في tmpdir
 * يُمرَّر بـ`SOOL_CHECK_ROOT`، فلا تُحرّف حالةٌ سلبيّةٌ ملفًّا حقيقيًّا (W-2026-004: node يشغّل
 * ملفّاتِ الاختبار بالتوازي، فما حرّفته واحدةٌ تقرأه أخرى حكمًا).
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

function runCheck(tally?: string, root?: string, extraEnv: Record<string, string> = {}): { code: number; out: string } {
  const n = declaredTests(root ?? ROOT);
  const path = tally ?? tallyFile(n, n, 0);
  const r = spawnSync('bash', [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: root === undefined
      ? { ...process.env, SOOL_TESTS_TALLY: path, ...extraEnv }
      : { ...process.env, SOOL_TESTS_TALLY: path, SOOL_CHECK_ROOT: root, ...extraEnv },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** **(T-154)** مسارُ خرجٍ محفوظٍ **لا وجودَ له** — يُثبّت فرعَ رسالةِ `[GN-04]` (الثابت 6) */
function absentRunLog(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-runlog-'));
  rmSync(dir, { recursive: true, force: true });
  return join(dir, 'dist/.tests.run.log');
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

test('T-128: عددُ ملفاتٍ متأخّرٌ في صفٍّ يُسقط الفحص — والعددُ يُقرأ من الصفّ لا يُثبَّت حرفًا (W-2026-040)', () => {
  withTampered(
    ARCH,
    (t) => t.replace(/^\| `src\/data\/` \| (\d+) \|/m, (_m, n) => `| \`src/data/\` | ${Number(n) - 1} |`),
    (r) => {
      assert.equal(r.code, 1, `الجدولُ تأخّر ولم يُسقط الفحص:\n${r.out}`);
      assert.match(r.out, /src\/data/);
    },
  );
});

test('T-128: عددُ أسطرٍ متأخّرٌ في صفٍّ يُسقط الفحص — وهو عينُ ما وقع في الجلسة 43', () => {
  withTampered(
    ARCH,
    (t) => t.replace(/^(\| `src\/data\/` \| \d+ \|) (\d+) \|/m, (_m, head, n) => `${head} ${Number(n) - 7} |`),
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

// ------------------------------------------ (T-154) مشيةُ المُشغّل: خرجٌ محفوظٌ وساقطٌ مُسمًّى

/**
 * جذرٌ مؤقّتٌ فيه ما يقرأه الفاحصُ **ومُشغّلٌ مصنوع**: `npm test` فيه يشغّل ملفًّا صدفيًّا يكتبه
 * الاختبار. فيُقاس بابُ «الحاجزُ يشغّل المجموعةَ بنفسه» على طريقِه الحقيقيّ بلا ركوبِ نفسِه.
 * ولا يُمرَّر `SOOL_TESTS_TALLY` هنا قصدًا: وجودُه يُسكت فرعَ التشغيل، وهو المقيسُ.
 */
function withFakeRunner(runner: string, assertOn: (r: { code: number; out: string }, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-run-'));
  try {
    cpSync(join(ROOT, ARCH), join(root, ARCH));
    cpSync(join(ROOT, VERSION), join(root, VERSION));
    cpSync(join(ROOT, 'src'), join(root, 'src'), { recursive: true });
    const pkg = { name: 'sool-fake-runner', version: '0.0.0', private: true, scripts: { test: 'bash ./fake_runner.sh' } };
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    writeFileSync(join(root, 'fake_runner.sh'), runner);
    const env: NodeJS.ProcessEnv = { ...process.env, SOOL_CHECK_ROOT: root };
    delete env.SOOL_TESTS_TALLY;
    delete env.SOOL_TESTS_RUN_LOG;
    const r = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8', env });
    assertOn({ code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('T-154: مشيةٌ ساقطةٌ يُحفظ خرجُها ويُسمّى ساقطُها بالاسمِ والموضع — [GN-01]', () => {
  withFakeRunner(
    [
      'mkdir -p dist/tests',
      // حصيلةٌ **سليمةٌ مطابقةٌ** ثمّ سقوطٌ: فلولا إسقاطُ الحاجزِ للمشيةِ الساقطةِ لَأعلن ✓ — وهو
      // ما يقيسه تأكيدُ الرمزِ أدناه، لا حاجزٌ آخرُ بعده.
      'N=$(sed -n \'s/.*"total"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p\' version.json | head -1)',
      'printf "TAP version 13\\n# tests %s\\n# pass %s\\n# fail 0\\n" "$N" "$N" > dist/.tests.tap',
      'echo "TAP version 13"',
      'echo "not ok 7 - قبول مصنوع: تأكيدٌ يسقط ليُسمّى"',
      'echo "  ---"',
      "echo \"  location: 'dist/tests/probe/fake.test.js:42:1'\"",
      'echo "  ..."',
      'printf "# tests 7\\n# pass 6\\n# fail 1\\n"',
      'exit 1',
      '',
    ].join('\n'),
    (r, root) => {
      assert.equal(r.code, 1, `المشيةُ سقطت والفاحصُ مرّ:\n${r.out}`);
      assert.match(r.out, /\[GN-01\]/);
      // الاسمُ والموضعُ يُطبعان — وهذا هو البندُ كلُّه: الفشلُ يُسمّى ولا يُعَدُّ فقط
      assert.match(r.out, /قبول مصنوع: تأكيدٌ يسقط ليُسمّى/);
      assert.match(r.out, /dist\/tests\/probe\/fake\.test\.js:42:1/);
      // والخرجُ محفوظٌ في ملفٍّ يُطبع مسارُه ويوجد فعلًا وفيه ما وقع
      assert.match(r.out, /dist\/\.tests\.run\.log/);
      const log = readFileSync(join(root, 'dist/.tests.run.log'), 'utf8');
      assert.match(log, /not ok 7/, 'الخرجُ حُفظ فارغًا — والملفُّ الذي لا يحفظ لا يُشخّص');
      // ولا يُعلن حكمُ الحصرِ الأعمى حين يكون الساقطُ مُسمًّى
      assert.doesNotMatch(r.out, /\[GN-02\]/);
    },
  );
});

test('T-154: مشيةٌ سقطت ولا سطرَ `not ok` في خرجِها تُسقط الفحصَ بحكمِ الحصرِ الأعمى — [GN-02]', () => {
  withFakeRunner(
    [
      // سقوطُ بناءٍ قبل الاختبارات: لا حصيلةَ ولا اسمَ تأكيدٍ — وهو أخطرُ الحالتَين
      'echo "src/kernel/x.ts(3,7): error TS2322: نوعٌ لا يوافق"',
      'echo "خرجَ المُشغّلُ قبل أن يبدأ"',
      'exit 2',
      '',
    ].join('\n'),
    (r) => {
      assert.equal(r.code, 1, `مشيةٌ سقطت بلا اسمٍ ومرّت:\n${r.out}`);
      assert.match(r.out, /\[GN-02\]/);
      assert.match(r.out, /حصرٌ أعمى/);
      // آخرُ ما قاله المُشغّلُ يُطبع، فلا يُترك الساقطُ بلا خبرٍ أصلًا
      assert.match(r.out, /error TS2322/);
      // ولا يُعلن نجاحُ عددٍ فوق سقوطٍ لم يُسمَّ
      assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/);
    },
  );
});

test('T-154: مشيةٌ ناجحةٌ يُطبع مسارُ خرجِها المحفوظِ أيضًا — فالخرجُ لا يُرمى في حالٍ', () => {
  withFakeRunner(
    [
      'mkdir -p dist/tests',
      'N=$(sed -n \'s/.*"total"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p\' version.json | head -1)',
      'printf "TAP version 13\\n# tests %s\\n# pass %s\\n# fail 0\\n" "$N" "$N" | tee dist/.tests.tap',
      'exit 0',
      '',
    ].join('\n'),
    (r, root) => {
      assert.equal(r.code, 0, `مشيةٌ ناجحةٌ أُسقطت:\n${r.out}`);
      assert.match(r.out, /خرجُ المشيةِ محفوظٌ في/);
      const log = readFileSync(join(root, 'dist/.tests.run.log'), 'utf8');
      assert.match(log, /# fail 0/, 'الناجحةُ لم يُحفظ خرجُها — وما لا يُحفظ لا يُقاس بعدُ');
    },
  );
});

test('T-154: حصيلةٌ تعدُّ فشلًا وفيها أسماءُ الساقطين تُسمّيهم — [GN-03]', () => {
  const n = declaredTests();
  const r = runCheck(
    tallyFile(
      n,
      n - 2,
      2,
      'TAP version 13\n' +
        'not ok 11 - قبول مصنوع: أوّلُ ساقطٍ يُسمّى\n' +
        "  location: 'dist/tests/probe/a.test.js:9:3'\n" +
        'not ok 12 - قبول مصنوع: ثانيهما يُسمّى كذلك\n' +
        `# tests ${n}\n# pass ${n - 2}\n# fail 2\n`,
    ),
  );
  assert.equal(r.code, 1, `فشلٌ معدودٌ مرّ:\n${r.out}`);
  assert.match(r.out, /\[GN-03\]/);
  assert.match(r.out, /أوّلُ ساقطٍ يُسمّى/);
  assert.match(r.out, /ثانيهما يُسمّى كذلك/);
  assert.match(r.out, /dist\/tests\/probe\/a\.test\.js:9:3/);
  assert.doesNotMatch(r.out, /\[GN-04\]/);
});

test('T-154: حصيلةٌ تعدُّ فشلًا بلا اسمِ ساقطٍ تُسقط الفحصَ بحكمٍ ثانٍ للحصرِ الأعمى — [GN-04]', () => {
  const n = declaredTests();
  // مسارُ الخرجِ المحفوظِ **مُثبَّتٌ على غيرِ موجود**، فالفرعُ مقيسٌ لا مُصادَف
  const r = runCheck(tallyFile(n, n - 1, 1), undefined, { SOOL_TESTS_RUN_LOG: absentRunLog() });
  assert.equal(r.code, 1, `عددٌ فوق فشلٍ مرّ:\n${r.out}`);
  assert.match(r.out, /\[GN-03\]/);
  assert.match(r.out, /\[GN-04\]/);
  assert.match(r.out, /حصرٌ أعمى/);
  // ويُقال للقارئِ أين يُنظر: لا خرجَ محفوظًا حين لم يشغّل الحاجزُ المشيةَ بنفسه
  assert.match(r.out, /ولا خرجَ محفوظًا هنا/);
  assert.match(r.out, /npm test/);
});

test('T-154: حين يوجد خرجٌ محفوظٌ يُدَلُّ عليه بمسارِه لا بأمرٍ يُعاد — [GN-04]', () => {
  const n = declaredTests();
  const dir = mkdtempSync(join(tmpdir(), 'sool-runlog-'));
  const log = join(dir, 'saved.run.log');
  try {
    writeFileSync(log, 'TAP version 13\nnot ok 3 - قبول مصنوع: ساقطٌ في خرجٍ محفوظ\n');
    const r = runCheck(tallyFile(n, n - 1, 1), undefined, { SOOL_TESTS_RUN_LOG: log });
    assert.equal(r.code, 1, `عددٌ فوق فشلٍ مرّ:\n${r.out}`);
    assert.match(r.out, /\[GN-04\]/);
    assert.match(r.out, /ويُنظر في خرجِ المشيةِ المحفوظ/);
    assert.ok(r.out.includes(log), `لم يُطبع مسارُ الخرجِ المحفوظ:\n${r.out}`);
    assert.doesNotMatch(r.out, /ولا خرجَ محفوظًا هنا/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-128: حصيلةٌ متعددةُ النتائج من تشغيلين متزامنين تُسقط الفحص — [GN-05]', () => {
  const n = declaredTests();
  const body = `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\nTAP version 13\n# tests ${n - 1}\n# pass ${n - 2}\n# fail 1\n`;
  const r = runCheck(tallyFile(n, n, 0, body));
  assert.equal(r.code, 1);
  assert.match(r.out, /\[GN-05\]/);
  assert.match(r.out, /TEST_TALLY_APPEND_RACE/);
  assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/);
});

