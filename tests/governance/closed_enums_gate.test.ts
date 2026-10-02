/**
 * tests/governance/closed_enums_gate.test.ts — بوابةُ التعدادات المغلقة (المرحلة 40، البند T-136)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_closed_enums.sh` كما تشغّله البوابةُ نفسُها + جذورٌ منسوخةٌ في tmpdir
 * المخرجات: تأكيدُ أنّ الفحصَ يمرّ على المستودع كما هو، ويسقط برمزه على كلِّ بابٍ يُفتح
 * التبعيات: `node:child_process` (يشغّل الملفَّ الصدفيَّ عينَه) · `node:fs` · `node:os`
 * الصلاحيات (RULE-004): يقرأ المستودعَ ولا يكتب فيه حرفًا؛ كلُّ عبثٍ في جذرٍ منسوخ
 * السجلات: خرجُ الفحص يُقرأ ويُرفَق في رسالة التأكيد عند السقوط
 * حالات الفشل المُغطّاة: تعدادٌ مغلقٌ بنمطِ اسمٍ مخالفٍ غيرُ مُسجَّل (علّةُ T-136) · استثناءٌ
 *   بلا سبب · استثناءٌ لاسمٍ معدوم · اسمٌ مُسجَّلٌ ومستثنًى معًا · استثناءٌ باصطلاحِ الاسم
 *   المغلق · صفٌّ في السجل بلا تعدادٍ · اسمٌ مغلقٌ بلا تجميدٍ ولا تسجيل · حصرٌ أعمى
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/decisions/ADR-0035-closed-enum-bounds.md
 *   · القياسُ الخام: docs/audit/measurements/phase-40-T136.txt
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الفحصَ لا يعيد كتابته**: يشغّل `scripts/check_closed_enums.sh` عينَه الذي
 *    تشغّله البوابةُ وCI — فلا يمرّ اختبارٌ على منطقِ نسخةٍ ثانيةٍ ثمّ تسقط البوابةُ على الأصل.
 *
 * 2) **لا حالةَ تلمس ملفًّا حقيقيًّا (درسُ W-2026-004)**: node يشغّل ملفّاتِ الاختبار
 *    بالتوازي، فمن حرّف ملفًّا في المستودع أسقط بوابةَ غيره بالاحتمال. فكلُّ حالةٍ سلبيّةٍ
 *    تعمل في **جذرٍ منسوخٍ** يُوجَّه إليه الفحصُ بـ`SOOL_CHECK_ROOT`، ولم يبقَ على المستودع
 *    الحقيقيّ إلّا **المسارُ الموجَبُ القارئُ وحدَه**.
 *
 * 3) **المقيسُ رمزُ الخروج، والمُطابَقُ رمزُ الحكمِ `[CE-NN]` مع اسمِ التعداد — لا نصٌّ
 *    عربيٌّ مشكول**: نصُّ البيان يُنقَّح ويُشكَل، فمطابقتُه تكسر الاختبارَ على تحسينِ صياغةٍ
 *    لا على انفتاحِ باب. ورمزُ الخروجِ وحدَه لا يكفي: **قيسَ في التطفير** أنّ خمسَ طفراتٍ
 *    نجت حين كان التأكيدُ على الرمزِ والاسمِ فقط، لأنّ حارسًا آخرَ كان يُسقط الرمزَ نفسَه
 *    ويذكر الاسمَ نفسَه فيُغطّي على أخيه. فصار كلُّ تأكيدٍ يشترط **رمزَ حارسه** بعينه.
 *
 * 4) **رمزُ الخروجِ لا يُقرأ معزولًا عن خرجِه**: انهيارُ `set -e` يُنتج الرمزَ 1 بلا حكم،
 *    وهي حالٌ مقيسةٌ وقعت في هذه البوابة نفسِها أثناء T-136 (حالة «ح» في القياس الخام).
 *    فحالةُ الحصر الأعمى تشترط **سطرَ البيان** مع الرمز، وإلّا كان الاختبارُ يقبل انهيارًا.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = 'scripts/check_closed_enums.sh';
const REGISTRY = 'src/kernel/config/closed_enums.ts';

function runCheck(root: string): { code: number; out: string } {
  const r = spawnSync('bash', [join(ROOT, SCRIPT)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOOL_CHECK_ROOT: root },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * ينسخ ما يقرأه الفحصُ إلى جذرٍ مؤقّت (الثابت 2): وحداتِ النواة والسجلَّ **ونسخةً من الفحص
 * نفسِه** — فبعضُ الحالات تعبث بجدول الاستثناء المكتوبِ داخلَ الفحص، ولا يجوز أن تُكتب تلك
 * الحالةُ في المستودع. ويُوجَّه التشغيلُ إلى نسخةِ الجذرِ عندئذٍ.
 */
function withRoot(
  prepare: (root: string) => void,
  assertOn: (r: { code: number; out: string }) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-closed-enums-gate-'));
  try {
    mkdirSync(join(root, 'src/kernel/config'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'src/kernel/types.ts'), join(root, 'src/kernel/types.ts'));
    cpSync(join(ROOT, 'src/kernel/config'), join(root, 'src/kernel/config'), { recursive: true });
    cpSync(join(ROOT, SCRIPT), join(root, SCRIPT));
    prepare(root);
    const r = spawnSync('bash', [join(root, SCRIPT)], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SOOL_CHECK_ROOT: root },
    });
    assertOn({ code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** يعبث بملفٍّ **في الجذر المنسوخ** لا في المستودع */
function editFile(root: string, rel: string, mutate: (text: string) => string): void {
  const path = join(root, rel);
  writeFileSync(path, mutate(readFileSync(path, 'utf8')), 'utf8');
}

test('T-136: الفحصُ يمرّ على المستودع كما هو (الحالُ الموجَبةُ وحدَها على الأصل)', () => {
  const r = runCheck(ROOT);
  assert.equal(r.code, 0, r.out);
});

test('T-136: الجذرُ المنسوخُ السليمُ يمرّ — فبوابةٌ لا يُعرف لها بابٌ يُفتح جدار', () => {
  withRoot(() => undefined, (r) => assert.equal(r.code, 0, r.out));
});

test('T-136: الحصرُ يُعلن مرشَّحيه بالبنية وبالاسم ويُطابق مجموعَهما', () => {
  const r = runCheck(ROOT);
  assert.equal(r.code, 0, r.out);
  const m = /: (\d+) \([^)]*?(\d+)[^)]*?(\d+)\)/.exec(r.out);
  assert.ok(m, `لم يُعلن الفحصُ عددَ مرشَّحيه:\n${r.out}`);
  const [candidates, byShape] = [Number(m[1]), Number(m[2])];
  assert.ok(byShape > 0, r.out);
  assert.ok(candidates >= byShape, r.out);
  const sums = /(\d+)[^0-9]+= (\d+)[^0-9]+\+ (\d+)/.exec(r.out);
  assert.ok(sums, `لم يُعلن الفحصُ معادلةَ حصره:\n${r.out}`);
  assert.equal(Number(sums[1]), Number(sums[2]) + Number(sums[3]), r.out);
  assert.equal(Number(sums[1]), candidates, r.out);
});

test('T-136: تعدادٌ مغلقٌ بنمطِ اسمٍ مخالفٍ وغيرُ مُسجَّلٍ يُسقط البوابة — علّةُ البند بعينها', () => {
  withRoot(
    (root) => appendFileSync(
      join(root, 'src/kernel/config/research.ts'),
      "\nexport const RESEARCH_TRUST_TIERS: readonly string[] = Object.freeze([\n  'high', 'low',\n]);\n",
      'utf8',
    ),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-06\][^\n]*RESEARCH_TRUST_TIERS/, r.out);
    },
  );
});

test('T-136: استثناءٌ بلا سببٍ مكتوبٍ يُسقط البوابة — واستثناءٌ لا يُقرأ سببُه مهربٌ لا حكم', () => {
  withRoot(
    (root) => editFile(root, SCRIPT, (t) => t.replace(/^ROLE_POWER_FIELDS\|.*$/m, 'ROLE_POWER_FIELDS|')),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-02\][^\n]*ROLE_POWER_FIELDS/, r.out);
    },
  );
});

test('T-136: استثناءٌ لاسمٍ لا وجودَ له في الشفرة يُسقط البوابة (حرسٌ على معدوم — RULE-001)', () => {
  withRoot(
    (root) => editFile(root, SCRIPT, (t) => t.replace(/^ROLE_POWER_FIELDS\|/m, 'ROLE_POWER_FIELDS_GHOST|')),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-03\][^\n]*ROLE_POWER_FIELDS_GHOST/, r.out);
    },
  );
});

test('T-136: اسمٌ مُسجَّلٌ ومستثنًى معًا يُسقط البوابة — حالٌ مزدوجةٌ تُخفي أيُّهما حكَم', () => {
  // يُسجَّل اسمٌ **لا يحمل اصطلاحَ المغلق** وهو مستثنًى أصلًا، ليُبلَغ CE-04 بعينه لا CE-05
  withRoot(
    (root) => editFile(root, REGISTRY, (t) => t.replace(
      "  {\n    name: 'RESEARCH_KNOWN_SOURCE_TYPES',",
      "  {\n    name: 'DECLARATION_REACH',\n    values: DECLARATION_REACH as readonly string[],\n"
      + "    members: 2,\n    uses: [{ file: 'research.yaml', key: 'allowed_source_types' }],\n"
      + "  },\n  {\n    name: 'RESEARCH_KNOWN_SOURCE_TYPES',",
    )),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-04\][^\n]*DECLARATION_REACH/, r.out);
    },
  );
});

test('T-136: استثناءٌ يحمل اصطلاحَ الاسم المغلق يُسقط البوابة — لا يُفلت تعدادٌ من بابِ التجميد', () => {
  withRoot(
    (root) => editFile(root, SCRIPT, (t) => t.replace(/^CHAOS_REQUIRED_FAULTS\|/m, 'CHAOS_KNOWN_FAULTS|')),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-05\][^\n]*CHAOS_KNOWN_FAULTS/, r.out);
    },
  );
});

test('T-136: صفٌّ في السجل بلا تعدادٍ في الشفرة يُسقط البوابة (بابُ T-131 قائمٌ لم يُحذف)', () => {
  withRoot(
    (root) => editFile(root, REGISTRY, (t) => t.replace(
      "name: 'RESEARCH_KNOWN_SOURCE_TYPES'",
      "name: 'RESEARCH_GONE_TYPES'",
    )),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-07\][^\n]*RESEARCH_GONE_TYPES/, r.out);
      assert.match(r.out, /\[CE-08\][^\n]*RESEARCH_GONE_TYPES/, r.out);
    },
  );
});

test('T-136: اسمٌ باصطلاحِ المغلقِ بلا تجميدٍ ولا تسجيلٍ يُسقط البوابة (بابُ الاسم قائم)', () => {
  withRoot(
    (root) => appendFileSync(
      join(root, 'src/kernel/config/research.ts'),
      "\nexport const RESEARCH_KNOWN_TIERS: readonly string[] = ['high', 'low'];\n",
      'utf8',
    ),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-06\][^\n]*RESEARCH_KNOWN_TIERS/, r.out);
    },
  );
});

test('T-136: غيابُ السجلِّ نفسِه يُسقط البوابة — ولا يُفحص ما لا يُقرأ (CE-09)', () => {
  withRoot(
    (root) => rmSync(join(root, REGISTRY)),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-09\]/, r.out);
    },
  );
});

test('T-136: حصرٌ أعمى يسقط برمزه **ومعه سطرُ بيانٍ** لا بانهيارٍ صامت (الثابت 4)', () => {
  withRoot(
    (root) => {
      for (const rel of ['src/kernel/types.ts', 'src/kernel/config/research.ts']) {
        editFile(root, rel, (t) => t.replace(/^export const /gm, 'export  const '));
      }
      const dir = join(root, 'src/kernel/config');
      for (const name of readdirSync(dir)) {
        if (name === 'closed_enums.ts' || !name.endsWith('.ts')) continue;
        editFile(root, join('src/kernel/config', name), (t) => t.replace(/^export const /gm, 'export  const '));
      }
    },
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /\[CE-01\]/, `سقط الرمزُ بلا حكمٍ مكتوب — انهيارٌ لا بوابة:\n${r.out}`);
    },
  );
});

test('T-167: لا عضويّةَ بأنبوبٍ إلى grep -q تحت pipefail — فالسقوطُ لا يكون بالاحتمال (الثابت 8)', () => {
  const body = readFileSync(join(ROOT, SCRIPT), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
  const piped = body.filter((l) => /\|\s*grep\s+-[A-Za-z]*q/.test(l));
  assert.deepEqual(piped, [], `أنبوبٌ إلى grep -q يموت كاتبُه بـSIGPIPE فيُقرأ الموجودُ معدومًا:\n${piped.join('\n')}`);
  assert.match(body.join('\n'), /set -euo pipefail/, 'والحكمُ قائمٌ لأنّ pipefail قائم');
});

test('T-167: عشرون تشغيلًا متزامنًا على المستودع كما هو — كلُّها تمرّ، لا واحدٌ يسقط بالحمل', async () => {
  const { spawn } = await import('node:child_process');
  const runs = Array.from({ length: 20 }, () => new Promise<{ code: number; out: string }>((done) => {
    const p = spawn('bash', [join(ROOT, SCRIPT)], { cwd: ROOT, env: { ...process.env, SOOL_CHECK_ROOT: ROOT } });
    let out = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { out += String(d); });
    p.on('close', (code) => done({ code: code ?? -1, out }));
  }));
  const results = await Promise.all(runs);
  const failed = results.filter((r) => r.code !== 0);
  assert.equal(failed.length, 0, failed.map((r) => r.out).join('\n---\n'));
});
