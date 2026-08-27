/**
 * tests/governance/config_readers_gate.test.ts — بوابةُ قُرّاءِ الإعلان (المرحلة 40، البند T-137)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_config_readers.sh` كما تشغّله البوابةُ نفسُها + جذورٌ منسوخةٌ في tmpdir
 * المخرجات: تأكيدُ أنّ الفحصَ يمرّ على المستودع كما هو، ويسقط برمزه على كلِّ فارقٍ باسمه
 * التبعيات: `node:child_process` (يشغّل الملفَّ الصدفيَّ عينَه) · `node:fs` · `node:os`
 * الصلاحيات (RULE-004): يقرأ المستودعَ ولا يكتب فيه حرفًا؛ كلُّ عبثٍ في جذرٍ منسوخ
 * السجلات: خرجُ الفحص يُقرأ ولا يُخزَّن
 * حالات الفشل المُغطّاة: ملفٌّ بلا صفّ · صفٌّ بلا ملفّ · دالّةٌ لا تُصدَّر · وحدةٌ غائبة
 *   · موضعُ نداءٍ مجهول · سجلٌّ غائب · سجلٌّ بصيغةٍ لا تُقرأ (فحصٌ أعمى)
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/decisions/ADR-0042-declaration-readers.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الفحصَ لا يعيد كتابته**: يشغّل `scripts/check_config_readers.sh` عينَه الذي
 *    تشغّله البوابةُ وCI — فلا يمرّ اختبارٌ على منطقِ نسخةٍ ثانيةٍ ثمّ تسقط البوابةُ على الأصل.
 *
 * 2) **لا حالةَ تلمس ملفًّا حقيقيًّا (درسُ W-2026-004)**: node يشغّل ملفّاتِ الاختبار
 *    بالتوازي، فمن حرّف ملفًّا في المستودع أسقط بوابةَ غيره بالاحتمال. فكلُّ حالةٍ سلبيّةٍ
 *    تعمل في **جذرٍ منسوخٍ** يُوجَّه إليه الفحصُ بـ`SOOL_CHECK_ROOT`، ولم يبقَ على المستودع
 *    الحقيقيّ إلّا **المسارُ الموجَبُ القارئُ وحدَه**.
 *
 * 3) **المقيسُ رمزُ الخروجِ أوّلًا ثمّ نصُّ البيان**: فحصٌ يطبع ولا يُسقط الرمزَ يمرّ في CI —
 *    وتلك علّةٌ مقيسةٌ في هذا المستودع من قبل.
 *
 * 4) **الفحصُ يسقط إن عَمِي**: تُختبر حالةُ صيغةٍ لا تُقرأ — فلو مرَّ الفحصُ حينها لكان زينةً
 *    تُطمئن ولا تحرس، وذلك أخطرُ من غيابه.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = 'scripts/check_config_readers.sh';
const REGISTRY = 'src/kernel/config/declaration_readers.ts';

function runCheck(root: string): { code: number; out: string } {
  const r = spawnSync('bash', [join(ROOT, SCRIPT)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOOL_CHECK_ROOT: root },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * ينسخ ما يحتاجه الفحصُ إلى جذرٍ مؤقّت (الثابت 2): مجلدَ الإعلان ووحداتِ النواة والسجلّ.
 * ولا يُنسخ المستودعُ كلُّه — فالنسخُ الزائدُ يُبطئ البوابةَ ولا يزيد يقينًا.
 */
function withRoot(prepare: (root: string) => void, assertOn: (r: { code: number; out: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-readers-gate-'));
  try {
    mkdirSync(join(root, 'src/kernel/config'), { recursive: true });
    cpSync(join(ROOT, 'config'), join(root, 'config'), { recursive: true });
    cpSync(join(ROOT, 'src/kernel/config'), join(root, 'src/kernel/config'), { recursive: true });
    prepare(root);
    assertOn(runCheck(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** يعبث بالسجلِّ **في الجذر المنسوخ** لا في المستودع */
function editRegistry(root: string, mutate: (text: string) => string): void {
  const path = join(root, REGISTRY);
  writeFileSync(path, mutate(readFileSync(path, 'utf8')), 'utf8');
}

test('T-137: الفحصُ يمرّ على المستودع كما هو ويُعلن العددَين', () => {
  const r = runCheck(ROOT);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /يتقابلان حرفًا/);
  assert.match(r.out, /لا إعلانَ بلا قارئ/);
});

test('T-137: الجذرُ المنسوخُ السليمُ يمرّ — فبوابةٌ لا يُعرف لها بابٌ يُفتح جدار', () => {
  withRoot(() => undefined, (r) => assert.equal(r.code, 0, r.out));
});

test('T-137: ملفُّ إعلانٍ يُزاد بلا صفٍّ في السجلِّ يُسقط البوابة', () => {
  withRoot(
    (root) => writeFileSync(join(root, 'config/invented.yaml'), 'k: 1\n', 'utf8'),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /ملفُّ إعلانٍ بلا قارئٍ مسجَّل/);
      assert.match(r.out, /invented\.yaml/);
    },
  );
});

test('T-137: صفٌّ يشير إلى ملفٍّ محذوفٍ يُسقط البوابة — والاتّجاهُ هذا لا يراه الإقلاع', () => {
  withRoot(
    (root) => rmSync(join(root, 'config/policies.yaml')),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /قارئٌ مسجَّلٌ لملفٍّ غائب/);
      assert.match(r.out, /policies\.yaml/);
    },
  );
});

test('T-137: صفٌّ يسمّي دالّةً لا تُصدَّر يُسقط البوابة — القارئُ يُتحقَّق لا يُصدَّق', () => {
  withRoot(
    (root) => editRegistry(root, (t) => t.replace("reader: 'loadRoles'", "reader: 'loadRolesThatNeverWas'")),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /دالّةً لا تُصدَّر من وحدتها/);
    },
  );
});

test('T-137: صفٌّ يسمّي وحدةً غيرَ موجودةٍ يُسقط البوابة', () => {
  withRoot(
    (root) => editRegistry(root, (t) => t.replace(
      "module: 'src/kernel/config/roles.ts'",
      "module: 'src/kernel/config/لا-وجود-لها.ts'",
    )),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /وحدةً غيرَ موجودة/);
    },
  );
});

test('T-137: موضعُ نداءٍ مجهولٌ يُسقط البوابة — لا موضعَ ثالث', () => {
  withRoot(
    (root) => editRegistry(root, (t) => t.replace("site: 'read_at_guard' }", "site: 'someday' }")),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /موضعُ نداءٍ مجهول/);
    },
  );
});

test('T-137: غيابُ السجلِّ يُسقط البوابة — ولا يُفحص ما لا يُقرأ', () => {
  withRoot(
    (root) => rmSync(join(root, REGISTRY)),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /غير موجود/);
    },
  );
});

test('T-137: صيغةٌ لا تُقرأ تُسقط البوابةَ ولا تُمرّرها صامتةً (الثابت 4)', () => {
  withRoot(
    (root) => editRegistry(root, (t) => t.replace(/\{ file: '/g, '{ FILE: \'')),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /أعمى/);
    },
  );
});
