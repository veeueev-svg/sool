/**
 * tests/governance/gn05_tally_gate.test.ts — بوابةُ حصيلة المُشغّل: عيوبُ الجلسة 12 (W-2026-064)
 * المالك: القيّم على المستودع (بند W-2026-064 — توسيعُ الجلسة 105)
 * المدخلات: `scripts/check_generated_numbers.sh` (باب [GN-05]) · `version.json`
 * المخرجات: تأكيدٌ أن حصيلةً ثانيةً مفرَّقةً بفاصلٍ شاذٍ أو مختمةً بذيلٍ شاذٍ أو بصيغةِ رمزٍ
 *   شاذةٍ تُسقط الفحص — فلا تُصدَّقَ نتيجةُ الأولى لأنّ الثانية «لا تطابق النمط».
 * التبعيات: `node:child_process` · `node:fs` · `node:os` · `node:path`
 * الصلاحيات (RULE-004): الاختبار يقرأ الفاحصَ ويصنع حصائله في جذرٍ مؤقّت؛ لا يُصحّح رقمًا.
 *
 * ثوابت هذا الملف:
 * 1) **يقيس الفحص لا يعيد كتابته**: يشغّل الملفَّ الصدفيَّ عينَه (كـgenerated_numbers.test.ts).
 * 2) **الحصيلةُ مصنوعةٌ في جذرٍ مؤقّت** وتُمرَّر بـ`SOOL_TESTS_TALLY` — لا يُلمس `dist/.tests.tap`.
 * 3) **المقيسُ رمزُ الخروج واسمُ العيب** في الخرج — لا نصُّ الرسالة حرفًا.
 *
 * عيوبُ الجلسة 12 المغطّاة (المحضر: docs/work/council/W-2026-064-12.json):
 *   GN05_VERTICAL_TAB_EOL_BYPASS (gpt) · GN05_CR_ONLY_SEPARATOR_BYPASS (grok) ·
 *   GN05_VT_FF_NBSP_EOL_BYPASS (grok) · GN05_TOKEN_SHAPE_BYPASS (grok).
 * وعيوبُ الجلسة 13 المغطّاة (المحضر: docs/work/council/W-2026-064-13.json):
 *   GN05_NBSP_INTERNAL_SHAPE_BYPASS (grok) · GN05_NEL_LS_SEPARATOR_BYPASS (grok) ·
 *   GN05_TOKEN_SHAPE_BYPASS_EXT (grok) — ومعها PS (U+2029): قِيس عند علاجِها (الأمر الملكي م-2026-107) أنّه يمرّ أيضًا
 *   على الشفرة السابقة (رمز 0)، خلافَ ما قيّده تصحيحُ محضر الجلسة 13.
 * وحدُّ التطبيع: فواصلُ Unicode كلُّها (CR · VT · FF · FS/GS/RS · NEL · LS · PS) ومعها NUL
 *   فواصلُ أسطرٍ، وذيلُ السطر من الفراغات (فراغ · جدولة · NBSP) يُزال قبل القياس، وسطرُ
 *   الحصيلةِ الذي يشبه الرمزَ — والشَّبَهُ بنقيضِ الحرف لا بقائمةِ فراغات — ولا يطابقُ شكلَه
 *   المعلن يُرفض بالاسم لا أن يُغفل.
 * اختبار القبول: هذا الملف نفسه — `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const SCRIPT = 'scripts/check_generated_numbers.sh';
const VERSION_FILE = 'version.json';

/** عددُ الاختبارات المعلن في version.json — حصيلةُ التطابق تُبنى عليه */
function declaredTests(): number {
  const v = JSON.parse(readFileSync(join(ROOT, VERSION_FILE), 'utf8')) as { tests: { total: number } };
  return v.tests.total;
}

/** حصيلةٌ مصنوعةٌ في جذرٍ مؤقّت — تُمرَّر بـSOOL_TESTS_TALLY فلا يُلمس ملفُّ الحصيلة الحقيقيّ */
function tallyFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-gn05-'));
  const path = join(dir, 'tests.tap');
  writeFileSync(path, body);
  return path;
}

/** يشغّل الفاحصَ على المستودع كما هو، بحصيلةٍ مصنوعةٍ وحدها */
function runCheck(body: string): { code: number; out: string } {
  const r = spawnSync('bash', [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SOOL_TESTS_TALLY: tallyFile(body) },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** حصيلةٌ سليمةٌ واحدة بعدد version.json — الأساسُ الذي تُقاس عليه الشواذ */
function soundTally(): string {
  const n = declaredTests();
  return `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
}

/** حصيلةٌ ثانية كاملة بعددٍ مختلف — تُفرَّق بفاصلٍ أو تُختم بذيلٍ بحسب العيب المُقاس */
function secondTally(separator: string, tail: string): string {
  const n = declaredTests();
  const first = `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
  const second = `TAP version 13${tail}${separator}# tests ${n - 11}${tail}${separator}# pass ${n - 12}${tail}${separator}# fail 1${tail}${separator}`;
  return first + second;
}

test('GN-05/12: الفاحص يمرّ بحصيلةٍ سليمةٍ واحدة — فالحراسةُ لا ترفض الصحيح', () => {
  const r = runCheck(soundTally());
  assert.equal(r.code, 0, `حصيلةٌ سليمةٌ رُفضت:\n${r.out}`);
  assert.match(r.out, /✓ عددُ الاختبارات/);
});

test('GN-05/12: حصيلةٌ ثانيةٌ يفصلها VT تُسقط الفحص — لا تُصدَّق نتيجةُ الأولى (GN05_VERTICAL_TAB_EOL_BYPASS)', () => {
  const r = runCheck(secondTally('\v', ''));
  assert.equal(r.code, 1, `حصيلةٌ مفرَّقةٌ بـVT مرّت:\n${r.out}`);
  assert.match(r.out, /\[GN-05\]/);
  assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/);
});

test('GN-05/12: حصيلةٌ ثانيةٌ يفصلها FF تُسقط الفحص (GN05_VT_FF_NBSP_EOL_BYPASS)', () => {
  const r = runCheck(secondTally('\f', ''));
  assert.equal(r.code, 1, `حصيلةٌ مفرَّقةٌ بـFF مرّت:\n${r.out}`);
  assert.match(r.out, /\[GN-05\]/);
});

test('GN-05/12: حصيلةٌ ثانيةٌ مفصولةٌ بـCR وحده تُسقط الفحص — لا حذفَ للـCR يلحم سطرين (GN05_CR_ONLY_SEPARATOR_BYPASS)', () => {
  const r = runCheck(secondTally('\r', ''));
  assert.equal(r.code, 1, `حصيلةٌ مفصولةٌ بـCR وحده مرّت:\n${r.out}`);
  assert.match(r.out, /\[GN-05\]/);
  assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/);
});

test('GN-05/12: حصيلةٌ ثانيةٌ أسطرها مختمةٌ بـNBSP تُسقط الفحص (GN05_VT_FF_NBSP_EOL_BYPASS)', () => {
  const r = runCheck(secondTally('\n', '\u00A0'));
  assert.equal(r.code, 1, `حصيلةٌ مختمةٌ بـNBSP مرّت:\n${r.out}`);
  assert.match(r.out, /\[GN-05\]/);
  assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/);
});

test('GN-05/12: حصيلةٌ ثانيةٌ برمزٍ بمسافةٍ قائدة تُسقط الفحص وتُسمّى — لا أن تُغفل (GN05_TOKEN_SHAPE_BYPASS)', () => {
  const n = declaredTests();
  const body = `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\nTAP version 13\n # tests ${n - 11}\n # pass ${n - 12}\n # fail 1\n`;
  const r = runCheck(body);
  assert.equal(r.code, 1, `رمزٌ بمسافةٍ قائدة مرّ:\n${r.out}`);
  assert.match(r.out, /\[GN-05\]/);
  assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/);
  assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/);
});

test('GN-05/12: حصيلةٌ ثانيةٌ بمسافتين بين الرمز والعدد تُسقط الفحص وتُسمّى (GN05_TOKEN_SHAPE_BYPASS)', () => {
  const n = declaredTests();
  const body = `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\nTAP version 13\n# tests  ${n - 11}\n# pass  ${n - 12}\n# fail  1\n`;
  const r = runCheck(body);
  assert.equal(r.code, 1, `رمزٌ بمسافتين مرّ:\n${r.out}`);
  assert.match(r.out, /\[GN-05\]/);
  assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/);
  assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/);
});

test('GN-05/12: الحصيلةُ السليمةُ نفسها بذيولٍ حميدة (فراغ زائد · NBSP) تمرّ — التطبيعُ لا يرفض الصحيح', () => {
  const n = declaredTests();
  const body = `TAP version 13\n# tests ${n} \n# pass ${n}\u00A0\n# fail 0\n`;
  const r = runCheck(body);
  assert.equal(r.code, 0, `حصيلةٌ سليمةُ الجوهرِ بذيلٍ حميدٍ رُفضت:\n${r.out}`);
  assert.match(r.out, /✓ عددُ الاختبارات/);
});

// ── عيوبُ الجلسة 13 (W-2026-064 · الجلسة 107) ─────────────────────────────────

/** حصيلةٌ ثانيةٌ متعارضة: `pre` قبل الرمز · `mid` بين `#` والكلمة · `sep` فاصلُ الأسطر */
function conflicting(sep: string, pre = '', mid = ' '): string {
  const n = declaredTests();
  const first = `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
  const line = (word: string, value: number) => `${pre}#${mid}${word} ${value}${sep}`;
  return `${first}TAP version 13${sep}${line('tests', n - 11)}${line('pass', n - 12)}${line('fail', 1)}`;
}

/** يُسقط الفحصَ بـ[GN-05] ولا يُطبع ✓ — لكلِّ حالةٍ باسمها في رسالة الفشل */
function assertRejected(label: string, body: string): { out: string } {
  const r = runCheck(body);
  assert.equal(r.code, 1, `${label}: حصيلتان متعارضتان مرّتا:\n${r.out}`);
  assert.match(r.out, /\[GN-05\]/, `${label}: لم يُسمَّ الباب`);
  assert.doesNotMatch(r.out, /✓ عددُ الاختبارات/, `${label}: صُدِّق رقمُ الأولى`);
  return r;
}

test('GN-05/13: NBSP بين العلامة والكلمة يُرى شبيهًا ويُرفض بالاسم (GN05_NBSP_INTERNAL_SHAPE_BYPASS)', () => {
  const r = assertRejected('NBSP-داخل', conflicting('\n', '', '\u00A0'));
  assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/);
  assert.match(r.out, /M-BM- /, 'السطرُ الشاذُّ لا يُطبع مرئيًّا (cat -v)');
});

test('GN-05/13: NBSP قبل العلامة يُرى شبيهًا ويُرفض (GN05_NBSP_INTERNAL_SHAPE_BYPASS)', () => {
  assertRejected('NBSP-قائد', conflicting('\n', '\u00A0'));
});

test('GN-05/13: حصيلةٌ ثانيةٌ تفصلها NEL أو LS أو PS تُسقط الفحص (GN05_NEL_LS_SEPARATOR_BYPASS)', () => {
  for (const [label, sep] of [['NEL', '\u0085'], ['LS', '\u2028'], ['PS', '\u2029']] as const) {
    assertRejected(label, conflicting(sep));
  }
});

test('GN-05/13: فواصلُ FS وGS وRS وNUL فواصلُ أسطرٍ لا لُحمة (GN05_NEL_LS_SEPARATOR_BYPASS — امتداد)', () => {
  for (const [label, sep] of [['FS', '\u001C'], ['GS', '\u001D'], ['RS', '\u001E'], ['NUL', '\u0000']] as const) {
    assertRejected(label, conflicting(sep));
  }
});

test('GN-05/13: الشَّبَهُ بنقيض الحرف لا بقائمة فراغات — فراغاتُ Unicode والعلامةُ العريضةُ والحالةُ (GN05_TOKEN_SHAPE_BYPASS_EXT)', () => {
  const n = declaredTests();
  const first = `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
  const cases: Array<[string, string]> = [
    ['EM SPACE داخل', conflicting('\n', '', '\u2003')],
    ['ZWSP قائد', conflicting('\n', '\u200B')],
    ['FULLWIDTH علامة', `${first}\uFF03 tests ${n - 11}\n\uFF03 pass ${n - 12}\n\uFF03 fail 1\n`],
    ['بلا علامة', `${first}tests ${n - 11}\npass ${n - 12}\nfail 1\n`],
    ['حالةُ الحروف', `${first}#${' '}Tests ${n - 11}\n#${' '}Pass ${n - 12}\n#${' '}Fail 1\n`],
    ['أرقامٌ هندية', `${first}#${' '}tests \u0662\u0664\n`],
    ['رمزان في سطر', `${first}x #${' '}tests ${n - 11}\n`],
  ];
  for (const [label, body] of cases) {
    const r = assertRejected(label, body);
    assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/, `${label}: لم يُسمَّ العيب`);
  }
});

test('GN-05/13: الكاشفُ لا يرفض الصحيح — أسطرُ node الأخرى ونصٌّ عربيٌّ فيه البايت 0x85 تمرّ', () => {
  const n = declaredTests();
  // «م» = D9 85: البايتُ 0x85 تابعٌ لا NEL — فلا يُقطع سطرٌ عربيٌّ ولا يُرى رمزًا
  const body = `TAP version 13\nok 1 - مسارٌ معلومٌ مُقاس\n1..${n}\n# tests ${n}\n# suites 0\n`
    + `# pass ${n}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1.5\n`;
  const r = runCheck(body);
  assert.equal(r.code, 0, `حصيلةُ node السليمةُ رُفضت:\n${r.out}`);
  assert.match(r.out, /✓ عددُ الاختبارات/);
});

// ── عيوبُ الجلسة 14 (W-2026-064 · الجلسة 107) ─────────────────────────────────
// المحضر: docs/work/council/W-2026-064-14.json. والمسابيرُ بحرفِ تقريرَي gpt وgrok الخامَّين.

/** حصيلةٌ ثانيةٌ متعارضة يصنع كلَّ سطرٍ منها `shape(word, value)` — بعد حصيلةٍ أولى سليمة */
function conflictingShaped(shape: (word: string, value: number) => string): string {
  const n = declaredTests();
  const first = `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
  return `${first}TAP version 13\n${shape('tests', n - 11)}\n${shape('pass', n - 12)}\n${shape('fail', 1)}\n`;
}

test('GN-05/14: تعليقُ TAP مشروعٌ يبدأ بالرمز وتتلوه كلمةٌ لا عدد لا يُرفض (GN05_VALID_TAP_COMMENT_FALSE_REJECT)', () => {
  const n = declaredTests();
  for (const comment of ['# tests completed without failures', '# tests_total note', '# Pass-through suite ok']) {
    const body = `TAP version 13\n${comment}\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
    const r = runCheck(body);
    assert.equal(r.code, 0, `«${comment}» مع حصيلةٍ سليمةٍ رُفض:\n${r.out}`);
    assert.match(r.out, /✓ عددُ الاختبارات/);
  }
});

test('GN-05/14: الرمزُ يتلوه عددٌ ولو بلا فراغٍ أو بعد علامات — يُقرأ حصيلةً فيُرفض شاذُّه (حدُّ نحوِ TAP)', () => {
  for (const [label, shape] of [
    ['ملتصق', (w: string, v: number) => `# ${w}${v}`],
    ['نقطتان', (w: string, v: number) => `# ${w}: ${v}`],
  ] as const) {
    const r = assertRejected(label, conflictingShaped(shape));
    assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/, `${label}: لم يُسمَّ العيب`);
  }
});

test('GN-05/14: علامةٌ خفيّةٌ داخل الكلمة (ZWSP · WJ · SHY · BOM · RLM · NUL) تُرى وتُرفض (GN05_INTRAWORD_INVISIBLE_BYPASS)', () => {
  for (const [label, mark] of [
    ['ZWSP', '\u200B'], ['WJ', '\u2060'], ['SHY', '\u00AD'], ['BOM', '\uFEFF'], ['RLM', '\u200F'],
    ['TAG', '\u{E0041}'], ['NUL', '\u0000'],
  ] as const) {
    const r = assertRejected(label, conflictingShaped((w, v) => `# ${w.slice(0, 1)}${mark}${w.slice(1)} ${v}`));
    assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/, `${label}: لم يُسمَّ العيب`);
  }
});

test('GN-05/14: تسلسلاتُ ESC وCSI والضوابطُ لا تُعمي الكاشف (GN05_CSI_COMMAND_SHAPE_BYPASS)', () => {
  for (const [label, shape] of [
    ['ESC[m', (w: string, v: number) => `# \u001b[m${w} ${v}`],
    ['ESC[0m', (w: string, v: number) => `# \u001b[0m${w} ${v}`],
    ['ESC[1;31m داخل', (w: string, v: number) => `# ${w.slice(0, 2)}\u001b[1;31m${w.slice(2)} ${v}`],
    ['OSC', (w: string, v: number) => `# \u001b]0;t\u0007${w} ${v}`],
    ['CSI ثمانيّ', (w: string, v: number) => `# \u009bm${w} ${v}`],
    ['BS فوق حرف', (w: string, v: number) => `# ${w.slice(0, 2)}X\b${w.slice(2)} ${v}`],
    ['DEL', (w: string, v: number) => `# ${w.slice(0, 2)}\u007f${w.slice(2)} ${v}`],
  ] as const) {
    const r = assertRejected(label, conflictingShaped(shape));
    assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/, `${label}: لم يُسمَّ العيب`);
  }
});

test('GN-05/14: سطرٌ مطابقٌ معروضًا وفي خامِّه خفيٌّ يُرفض ولو كانت الحصيلةُ واحدة — المعروضُ لا يكفي', () => {
  const n = declaredTests();
  const body = `TAP version 13\n# tests ${n}\n# \u001b[0mpass ${n}\n# fail 0\n`;
  const r = runCheck(body);
  assert.equal(r.code, 1, `سطرٌ فيه CSI خفيٌّ قُبل:\n${r.out}`);
  assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/);
  assert.match(r.out, /\^\[\[0m/, 'السطرُ الشاذُّ لا يُطبع مرئيًّا (cat -v)');
});

test('GN-05/14: أسماءُ اختباراتٍ فيها علاماتٌ خفيّةٌ وتسلسلاتٌ لا تشبه الحصيلة تمرّ — الكاشفُ لا يرفض الصحيح', () => {
  const n = declaredTests();
  const body = `TAP version 13\nok 1 - اسمٌ\u200Cعربيٌّ \u001b[32mملوّن\u001b[0m\n# Subtest: tests\u200B of pass/fail\n`
    + `1..${n}\n# tests ${n}\n# suites 0\n# pass ${n}\n# fail 0\n# cancelled 0\n# duration_ms 2.5\n`;
  const r = runCheck(body);
  assert.equal(r.code, 0, `حصيلةٌ سليمةٌ بأسماءٍ فيها خفيٌّ رُفضت:\n${r.out}`);
  assert.match(r.out, /✓ عددُ الاختبارات/);
});

// ── عيبا الجلسة 15 (W-2026-064 · الجلسة 107) ──────────────────────────────────
// المحضر: docs/work/council/W-2026-064-15.json. والمسابيرُ بحرفِ تقريرَي grok وgpt الخامَّين.

test('GN-05/15: نهائيُّ التسلسل في @–\\ لا يأكل حرفَ البيانات بعده (GN05_ESCAPE_FINAL_EATEN_BYPASS)', () => {
  for (const [label, shape] of [
    ['ESC A', (w: string, v: number) => `# \u001bA${w} ${v}`],
    ['ESC[A', (w: string, v: number) => `# \u001b[A${w} ${v}`],
    ['ESC[0@', (w: string, v: number) => `# \u001b[0@${w} ${v}`],
    ['ESC[@', (w: string, v: number) => `# \u001b[@${w} ${v}`],
    ['ESC[Z', (w: string, v: number) => `# \u001b[Z${w} ${v}`],
    ['ESC \\', (w: string, v: number) => `# \u001b\\${w} ${v}`],
    ['CSI ثمانيّ ثم A', (w: string, v: number) => `# \u009bA${w} ${v}`],
    ['ESC[A داخل الكلمة', (w: string, v: number) => `# ${w.slice(0, 2)}\u001b[A${w.slice(2)} ${v}`],
  ] as const) {
    const r = assertRejected(label, conflictingShaped(shape));
    assert.match(r.out, /GN05_TOKEN_SHAPE_BYPASS/, `${label}: لم يُسمَّ العيب`);
  }
});

test('GN-05/15: سطرُ fail واحدٌ مخفيٌّ بـESC A بعد حصيلةٍ سليمة يُرفض — لا يُصدَّق fail 0 (GN05_ESCAPE_FINAL_EATEN_BYPASS)', () => {
  const n = declaredTests();
  for (const esc of ['\u001bA', '\u001b[A']) {
    assertRejected(`fail مخفيّ ${JSON.stringify(esc)}`, `TAP version 13\n# tests ${n}\n# pass ${n}\n# fail 0\n# ${esc}fail 1\n`);
  }
});

test('GN-05/15: تعليقُ TAP عدديٌّ يتلوه كلامٌ لا يُرفض — الحصيلةُ يختمها العدد (GN05_VALID_TAP_NUMERIC_COMMENT_FALSE_REJECT)', () => {
  const n = declaredTests();
  for (const comment of [`# tests ${n} completed without failures`, `# pass 3 of the retry suite`, `# fail 0 expected here`]) {
    const body = `TAP version 13\n${comment}\n# tests ${n}\n# pass ${n}\n# fail 0\n`;
    const r = runCheck(body);
    assert.equal(r.code, 0, `«${comment}» مع حصيلةٍ سليمةٍ رُفض:\n${r.out}`);
    assert.match(r.out, /✓ عددُ الاختبارات/);
  }
});
