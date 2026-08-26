/**
 * tests/governance/criteria_status.test.ts — فحصُ تطابق حالات المعايير (المرحلة 39، البند T-116)
 * المالك: ديوان التاج للتدقيق
 * المدخلات: `scripts/check_criteria_status.sh` و`COMPLETION_CRITERIA.md` و`docs/audit/criteria/`
 * المخرجات: تأكيدٌ أن الفحص يمرّ على المستودع كما هو، ويسقط على كل تعارضٍ مُصطنع
 * التبعيات: `node:child_process` (يشغّل الفحص كما تشغّله البوابة) · `node:fs`
 * الصلاحيات (RULE-004): الاختبار يقرأ ويستعيد؛ لا يُرقّي حالةً ولا يعدّل حكمًا
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: حالةٌ تخالف الحكم · حالةٌ ⬜ · صفٌّ محذوف · اسمُ بندٍ محذوف من فجوة
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md · COMPLETION_CRITERIA.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الفحص لا يعيد كتابته**: يشغّل الملف الصدفي عينَه الذي تشغّله بوابة التكامل، فلا
 *    يمرّ اختبارٌ على منطقٍ نسخةٍ ثانية ثم تسقط البوابة على الأصل.
 *
 * 2) **العبثُ في جذرٍ منسوخٍ لا في المستودع (W-2026-004)**: كانت الحالاتُ السلبيّةُ تكتب
 *    نسخةً معطوبةً من `COMPLETION_CRITERIA.md` **الحقيقيّ** ثم تُرجع الأصل في `finally`؛
 *    وnode يشغّل ملفّاتِ الاختبار بالتوازي — فيقرأ اختبارٌ ما حرّفه الآخر فتسقط بوابةُ CI
 *    بالاحتمال. فالتحريفُ اليوم يقع في **نسخةٍ في tmpdir** تُمرَّر بـ`SOOL_CHECK_ROOT`،
 *    ولا يُكتب حرفٌ في ملفٍّ محكوم.
 *
 * 3) **الحجّة أن الفحص يرفض**: لو كان الفحص يطبع ولا يُسقط الرمز لمرّ التعارض في البوابة،
 *    فالمقيس هو رمزُ الخروج 1 لا نصُّ الرسالة وحده.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';


// جذرُ المستودع هو مكانُ تشغيل `npm test` (كما في tests/chaos/chaos_config.test.ts)
const ROOT = process.cwd();
const CRITERIA = 'COMPLETION_CRITERIA.md';
const CRITERIA_DIR = 'docs/audit/criteria';
const SCRIPT = 'scripts/check_criteria_status.sh';

function runCheck(root?: string): { code: number; out: string } {
  const r = spawnSync('bash', [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: root === undefined ? process.env : { ...process.env, SOOL_CHECK_ROOT: root },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/**
 * ينسخ ما يقرأه الفاحص (جدولُ المعايير وأحكامُ التدقيق) إلى جذرٍ في tmpdir، ثم يعبث
 * بالنسخة ويشغّل الفاحصَ عليها بـ`SOOL_CHECK_ROOT` — فلا يُلمس ملفٌّ حقيقيٌّ ألبتةً
 * (W-2026-004؛ وهو نفسُ نمط `withRoot` في declaration_gate.test.ts).
 */
function withRoot(mutate: (root: string) => void, assertOn: (r: { code: number; out: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-crit-'));
  try {
    mkdirSync(join(root, CRITERIA_DIR), { recursive: true });
    cpSync(join(ROOT, CRITERIA), join(root, CRITERIA));
    cpSync(join(ROOT, CRITERIA_DIR), join(root, CRITERIA_DIR), { recursive: true });
    mutate(root);
    assertOn(runCheck(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** يعبث بجدول المعايير في **الجذر المنسوخ**، ويشترط أن يكون العبثُ قد غيّر شيئًا */
function withTamperedFile(mutate: (text: string) => string, assertOn: (r: { code: number; out: string }) => void): void {
  withRoot((root) => {
    const p = join(root, CRITERIA);
    const before = readFileSync(p, 'utf8');
    const after = mutate(before);
    assert.notEqual(after, before, 'العبثُ لم يغيّر شيئًا في جدول المعايير — فالتأكيدُ لا يقيس شيئًا');
    writeFileSync(p, after);
  }, assertOn);
}

test('T-116: الفحص يمرّ على المستودع كما هو، ويعلن الحصيلة', () => {
  const r = runCheck();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /كل حالةٍ مطابقةٌ لحكم تدقيقها/);
  // ما لم يُستوفَ يُعلن لا يُطمَس
  assert.match(r.out, /لا إعلان/);
});

test('T-116: ترقيةُ حالةٍ بلا حكمٍ يسندها تُسقط البوابة', () => {
  // C-18 حكمُه «فجوة» (T-115) — فترقيتُه في الجدول وحده هو الغشّ الذي يمنعه الفحص
  withTamperedFile(
    (t) => t.replace(
      '| C-18 | تدقيق مستقل خارج سلطة المنفّذين بلا فجوة | [`C-18.md`](docs/audit/criteria/C-18.md) | ⚠️ فجوة | T-115 |',
      '| C-18 | تدقيق مستقل خارج سلطة المنفّذين بلا فجوة | [`C-18.md`](docs/audit/criteria/C-18.md) | ✅ مستوفى | — |',
    ),
    (r) => {
      assert.equal(r.code, 1, 'كان يجب أن يسقط الفحص');
      assert.match(r.out, /C-18/);
      assert.match(r.out, /الجدول يقول «مستوفى» وحكمُ التدقيق يقول «فجوة»/);
    },
  );
});

test('T-116: حالةٌ ⬜ أو «جاري» مرفوضة — وهي عينُ ما كان البند T-108', () => {
  withTamperedFile(
    (t) => t.replace(
      '| [`C-14.md`](docs/audit/criteria/C-14.md) | ✅ مستوفى | — |',
      '| [`C-14.md`](docs/audit/criteria/C-14.md) | ⬜ | — |',
    ),
    (r) => {
      assert.equal(r.code, 1);
      assert.match(r.out, /حالةٌ غير معلنة/);
    },
  );
  withTamperedFile(
    (t) => t.replace(
      '| [`C-19.md`](docs/audit/criteria/C-19.md) | ✅ مستوفى | — |',
      '| [`C-19.md`](docs/audit/criteria/C-19.md) | 🟡 جاري | — |',
    ),
    (r) => {
      assert.equal(r.code, 1);
      assert.match(r.out, /حالةٌ غير معلنة/);
    },
  );
});

test('T-116: معيارٌ له حكمٌ ولا صفَّ له في الجدول يُكشف', () => {
  withTamperedFile(
    (t) => t.split('\n').filter((l) => !l.startsWith('| C-11 |')).join('\n'),
    (r) => {
      assert.equal(r.code, 1);
      assert.match(r.out, /C-11: له حكمٌ .* ولا صفَّ له/s);
    },
  );
});

test('T-116: فجوةٌ يُحذف اسمُ بندها تُكشف — الفجوة بلا اسمٍ لا تُطالَب', () => {
  withTamperedFile(
    (t) => t.replace(
      '| [`C-17.md`](docs/audit/criteria/C-17.md) | ⚠️ فجوة | T-85 |',
      '| [`C-17.md`](docs/audit/criteria/C-17.md) | ⚠️ فجوة | — |',
    ),
    (r) => {
      assert.equal(r.code, 1);
      assert.match(r.out, /فجوةٌ بلا اسم بند/);
    },
  );
});
