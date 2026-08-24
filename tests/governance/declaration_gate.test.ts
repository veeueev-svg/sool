/**
 * tests/governance/declaration_gate.test.ts — حاجزُ الإعلان (المرحلة 40، البند T-127)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_declaration.sh` و`version.json` و`COMPLETION_CRITERIA.md` و`ROADMAP.md` و`docs/royal-orders/`
 * المخرجات: تأكيدٌ أن الحاجز يمرّ على المستودع كما هو، ويسقط على كل دعوى إعلانٍ بلا سند
 * التبعيات: `node:child_process` (يشغّل الفحص كما تشغّله البوابة) · `node:fs`
 * الصلاحيات (RULE-004): الاختبار يقرأ ويعبث مؤقّتًا ويستعيد؛ لا يُرقّي نسبةً ولا يوقّع أمرًا
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: نسبة 100% مع فجوات · royal_approval غير pending · المرحلة 40 في
 *   phases_complete · حصيلةُ المعايير متأخّرة · عددُ ROADMAP متأخّر · أمرٌ ملكيٌّ بلا auditId ·
 *   أمرٌ موقَّعٌ مع بقاء فجوات (فلا يكفي وجودُ الأمر)
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40.md · COMPLETION_CRITERIA.md §«قاعدة الإعلان»
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الفحص لا يعيد كتابته**: يشغّل الملفَّ الصدفيَّ عينَه الذي تشغّله البوابة، فلا يمرّ
 *    اختبارٌ على منطقِ نسخةٍ ثانية ثم تسقط البوابة على الأصل (كأخيه criteria_status.test.ts).
 *
 * 2) **العبثُ مؤقّت ومُستعاد دائمًا**: كل حالةٍ سلبية تكتب نسخةً معطوبة ثم تُرجع الأصل في
 *    `finally` — ولو سقط التأكيد. وما أُنشئ من ملفٍّ يُحذف.
 *
 * 3) **المقيسُ رمزُ الخروج لا نصُّ الرسالة**: لو كان الحاجز يطبع ولا يُسقط الرمز لَمَرَّت دعوى
 *    الإعلان في البوابة — وتلك بالضبط علّةُ أخيه التي أوجبت هذا الملف.
 *
 * 4) **المسارُ الموجَب لا يُصطنَع، ويُعلن أنه غير مُختبر**: لا يُختبر «دعوى اكتمالٍ مستوفاة»
 *    لأنّ اصطناعَها يقتضي تزييفَ تسعةِ أحكامِ تدقيقٍ وإفراغَ §2 — وهو عينُ ما وُجد الحاجزُ
 *    ليمنعه. فالمُختبر هو **الرفض** في كل بابٍ من أبوابه، وذاك ما يحرس البوابة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// جذرُ المستودع هو مكانُ تشغيل `npm test` (كما في tests/governance/criteria_status.test.ts)
const ROOT = process.cwd();
const SCRIPT = 'scripts/check_declaration.sh';
const VERSION = join(ROOT, 'version.json');
const CRITERIA = join(ROOT, 'COMPLETION_CRITERIA.md');
const ROADMAP = join(ROOT, 'ROADMAP.md');
const ORDER = join(ROOT, 'docs/royal-orders/2026-01-01-000-اختبار-حاجز.md');

function runCheck(): { code: number; out: string } {
  const r = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** يعبث بملفٍّ مؤقّتًا ويُرجع الأصل دائمًا */
function withTampered(
  file: string,
  mutate: (text: string) => string,
  assertOn: (r: { code: number; out: string }) => void,
): void {
  const original = readFileSync(file, 'utf8');
  try {
    const next = mutate(original);
    assert.notEqual(next, original, `العبثُ لم يغيّر شيئًا في ${file} — فالتأكيدُ لا يقيس شيئًا`);
    writeFileSync(file, next);
    assertOn(runCheck());
  } finally {
    writeFileSync(file, original);
  }
}

test('T-127: الحاجز يمرّ على المستودع كما هو، ويعلن الدعوى والحال معًا', () => {
  const r = runCheck();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /الدعوى: النسبة/);
  assert.match(r.out, /الحال:/);
  assert.match(r.out, /الإعلانُ أثرٌ لا احتفال/);
});

test('T-127: نسبةُ 100% وثمّ صفٌّ ليس ✅ تُسقط البوابة', () => {
  withTampered(VERSION, (t) => t.replace(/"completion_percent": *[0-9.]+/, '"completion_percent": 100'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /فجوة واحدة مفتوحة = لا إعلان/);
    // ولا بندَ مفتوحًا يُبتلع: المزلقُ الآخر يُعلن في النفس الواحد
    assert.match(r.out, /بندًا مفتوحًا/);
  });
});

test('T-127: اعتمادٌ ملكيٌّ مدَّعًى في version.json بلا أمرٍ مقيَّد يُسقط البوابة', () => {
  withTampered(VERSION, (t) => t.replace(/"royal_approval": *"[^"]*"/, '"royal_approval": "granted"'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /بلا أمرٍ ملكيٍّ موقَّعٍ مقيَّد/);
  });
});

test('T-127: إدخالُ المرحلة 40 في phases_complete يُسقط البوابة', () => {
  withTampered(VERSION, (t) => t.replace('    38\n  ],', '    38,\n    40\n  ],'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /دعوى اكتمال/);
  });
});

test('T-127: أمرٌ ملكيٌّ موقَّعٌ لا يكفي وحدَه ما بقيت فجوة', () => {
  writeFileSync(
    ORDER,
    ['الرقم: 000', 'التاريخ: 2026-01-01', 'المُصدِر: الملك', 'الموضوع: اختبارُ الحاجز',
      'النص: لا أثرَ لهذا الملفِّ خارج الاختبار', 'الأثر على المراحل: لا شيء',
      'معرّف السجل في سلسلة التدقيق (auditId): audit-اختبار-000', ''].join('\n'),
  );
  try {
    withTampered(VERSION, (t) => t.replace(/"completion_percent": *[0-9.]+/, '"completion_percent": 100'), (r) => {
      assert.equal(r.code, 1, r.out);
      // الأمرُ موجودٌ ومقيَّد، ومع ذلك يسقط: لأنّ الفجواتَ والبنودَ باقية
      assert.doesNotMatch(r.out, /بلا أمرٍ ملكيٍّ موقَّعٍ مقيَّد/);
      assert.match(r.out, /فجوة واحدة مفتوحة = لا إعلان/);
    });
  } finally {
    unlinkSync(ORDER);
  }
});

test('T-127: أمرٌ ملكيٌّ بلا auditId لا يُعتدُّ به — الفارغُ ليس استيفاءً', () => {
  writeFileSync(
    ORDER,
    ['الرقم: 000', 'التاريخ: 2026-01-01', 'المُصدِر: الملك', 'الموضوع: أمرٌ بلا قيد',
      'النص: لم يُقيَّد في السلسلة', 'الأثر على المراحل: لا شيء',
      'معرّف السجل في سلسلة التدقيق (auditId):', ''].join('\n'),
  );
  try {
    const r = runCheck();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /أمرٌ ملكيٌّ بلا auditId/);
  } finally {
    unlinkSync(ORDER);
  }
});

test('T-127: حصيلةُ COMPLETION_CRITERIA.md المتأخّرةُ عن صفوفه تُسقط البوابة', () => {
  withTampered(CRITERIA, (t) => t.replace(/فجوة \*\*[0-9]+\*\*/, 'فجوة **0**'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /حصيلةُ COMPLETION_CRITERIA\.md تقول/);
  });
});

test('T-127: عددُ البنود المفتوحة في ROADMAP.md يُطابَق بجدول §2 لا بانتباه كاتب', () => {
  withTampered(ROADMAP, (t) => t.replace('| بنود مفتوحة معلنة | **', '| بنود مفتوحة معلنة | **1'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /والرقمُ المنقولُ يدويًّا يتأخّر/);
  });
});
