/**
 * tests/governance/ci_gates_gate.test.ts — بوابةُ الدمجِ مقابلَ سلسلةِ التحقّق (المرحلة 40، البند T-148 · T-146)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_ci_gates.sh` كما تشغّله البوابةُ نفسُها + جذورٌ منسوخةٌ في tmpdir
 * المخرجات: تأكيدُ أنّ الفحصَ يمرّ على المستودع كما هو، ويسقط برمزه على كلِّ بابٍ يُفتح
 * التبعيات: `node:child_process` (يشغّل الملفَّ الصدفيَّ عينَه) · `node:fs` · `node:os` · `node:path`
 * الصلاحيات (RULE-004): يقرأ المستودعَ ولا يكتب فيه حرفًا؛ كلُّ عبثٍ في جذرٍ منسوخ
 * السجلات: خرجُ الفحص يُقرأ ويُرفَق في رسالة التأكيد عند السقوط
 * حالات الفشل المُغطّاة: حاجزٌ في `verify` غائبٌ عن البيان (علّةُ T-148) · أمرٌ في البيان
 *   بلا مقابلٍ ولا سببٍ مكتوب · استثناءٌ بلا سبب · استثناءٌ لمعدومٍ · استثناءٌ لما هو في
 *   `verify` · وسمٌ غيرُ صريح · وسمٌ يُعلن node20 (علّةُ T-146) · مدخلٌ غائب · حصرٌ أعمى
 *   في الأوامر · حصرٌ أعمى في الإجراءات
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/work/orders/W-2026-009.md
 *   · القياسُ الخام: docs/audit/measurements/phase-40-T148.txt
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الفحصَ لا يعيد كتابته**: يشغّل `scripts/check_ci_gates.sh` عينَه الذي تشغّله
 *    سلسلةُ `verify` وبوابةُ الدمج — فلا يمرّ اختبارٌ على منطقِ نسخةٍ ثانيةٍ ثمّ تسقط البوابة.
 *
 * 2) **لا حالةَ تلمس ملفًّا حقيقيًّا (درسُ W-2026-004)**: node يشغّل ملفّاتِ الاختبار بالتوازي،
 *    فكلُّ حالةٍ سلبيّةٍ تعمل في **جذرٍ منسوخٍ** يُوجَّه إليه الفحصُ بـ`SOOL_CHECK_ROOT`، ولم
 *    يبقَ على المستودع الحقيقيّ إلّا **المسارُ الموجَبُ القارئُ وحدَه**.
 *
 * 3) **المقيسُ رمزُ الخروج، والمُطابَقُ رمزُ الحكمِ `[CI-NN]` مع المُعرَّفِ المذكور — لا نصٌّ
 *    عربيٌّ مشكول**: نصُّ البيان يُنقَّح ويُشكَل، فمطابقتُه تكسر الاختبارَ على تحسينِ صياغةٍ
 *    لا على انفتاحِ باب. ورمزُ الخروجِ وحدَه لا يكفي: الفحصُ يجمع أحكامَه ثمّ يخرج بـ1، فطفرةٌ
 *    تُسقط حكمًا آخرَ تُنتج الرمزَ نفسَه — فكلُّ تأكيدٍ يشترط **رمزَ حارسه** بعينه (درسُ T-136).
 *
 * 4) **رمزُ الخروجِ لا يُقرأ معزولًا عن خرجِه**: الانهيارُ يُنتج رمزًا غيرَ الصفر بلا حكم،
 *    فحالتا الحصرِ الأعمى تشترطان **سطرَ البيان** مع الرمز وإلّا كان الاختبارُ يقبل انهيارًا.
 *
 * 5) **حدُّ الفحصِ يُختبَر كحدٍّ لا كحرس**: إجراءٌ غيرُ مذكورٍ في جدولِ زمنِ التشغيل لا يراه
 *    البابُ [CI-07]، وهذا **مُعلَنٌ في عقد W-2026-009 §8**. فالحالةُ الأخيرةُ تؤكّد أنّ الفحصَ
 *    **يُعلن جهلَه بسطرِ `ℹ` ولا يدّعي حراسةً** — لا أنّه يحرس ما لا يستطيع قراءتَه بلا شبكة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = 'scripts/check_ci_gates.sh';
const CI = '.github/workflows/ci.yml';

function runCheck(root: string): { code: number; out: string } {
  const r = spawnSync('bash', [join(root, SCRIPT)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOOL_CHECK_ROOT: root },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** ينسخ ما يقرأه الفحصُ — البيانَ وpackage.json **ونسخةَ الفحصِ نفسِه** — إلى جذرٍ مؤقّت (الثابت 2). */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sool-ci-gates-'));
  mkdirSync(join(root, dirname(CI)), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, CI), join(root, CI));
  cpSync(join(ROOT, 'package.json'), join(root, 'package.json'));
  cpSync(join(ROOT, SCRIPT), join(root, SCRIPT));
  return root;
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}
function write(root: string, rel: string, text: string): void {
  writeFileSync(join(root, rel), text, 'utf8');
}

/** يشغّل حالةً في جذرٍ منسوخٍ ثمّ يمحوه أيًّا كانت النتيجة — فلا يتراكم مؤقّتٌ على العارض. */
function inRoot(mutate: (root: string) => void): { code: number; out: string } {
  const root = makeRoot();
  try {
    mutate(root);
    return runCheck(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('بوابةُ الدمج: المستودعُ كما هو يمرّ — والحواجزُ الثلاثةُ الغائبةُ صارت تُشغَّل', () => {
  const { code, out } = runCheck(ROOT);
  assert.equal(code, 0, `الفحصُ يجب أن يمرّ على المستودع كما هو:\n${out}`);
  assert.match(out, /✓ بوابةُ الدمج/, out);
});

test('بوابةُ الدمج: يطبع حصرَه مقيسًا — فالحكمُ يُقرأ ولا يُصدَّق على وجهه', () => {
  const { out } = runCheck(ROOT);
  assert.match(out, /المقيس: سلسلةُ التحقّق \d+ مُعرَّفًا · بيانُ الدمج \d+ مُعرَّفًا · مستثنًى بسببٍ: \d+/, out);
});

test('[CI-01] حاجزٌ في سلسلةِ التحقّق غائبٌ عن بيانِ الدمج — علّةُ T-148 بعينها', () => {
  const { code, out } = inRoot((root) => {
    const ci = read(root, CI)
      .split('\n')
      .filter((l) => !l.includes('scripts/check_closed_enums.sh'))
      .join('\n');
    write(root, CI, ci);
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-01\][\s\S]*scripts\/check_closed_enums\.sh/, out);
});

test('[CI-01] يسمّي الحاجزَ الغائبَ ولا يكتفي بعددٍ مختلف', () => {
  const { out } = inRoot((root) => {
    const ci = read(root, CI)
      .split('\n')
      .filter((l) => !l.includes('dist/scripts/check_confinement.js'))
      .join('\n');
    write(root, CI, ci);
  });
  assert.match(out, /\[CI-01\][\s\S]*dist\/scripts\/check_confinement\.js/, out);
});

test('[CI-02] أمرٌ يُشغَّل على الدمج ولا يُقاس عليه محلّيًّا ولا سببَ مكتوبًا له', () => {
  const { code, out } = inRoot((root) => {
    write(root, CI, `${read(root, CI)}\n      - name: حاجزٌ طارئ\n        run: bash scripts/check_intruder.sh\n`);
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-02\][\s\S]*scripts\/check_intruder\.sh/, out);
});

test('[CI-03] استثناءٌ بلا سببٍ مكتوب — والاستثناءُ بلا سببٍ مهربٌ لا حكم', () => {
  const { code, out } = inRoot((root) => {
    const s = read(root, SCRIPT).replace(
      /^scripts\/check_documentation\.sh\|.*$/m,
      'scripts/check_documentation.sh|   ',
    );
    write(root, SCRIPT, s);
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-03\][\s\S]*scripts\/check_documentation\.sh/, out);
});

test('[CI-04] استثناءٌ لمُعرَّفٍ لا وجودَ له في بيانِ الدمج — لا يُستثنى ما ليس هناك', () => {
  const { code, out } = inRoot((root) => {
    const s = read(root, SCRIPT).replace(
      /^scripts\/check_documentation\.sh\|/m,
      'scripts/check_ghost.sh|سببٌ مكتوبٌ لبابٍ معدوم\nscripts/check_documentation.sh|',
    );
    write(root, SCRIPT, s);
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-04\][\s\S]*scripts\/check_ghost\.sh/, out);
});

test('[CI-08] استثناءٌ لما هو في سلسلةِ التحقّق أصلًا — سببٌ مكتوبٌ لبابٍ غيرِ مفتوح', () => {
  const { code, out } = inRoot((root) => {
    const s = read(root, SCRIPT).replace(
      /^scripts\/check_documentation\.sh\|/m,
      'scripts/check_module_size.sh|سببٌ لا موضعَ له\nscripts/check_documentation.sh|',
    );
    write(root, SCRIPT, s);
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-08\][\s\S]*scripts\/check_module_size\.sh/, out);
});

test('[CI-06] إجراءٌ بلا وسمٍ صريح — فما يُنفَّذ غيرُ معلومٍ من البيان', () => {
  const { code, out } = inRoot((root) => {
    write(root, CI, read(root, CI).replace('actions/checkout@v5', 'actions/checkout@main'));
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-06\][\s\S]*actions\/checkout@main/, out);
});

test('[CI-07] وسمٌ يُعلن node20 والعارضُ يرفعه إلى node24 — علّةُ T-146 بعينها', () => {
  const { code, out } = inRoot((root) => {
    write(root, CI, read(root, CI).replace('actions/setup-node@v5', 'actions/setup-node@v4'));
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-07\][\s\S]*actions\/setup-node@v4/, out);
});

test('[CI-09] مدخلٌ غائب — فحصٌ بلا مدخلٍ لا يحكم ولا يقول «لا انحراف»', () => {
  const { code, out } = inRoot((root) => {
    rmSync(join(root, CI));
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-09\][\s\S]*ci\.yml/, out);
  // ويتوقّف عند بابِه: مدخلٌ غائبٌ لا يُتبَع بحكمِ «حصرٍ أعمى» — فحكمانِ على علّةٍ واحدةٍ
  // يُرسلان القارئَ إلى البابِ الخطأ. **وهذا التأكيدُ أُضيف لأنّ طفرةً نجت بدونه**: أُبطل
  // `exit` وحدَه فبقي الرمزُ يُطبع وبقي الخروجُ غيرَ صفرٍ، فلم يره الاختبارُ (قياسُ التطفير، الجولة 1).
  assert.doesNotMatch(out, /\[CI-05\]/, `مدخلٌ غائبٌ يجب أن يوقف الفحصَ عند [CI-09] بلا حكمٍ ثانٍ مُضِلّ:\n${out}`);
});

test('[CI-05] حصرٌ أعمى في الأوامر: package.json بلا سلسلةِ تحقّقٍ مقروءة — والرمزُ لا يُقرأ بلا بيانه', () => {
  const { code, out } = inRoot((root) => {
    write(root, 'package.json', '{\n  "name": "sool",\n  "scripts": {}\n}\n');
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-05\][\s\S]*حصرٌ أعمى/, out);
});

test('[CI-05] حصرٌ أعمى في الإجراءات: بيانٌ بلا `uses:` واحد', () => {
  const { code, out } = inRoot((root) => {
    const ci = read(root, CI)
      .split('\n')
      .filter((l) => !l.includes('uses:'))
      .join('\n');
    write(root, CI, ci);
  });
  assert.equal(code, 1, out);
  assert.match(out, /\[CI-05\][\s\S]*uses:/, out);
});

test('حدُّ الفحصِ يُعلَن ولا يُدَّعى: إجراءٌ خارجَ جدولِ زمنِ التشغيل يُذكَر بـ`ℹ` ولا يُحرَس', () => {
  const { code, out } = inRoot((root) => {
    write(root, CI, read(root, CI).replace('      - uses: actions/checkout@v5', '      - uses: third/party@v1\n      - uses: actions/checkout@v5'));
  });
  assert.equal(code, 0, `الحدُّ يُعلَن ولا يُسقِط — وإلّا كان الفحصُ يدّعي قراءةَ ما لا يقرأ:\n${out}`);
  assert.match(out, /ℹ[\s\S]*third\/party@v1/, out);
});
