/**
 * tests/agents/lineage.test.ts — قياسُ النسب المشتَقّ (المرحلة 39، T-25)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: خرائطُ أصولٍ مصطنعة | المخرجات: سلسلةُ نسبٍ وجيلٌ مقيسان
 * التبعيات: src/agents/lineage.ts وحده — وحدةٌ نقيّةٌ بلا تبعية
 * الصلاحيات: القياسُ وحده | السجلات: لا شيء
 * حالات الفشل: تُقرأ برمزها (`LINEAGE_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 * ثابتُ هذا الملف: **الجيلُ ناتجُ حسابٍ على النسب لا حقلٌ يُدّعى.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLineage, derivePendingLineage, verifyLineageClaims } from '../../src/index';
import type { ParentLookup } from '../../src/index';

/** خريطةُ أصول: القيمةُ null تعني جذرًا، وغيابُ المفتاح يعني أصلًا غير معلن */
function parents(map: Record<string, string | null>): ParentLookup {
  return (id) => (Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined);
}

test('جذرٌ بلا أصل: جيلُه 1 وسلسلتُه نفسُه وحده', () => {
  const chain = deriveLineage('a', parents({ a: null }));
  assert.equal(chain.ok, true);
  assert.deepEqual(chain.ok && chain.chain, ['a']);
  assert.equal(chain.ok && chain.generation, 1);
});

test('سلسلةُ ثلاثةٍ: الجيلُ ثلاثةٌ والترتيبُ من الجذر إلى الفرع', () => {
  const chain = deriveLineage('c', parents({ a: null, b: 'a', c: 'b' }));
  assert.equal(chain.ok, true);
  assert.deepEqual(chain.ok && chain.chain, ['a', 'b', 'c']);
  assert.equal(chain.ok && chain.generation, 3);
});

test('أصلٌ غيرُ معلنٍ يُرفض برمزه لا بصمتٍ ولا بجذرٍ مفترض', () => {
  const chain = deriveLineage('b', parents({ b: 'ghost' }));
  assert.equal(chain.ok, false);
  assert.equal(!chain.ok && chain.code, 'LINEAGE_PARENT_UNDECLARED');
  assert.match(!chain.ok ? chain.reason : '', /ghost/);
});

test('مخططٌ أصلُ نفسِه يُرفض حلقةً لا يُقاس جيلًا', () => {
  const chain = deriveLineage('a', parents({ a: 'a' }));
  assert.equal(chain.ok, false);
  assert.equal(!chain.ok && chain.code, 'LINEAGE_CYCLE');
});

test('دَورٌ في سلسلةٍ أطول يُرفض ولا يُدور فيه إلى ما لا نهاية', () => {
  const chain = deriveLineage('c', parents({ a: 'c', b: 'a', c: 'b' }));
  assert.equal(chain.ok, false);
  assert.equal(!chain.ok && chain.code, 'LINEAGE_CYCLE');
});

test('سلسلةٌ عميقةٌ جدًّا تُقاس بلا تجاوزِ مكدَّس — القياسُ لا يسقط', () => {
  const map: Record<string, string | null> = { 'n0': null };
  for (let i = 1; i < 900; i += 1) map[`n${i}`] = `n${i - 1}`;
  const chain = deriveLineage('n899', parents(map));
  assert.equal(chain.ok, true);
  assert.equal(chain.ok && chain.generation, 900);
});

test('سلسلةٌ تفوق حدَّ السير تُرفض ولا تُقاس بجيلٍ مغلوط', () => {
  const map: Record<string, string | null> = { 'n0': null };
  for (let i = 1; i < 2000; i += 1) map[`n${i}`] = `n${i - 1}`;
  const chain = deriveLineage('n1999', parents(map));
  assert.equal(chain.ok, false);
});

test('نسبٌ مقترحٌ لمخططٍ لم يُعلن بعد يُقاس قبل إعلانه', () => {
  const pending = derivePendingLineage('new', 'b', parents({ a: null, b: 'a' }));
  assert.equal(pending.ok, true);
  assert.deepEqual(pending.ok && pending.chain, ['a', 'b', 'new']);
  assert.equal(pending.ok && pending.generation, 3);
});

test('نسبٌ مقترحٌ جذرًا: جيلُه 1 قبل الإعلان', () => {
  const pending = derivePendingLineage('new', null, parents({}));
  assert.equal(pending.ok, true);
  assert.equal(pending.ok && pending.generation, 1);
});

test('نسبٌ مقترحٌ من أصلٍ غيرِ معلنٍ يُرفض قبل الإعلان لا بعده', () => {
  const pending = derivePendingLineage('new', 'ghost', parents({}));
  assert.equal(pending.ok, false);
  assert.equal(!pending.ok && pending.code, 'LINEAGE_PARENT_UNDECLARED');
});

test('نسبٌ مقترحٌ يجعل المخططَ أصلَ نفسِه يُرفض قبل الإعلان', () => {
  const pending = derivePendingLineage('new', 'new', parents({}));
  assert.equal(pending.ok, false);
  assert.equal(!pending.ok && pending.code, 'LINEAGE_SELF_PARENT');
});

test('تدقيقُ الدعاوى: كلُّ جيلٍ مطابقٌ لنسبِه فلا انحراف', () => {
  const verdict = verifyLineageClaims(
    new Map([['a', 1], ['b', 2]]),
    parents({ a: null, b: 'a' }),
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.drifts.length, 0);
});

test('تدقيقُ الدعاوى يكشفُ المُنقِصَ والمُبالِغَ ولا يُصلح أيًّا منهما', () => {
  const claims = new Map([['a', 1], ['b', 1], ['c', 9]]);
  const verdict = verifyLineageClaims(claims, parents({ a: null, b: 'a', c: 'b' }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.drifts.length, 2);
  const b = verdict.drifts.find((d) => d.blueprintId === 'b');
  assert.equal(b?.claimed, 1);
  assert.equal(b?.measured, 2);
  const c = verdict.drifts.find((d) => d.blueprintId === 'c');
  assert.equal(c?.claimed, 9);
  assert.equal(c?.measured, 3);
  // الدعاوى نفسُها لم تُمَسّ: الكشفُ لا يُصلح (درسُ T-119)
  assert.equal(claims.get('b'), 1);
});

test('تدقيقُ الدعاوى يكشفُ نسبًا معطوبًا لا يُقاس أصلًا', () => {
  const verdict = verifyLineageClaims(new Map([['b', 2]]), parents({ b: 'ghost' }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.drifts[0]?.measured, null);
  assert.equal(verdict.drifts[0]?.code, 'LINEAGE_PARENT_UNDECLARED');
});
