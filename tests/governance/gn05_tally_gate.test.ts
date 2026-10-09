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
 * وحدُّ التطبيع: CR وVT وFF فواصلُ أسطرٍ (لا حذفَ للـCR يلحم سطرين)، وذيلُ السطر من
 *   الفراغات (فراغ · جدولة · NBSP) يُزال قبل القياس، وسطرُ الحصيلةِ الذي يشبه الرمزَ ولا
 *   يطابقُ شكلَه المعلن يُرفض بالاسم لا أن يُغفل.
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
