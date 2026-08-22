/**
 * tests/audit/independence.test.ts — اختبارات قبول شهادة استقلال التدقيق (المرحلة 39، T-115)
 * المالك: ديوان المظالم
 * المدخلات: `IndependenceRegistry` + سجلٌّ غير قابل للمحو
 * المخرجات: تأكيدُ أن الاعتماد يُرفض من كاتب الحكم ومن جهةٍ غير معلنة، وأن كل رفضٍ مُقيَّد
 * التبعيات: `src/audit/independence` · `src/audit/append_only_log`
 * الصلاحيات (RULE-004): اختبارٌ يقرأ ويستدعي؛ لا يرقّي معيارًا
 * السجلات: يقرأ `snapshot()` ليتحقق أن الرفض قُيِّد لا اكتُفي بإرجاعه
 * حالات الفشل المُغطّاة: الكاتب يعتمد نفسه · جهة غير معلنة · نصّ مُغيَّر بعد الاعتماد ·
 *   ردّ بلا سبب · شهادة مكرّرة · سلامة السلسلة بعد كل ذلك
 * اختبار القبول: هذا الملف — `npm test`
 * الوثيقة المرتبطة: docs/audit/independence/README.md · docs/test-reports/phase-39.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **الرفضُ يُقاس بالسجل لا بالقيمة المرجَعة وحدها**: حاجزٌ يرفض ولا يُقيّد يُخفي المحاولة.
 *
 * 2) **يُقاس تغييرُ النصّ بعد الاعتماد**: هو الحالةُ التي تُبطل قيمةَ الشهادة في الواقع.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { IndependenceRegistry, VERDICT_AUTHOR } from '../../src/audit/independence';

const VERDICT = '# أحكام التدقيق\n\nC-14: مستوفى\nC-18: فجوة (T-115)\n';

function setup(): { audit: AppendOnlyLog; reg: IndependenceRegistry } {
  const audit = new AppendOnlyLog();
  return { audit, reg: new IndependenceRegistry({ audit }) };
}

test('T-115: جهةُ مراجعةٍ معلنة تعتمد حكمًا كتبه غيرُها، فيُقيَّد الاعتماد', () => {
  const { audit, reg } = setup();
  const r = reg.attest('authority:grievances_bureau', {
    verdictAuthor: VERDICT_AUTHOR,
    verdictText: VERDICT,
    decision: 'approved',
    reason: 'قُرئت الأحكام الـ21 وسندُ كلٍّ منها في docs/audit/measurements',
  });
  assert.equal(r.ok, true);
  assert.equal(reg.isIndependentlyApproved(VERDICT), true);
  const kinds = audit.snapshot().map((e) => e.kind);
  assert.ok(kinds.includes('audit_independence_attested'));
});

test('T-115: كاتبُ الحكم لا يعتمد حكمه — ويُقيَّد منعُه', () => {
  const { audit, reg } = setup();
  const r = reg.attest(VERDICT_AUTHOR, {
    verdictAuthor: VERDICT_AUTHOR, verdictText: VERDICT, decision: 'approved',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /من كتب الحكم لا يعتمده/);
  assert.equal(reg.isIndependentlyApproved(VERDICT), false);
  assert.ok(audit.snapshot().some((e) => e.kind === 'audit_independence_refused'));
});

test('T-115: جهةٌ غير معلنة للمراجعة تُرفض ولو لم تكتب الحكم', () => {
  const { reg } = setup();
  const r = reg.attest('agent:helper', {
    verdictAuthor: VERDICT_AUTHOR, verdictText: VERDICT, decision: 'approved',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /جهة غير معلنة للمراجعة/);
});

test('T-115: تغييرُ نصّ الحكم بعد الاعتماد يُبطل انطباقَ الشهادة عليه', () => {
  const { reg } = setup();
  reg.attest('authority:grievances_bureau', {
    verdictAuthor: VERDICT_AUTHOR, verdictText: VERDICT, decision: 'approved', reason: 'قُرئ',
  });
  const altered = VERDICT.replace('C-18: فجوة (T-115)', 'C-18: مستوفى');
  assert.equal(reg.isIndependentlyApproved(altered), false, 'شهادةٌ على نصٍّ لا تسري على نصٍّ آخر');
  assert.equal(reg.isIndependentlyApproved(VERDICT), true);
});

test('T-115: الردُّ مشروعٌ ولا يُقبل بلا سبب، والشهادةُ لا تُكرَّر', () => {
  const { audit, reg } = setup();
  const noReason = reg.attest('authority:grievances_bureau', {
    verdictAuthor: VERDICT_AUTHOR, verdictText: VERDICT, decision: 'rejected', reason: '  ',
  });
  assert.equal(noReason.ok, false);
  if (!noReason.ok) assert.match(noReason.reason, /لا ردّ بلا سبب مكتوب/);

  const rejected = reg.attest('authority:grievances_bureau', {
    verdictAuthor: VERDICT_AUTHOR, verdictText: VERDICT, decision: 'rejected',
    reason: 'سندُ C-11 تقريرُ منفّذٍ لا قياسٌ مستقل',
  });
  assert.equal(rejected.ok, true);
  assert.equal(reg.isIndependentlyApproved(VERDICT), false, 'الردُّ ليس اعتمادًا');

  const again = reg.attest('authority:grievances_bureau', {
    verdictAuthor: VERDICT_AUTHOR, verdictText: VERDICT, decision: 'approved', reason: 'عدولٌ',
  });
  assert.equal(again.ok, false, 'لا تُبدَّل شهادةٌ قائمة بأخرى بلا مسار معلن');
  assert.equal(reg.attestationsFor(VERDICT).length, 1);
  assert.equal(audit.verifyIntegrity().valid, true);
});
