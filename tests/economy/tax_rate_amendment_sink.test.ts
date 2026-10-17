/**
 * tests/economy/tax_rate_amendment_sink.test.ts — الوسيطُ الدائمُ لشاهدِ التعديلِ الملكيّ (T-53 · W-2026-065)
 * اختباراتُ علاقةِ الإضافةِ بالوسيطِ المُقيَّدِ: رميُه نتيجةٌ غير معلومة، وردُّه null رفضٌ مسمّى —
 * فُكِّكت هنا من tests/economy/tax_rate_amendment.test.ts لسقفِ الوحدةِ 400 سطرًا (الجلسة 133 ·
 * سابقةُ rehydrate_fiscal_rate) — الاختباراتُ نفسُها بلا تغييرٍ في المعيارِ أو القياس.
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVENUE_TARGET, UNIT_TARGET, bootstrapState } from '../../src/index';
import type { DurableSink } from '../../src/data/persistence';

const NOW = Date.now();
const T1 = NOW + 10_000;

function revenueState() {
  const s = bootstrapState({ now: NOW });
  const royal = (target: string, at = NOW, base?: string, ratePerMille?: number) =>
    s.king.issueCommand('amend_policy', target,
      base === undefined ? { kind: 'economy' } : { kind: 'economy', base, ratePerMille: ratePerMille ?? 0 }, at);
  s.unit.issue(royal(UNIT_TARGET), 10_000_000, 'تمويل أولي', NOW);
  return { s, royal };
}

test('**T-53/مجلس 9ج** — RATE_AMENDMENT_DURABILITY_COMMIT_NONATOMIC: فشلُ كتابة الشاهد الدائم يُرجع الحال كاملًا', () => {
  const { s, royal } = revenueState();
  const cmd = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  const before = s.audit.length;
  // وسيطٌ دائمٌ يرفض كتابة قيد rate_amended وحده — عينُ مسبار الجلسة 9
  const refusingSink: DurableSink = {
    record: (kind, payload, at = 0) => {
      if ((payload as { kind?: string } | undefined)?.kind === 'rate_amended') throw new Error('PROBE_DURABILITY_REFUSAL');
      // غيرُ الشاهدِ يُدوَّن قيدًا صوريًّا: ردُّ null صار رفضًا مسمّى لا «التزامًا» صامتًا (الجلسة 11)
      return { seq: 0, at, kind, payload, prevHash: '0', hash: '0' };
    },
  };
  s.audit.attachSink(refusingSink);
  // رميُ الوسيط صار نتيجةً غير معلومةٍ (الجلسة 11): قد يكونُ دُوّنَ ثم رمى — والإرجاعُ الحَكَم
  assert.throws(() => s.revenue.amendRate(cmd, 'compute_usage', 40, T1),
    (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNKNOWN'
      && (e.cause as Error | undefined)?.message === 'PROBE_DURABILITY_REFUSAL',
    'رميُ الوسيط يُرمي «مجهولَ النتيجة» بعلةٍ لا يُبتلع');
  // الحالُ رُدَّ كاملًا: لا نسبةَ جديدة ولا تاريخَ زائد ولا أمرًا محروقًا ولا قيدًا في الذاكرة
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ الحاكمة لم تتغير');
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 1, 'التاريخُ لم يزدد');
  assert.equal(s.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديلٍ في الذاكرة');
  // قيدُ اعتمادِ البوابة (command_approved) وحده بقي — وهو أثرُ محاولةٍ مشروعةٌ لا شاهدُ تعديل؛
  // وقيدُ rate_amended نفسُه رُدَّ — فالإضافةُ ذرّيّة
  assert.equal(s.audit.length, before + 1, 'قيدُ rate_amended رُدّ ولم يبقَ إلا قيدُ البوابة');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةٌ بعد الرد');
  // والأمرُ لم يُستهلك: بعد زوال السبب ينجحُ التعديلُ بالمعرّف نفسه
  const okSink: DurableSink = {
    record: (kind, payload, at = 0) => ({ seq: 0, at, kind, payload, prevHash: '0', hash: '0' }),
  };
  s.audit.attachSink(okSink);
  const retry = s.revenue.amendRate(cmd, 'compute_usage', 40, T1);
  assert.equal(retry.ok, true, 'إعادةُ الأمرِ بعد زوالِ سببِ الفشل تنجح');
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40);
  assert.equal(s.audit.find('rate_amended').length, 1, 'وشاهدٌ واحدٌ لا اثنان');
});

test('**T-53/مجلس 11ب** — RATE_AMENDMENT_SINK_NULL_ACCEPTED_AS_COMMIT: ردُّ الوسيطِ null رفضٌ مسمّى لا التزامٌ صامت (الجلسة 133)', () => {
  const { s, royal } = revenueState();
  const cmd = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  const before = s.audit.length;
  // وسيطٌ يردُّ null للشاهدِ الدائمِ وحده بلا رمي — عينُ مسبارِ الجلسة 11 المسدودِ سابقًا:
  // القبولُ الصامتُ كان يُمرِّرُ التعديلَ بلا شاهدٍ دائمٍ (ok=true · durableKept=[])
  const decliningSink: DurableSink = {
    record: (kind, payload, at = 0) => {
      if ((payload as { kind?: string } | undefined)?.kind === 'rate_amended') return null;
      // غيرُ الشاهدِ يُدوَّن قيدًا صوريًّا كما في 9ج — فالمقصودُ عينُ الرفضِ الصامتِ للشاهدِ
      return { seq: 0, at, kind, payload, prevHash: '0', hash: '0' };
    },
  };
  s.audit.attachSink(decliningSink);
  assert.throws(() => s.revenue.amendRate(cmd, 'compute_usage', 40, T1),
    (e: Error) => e.message === 'AUDIT_SINK_DECLINED_RECORD',
    'ردُّ null رفضٌ مسمّى لا التزامٌ صامت');
  // الحالُ رُدَّ كاملًا: لا نسبةَ جديدةَ ولا تاريخَ زائدًا ولا شاهدًا في الذاكرة
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ الحاكمة لم تتغير');
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 1, 'التاريخُ لم يزدد');
  assert.equal(s.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديلٍ في الذاكرة');
  // قيدُ اعتمادِ البوابةِ وحده بقي — وقيدها رُدَّ، فالإضافةُ ذرّيّة
  assert.equal(s.audit.length, before + 1, 'قيدُ rate_amended رُدَّ ولم يبقَ إلا قيدُ البوابة');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةٌ بعد الرد');
  // والأمرُ لم يُحرق: بعد وسيطٍ سليمٍ ينجحُ التعديلُ بالمعرّفِ نفسِه — فالرفضُ المسمّى لا يستهلكُ الأمر
  const okSink: DurableSink = {
    record: (kind, payload, at = 0) => ({ seq: 0, at, kind, payload, prevHash: '0', hash: '0' }),
  };
  s.audit.attachSink(okSink);
  const retry = s.revenue.amendRate(cmd, 'compute_usage', 40, T1);
  assert.equal(retry.ok, true, 'إعادةُ الأمرِ بعد وسيطٍ سليم تنجح');
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40);
  assert.equal(s.audit.find('rate_amended').length, 1, 'وشاهدٌ واحدٌ لا اثنان');
});
