/**
 * tests/economy/tax_rate_amendment_alias.test.ts — حارسُ بدائيّةِ مداخلِ الرسومِ (T-53 · W-2026-065)
 * الجولة 40 (الجلسة 138 · علاج عيب grok TAX_LEVY_NONPRIMITIVE_FIELD_ALIAS): لا كائنٌ يُقرأُ مرارًا
 * فيُخزَّنَ مرجعُه الحيُّ — من جنس حارسِ الجلسة 9 في amendRate (RATE_AMENDMENT_EFFECTIVE_AT_MUTABLE_OBJECT_ESCAPE).
 * فُكِّكت هنا في ملفٍّ جديدٍ معلنٍ لسقفِ الوحدةِ 400 سطرًا (سابقةُ الجلسة 133 · rehydrate_fiscal_rate ·
 * توسيعُ نطاقٍ معلنٌ في §2 من عقدِ البند).
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVENUE_TARGET, bootstrapState } from '../../src/index';

const NOW = Date.now();

test('**T-53/مجلس 40ب** — TAX_LEVY_NONPRIMITIVE_FIELD_ALIAS: الكائنُ في المدخلِ مرفوضٌ مسمّى — لا مرجعٌ حيٌّ يُخزَّنُ في الحالِ ولا في الشاهد (علاجُ الجولة 40 · الجلسة 138)', () => {
  const s = bootstrapState({ now: NOW });
  const before = s.audit.length;
  // مسبارُ grok بحرفه: payer كائنٌ بـtrim يقرأُ متغيّرًا وoccurredAt/now كائنانِ بـvalueOf
  let who = 'external:compute-provider';
  const payerProbe = { trim: () => who, toString: () => who, valueOf: () => 1 } as unknown as string;
  const clock = { valueOf: () => NOW + 1_000 } as unknown as number;
  const refused = s.revenue.assess('compute_usage', payerProbe, 1_000_000, clock, clock);
  assert.equal(refused.ok, false, 'الكائنُ في المدخلِ مرفوضٌ لا يُخزَّنُ مرجعًا حيًّا');
  assert.match(refused.reason, /المدخلُ بدائيٌّ محدد/);
  // لا أثرَ إطلاقًا: لا تقديرَ في الحالِ ولا شاهدَ levy_assessed — ورفضٌ مسمًّى بقيدٍ واحد
  assert.equal(s.revenue.outstanding().length, 0, 'لا تقديرَ خُزِّن');
  assert.equal(s.audit.find('levy_assessed').length, 0, 'لا شاهدَ تقدير');
  assert.equal(s.audit.length, before + 1, 'قيدُ الرفضِ وحده');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمة');
  // وقلبُ الصناديقِ بعدَ الرفضِ لا يجدُ شيئًا يُزوَّر: لا حالَ ولا شاهدَ يُمسكُ المرجعَ أصلًا
  who = 'forged:after';
  assert.equal(s.revenue.outstanding().length, 0, 'قلبُ الصناديقِ بعدَ الرفضِ بلا أثر');
  // والمدخلُ البدائيُّ السليمُ يُقبَل — الحارسُ لا يعطّلُ الطريقَ القويم
  const ok = s.revenue.assess('compute_usage', 'external:compute-provider', 1_000_000, NOW + 1_000, NOW + 1_000);
  assert.equal(ok.ok, true, 'التقديرُ البدائيُّ السليمُ ينجح');
  // ومن الجنسِ نفسِه في الوحدةِ نفسِها: لحظةُ التحصيلِ الكائنةُ مرفوضةٌ مسمّاة (collectedAt لا يُخزَّنُ مرجعًا)
  const refusedCollect = s.revenue.collect(ok.ok ? ok.levy.levyId : '', { valueOf: () => NOW + 2_000 } as unknown as number);
  assert.equal(refusedCollect.ok, false, 'لحظةُ التحصيلِ الكائنةُ مرفوضة');
  assert.match(refusedCollect.reason, /لحظةُ التحصيلِ رقمٌ محدد/);
  // وسببُ الإعفاءِ الكائنُ ولحظتُه الكائنةُ مرفوضانِ مسمّيين (البابُ الثالثُ من الوحدةِ نفسِها)
  const waiveCmd = s.king.issueCommand('amend_policy', REVENUE_TARGET, { kind: 'economy' }, NOW + 3_000);
  const refusedWaive = s.revenue.waive(waiveCmd, ok.ok ? ok.levy.levyId : '',
    { trim: () => 'إعفاء' } as unknown as string, { valueOf: () => NOW + 3_000 } as unknown as number);
  assert.equal(refusedWaive.ok, false, 'سببُ الإعفاءِ الكائنُ مرفوض');
  assert.match(refusedWaive.reason, /سببُ الإعفاءِ نص/);
  // والتحصيلُ البدائيُّ السليمُ يعملُ بالمبلغِ الكنونيّ — والسلسلةُ سليمة
  const good = s.revenue.collect(ok.ok ? ok.levy.levyId : '', NOW + 4_000);
  assert.equal(good.ok, true, 'التحصيلُ البدائيُّ ينجح');
  assert.equal(good.ok ? good.levy.levied : 0, 25_000, 'وبالمبلغِ الكنونيّ');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمة');
});
