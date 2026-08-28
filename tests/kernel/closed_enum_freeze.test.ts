/**
 * tests/kernel/closed_enum_freeze.test.ts — تجميدُ التعداداتِ المستثناةِ في التشغيل
 *   (المرحلة 40 · البند T-147 · بندُ العمل `W-2026-013`)
 * المالك: القيّم على المستودع
 * المدخلات: جدولُ الاستثناء في `scripts/check_closed_enums.sh` (يُقرأ ولا يُعدَّل — الملفُّ
 *   محجوزٌ لـ`W-2026-006`) · والقيمُ نفسُها من `src/kernel/config`
 * المخرجات: تأكيداتٌ تسقط إن كان مستثنًى غيرَ مجمَّدٍ أو غيرَ مصدَّرٍ أو عناصرُه ليست نصوصًا
 * التبعيات: `node:fs` · `node:test` — لا شفرةَ بوابةٍ تُشغَّل من هنا
 * الصلاحيات (RULE-004): يقرأ ولا يكتب شيئًا؛ ولا يلمس ملفًّا في المستودع
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: `[FZ-01]` جدولٌ لا يُقرأ أو حصرٌ أعمى · `[FZ-02]` مستثنًى غيرُ
 *   مصدَّرٍ من وحدةِ التهيئة · `[FZ-03]` مستثنًى غيرُ مجمَّدٍ في التشغيل · `[FZ-04]` تعديلٌ
 *   لا يرفع · `[FZ-05]` الاسمُ الثاني للمصفوفةِ نفسِها غيرُ محروس · `[FZ-06]` عنصرٌ غيرُ
 *   نصٍّ فالتجميدُ السطحيُّ لا يكفيه
 * اختبار القبول: هذا الملفُّ نفسُه
 * الوثيقة المرتبطة: docs/test-reports/phase-40-T147.md
 *   · القياسُ الخام: docs/audit/measurements/phase-40-T147.txt
 *   · العقد: docs/work/orders/W-2026-013.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **القائمةُ تُشتقُّ ولا تُنسخ**: أسماءُ المستثنَين تُقرأ من جدولِ `EXCEPTIONS` في
 *    `scripts/check_closed_enums.sh` نفسِه. فمن أضاف استثناءً غدًا **سقط عليه هذا الاختبارُ
 *    بلا تعديلٍ فيه** — ولو نُسخت القائمةُ هنا لكان الاختبارُ يحرس نسختَه لا الشفرة.
 *
 * 2) **حكمُ البوابةِ لم يُضف لأنّ ملفَّها محجوزٌ لغيره** (`W-2026-006` · `REVIEW`): الأتمُّ
 *    أن يوجب `check_closed_enums.sh` تجميدَ المستثنى كما يوجبه للمُسجَّل، **وذلك حدٌّ مُعلَنٌ
 *    في §3 من العقد لا مسكوتٌ عنه**. وهذا الملفُّ يُغلق البابَ اختبارًا لا بوابة: يسقط على
 *    المخالفةِ نفسِها، وثمنُه المُعلَن أنّه يسقط في `npm test` لا في أوّلِ أمرٍ قبل البناء.
 *
 * 3) **`readonly` لا وجودَ له في التشغيل**: هو حكمُ مترجمٍ يُمحى عند البناء. ولذلك تُقاس
 *    الحالُ بـ`Object.isFrozen` **وبتعديلٍ يُجرَّب فعلًا فيرفع** — لا بقراءةِ نصِّ المصدر.
 *    والمقيسُ قبل هذا البند: **عشرٌ من اثنتَي عشرةَ نجح `push` عليها** فازداد العددُ.
 *
 * 4) **التجميدُ سطحيٌّ فيُحرَس شكلُ العناصر**: `Object.freeze` لا يمنع تعديلَ كائنٍ داخلَ
 *    المصفوفة. وعناصرُ هذه التعداداتِ نصوصٌ حرفيّةٌ اليومَ — فيُثبَّت ذلك بحكمٍ يسقط عند أوّلِ
 *    عنصرٍ غيرِ نصٍّ، فلا يُظنَّ التجميدُ عميقًا وهو سطحيّ.
 *
 * 5) **الحصرُ الأعمى يسقط**: صفرُ اسمٍ مُشتقٍّ من جدولٍ موجودٍ يعني أنّ صيغةَ الجدولِ تغيّرت
 *    وأنّ الاشتقاقَ لم يقرأ شيئًا — فيسقط التأكيدُ ولا يمرّ «صفرُ مخالفةٍ» على صفرِ قياس.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as CONFIG from '../../src/kernel/config';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/check_closed_enums.sh');

/** أسماءُ المستثنَين مُشتقّةً من جدولِ الاستثناء في البوابة — لا نسخةٌ مكتوبةٌ هنا */
function exceptionNames(): readonly string[] {
  const text = readFileSync(GATE, 'utf8');
  const start = text.indexOf("EXCEPTIONS=");
  assert.ok(start >= 0, '[FZ-01] لا جدولَ استثناءٍ في البوابة — الاشتقاقُ عَمِي');
  const open = text.indexOf("<<'TABLE'", start);
  const close = text.indexOf('\nTABLE', open);
  assert.ok(open > 0 && close > open, '[FZ-01] صيغةُ جدولِ الاستثناء تغيّرت فلم يُقرأ');
  return text
    .slice(open + "<<'TABLE'".length, close)
    .split('\n')
    .map((line) => (line.split('|')[0] ?? '').trim())
    .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name));
}

/** القيمةُ بالاسم من وحدةِ التهيئة — و`undefined` تعني أنّها غيرُ مصدَّرة */
function valueOf(name: string): unknown {
  return (CONFIG as unknown as Record<string, unknown>)[name];
}

/** يُجرَّب تعديلٌ فعليٌّ ويُرجَع اسمُ ما رُفع، أو `null` إن لم يُرفع شيء */
function mutationError(value: unknown): string | null {
  try {
    if (Array.isArray(value)) (value as unknown[]).push('__probe__');
    else (value as Record<string, unknown>).__probe__ = 1;
    return null;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

const NAMES = exceptionNames();

test('[FZ-01] جدولُ الاستثناء يُقرأ من البوابة ولا يُنسخ — وصفرُ اسمٍ حصرٌ أعمى فيسقط', () => {
  assert.ok(NAMES.length > 0, '[FZ-01] صفرُ اسمٍ مُشتقٍّ من جدولٍ موجود — الاشتقاقُ عَمِي');
  assert.equal(new Set(NAMES).size, NAMES.length, '[FZ-01] اسمٌ مكرَّرٌ في جدولِ الاستثناء');
  // العددُ يُثبَّت لأنّه **مقيسٌ منشورٌ** في §2 من القياس الخامّ: 25 مرشَّحًا = 13 + 12.
  // فمن أضاف استثناءً أو حذفه سقط هنا فقرأ الرقمَ وقاسه، ولم يمرَّ في صمت.
  assert.equal(NAMES.length, 12, `[FZ-01] عددُ المستثنَين ${NAMES.length} والمقيسُ المنشورُ 12`);
});

test('[FZ-02] كلُّ مستثنًى مصدَّرٌ من وحدةِ التهيئة — واستثناءٌ لمعدومٍ حرسٌ على لا شيء', () => {
  const missing = NAMES.filter((name) => valueOf(name) === undefined);
  assert.deepEqual(missing, [], `[FZ-02] مستثنًى غيرُ مصدَّرٍ من src/kernel/config: ${missing.join(' · ')}`);
});

test('[FZ-03] كلُّ مستثنًى مجمَّدٌ في التشغيل — و`readonly` حكمُ مترجمٍ يُمحى عند البناء', () => {
  const open = NAMES.filter((name) => !Object.isFrozen(valueOf(name)));
  assert.deepEqual(open, [], `[FZ-03] مستثنًى غيرُ مجمَّدٍ في التشغيل: ${open.join(' · ')}`);
});

test('[FZ-04] التعديلُ يُجرَّب فعلًا فيرفع — لا يُكتفى بـ`isFrozen`', () => {
  const silent = NAMES.filter((name) => mutationError(valueOf(name)) !== 'TypeError');
  assert.deepEqual(silent, [], `[FZ-04] تعديلٌ لم يرفع TypeError على: ${silent.join(' · ')}`);
});

test('[FZ-04] وأعدادُ المصفوفاتِ لا تتغيّر بمحاولةِ التعديل — الرفضُ لا الصمت', () => {
  for (const name of NAMES) {
    const value = valueOf(name);
    if (!Array.isArray(value)) continue;
    const before = value.length;
    mutationError(value);
    assert.equal(value.length, before, `[FZ-04] ${name}: العددُ تغيّر ${before} ⇒ ${value.length}`);
  }
});

test('[FZ-05] `PRODUCTION_OPERATORS` اسمٌ ثانٍ للمصفوفةِ نفسِها فيُحرَس معها', () => {
  // production_policy.ts: `PRODUCTION_OPERATORS = STAGING_OPERATORS` — مرجعٌ واحدٌ لا نسخة.
  // فلو حُرس الاسمُ الأوّلُ وحدَه لبقي البابُ مفتوحًا بالاسم الثاني، ولذلك يُقاس هو أيضًا.
  assert.equal(CONFIG.PRODUCTION_OPERATORS, CONFIG.STAGING_OPERATORS, '[FZ-05] لم يبقَ اسمًا ثانيًا للمصفوفةِ نفسِها — فليُقس حالُه وحدَه');
  assert.ok(Object.isFrozen(CONFIG.PRODUCTION_OPERATORS), '[FZ-05] الاسمُ الثاني غيرُ مجمَّد');
  assert.equal(mutationError(CONFIG.PRODUCTION_OPERATORS), 'TypeError', '[FZ-05] تعديلٌ بالاسمِ الثاني لم يرفع');
});

test('[FZ-06] عناصرُ المستثنَين نصوصٌ — فالتجميدُ السطحيُّ يكفيها ولا يُظنُّ عميقًا', () => {
  for (const name of NAMES) {
    const value = valueOf(name);
    if (!Array.isArray(value)) continue;
    const alien = value.filter((element) => typeof element !== 'string');
    assert.deepEqual(alien, [], `[FZ-06] ${name}: عنصرٌ غيرُ نصٍّ — التجميدُ سطحيٌّ فلا يحرسه`);
  }
});

test('[FZ-06] وما ليس مصفوفةً فقيمُه مجمَّدةٌ هي أيضًا — فلا يُفتح البابُ من ورائه', () => {
  for (const name of NAMES) {
    const value = valueOf(name);
    if (Array.isArray(value) || typeof value !== 'object' || value === null) continue;
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (typeof inner !== 'object' || inner === null) continue;
      assert.ok(Object.isFrozen(inner), `[FZ-06] ${name}.${key}: قيمةٌ داخليّةٌ غيرُ مجمَّدة`);
    }
  }
});
