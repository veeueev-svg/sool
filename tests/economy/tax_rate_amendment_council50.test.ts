/**
 * tests/economy/tax_rate_amendment_council50.test.ts — اختباراتُ مجلسِ الجولة 50 (W-2026-065)
 * الجولة 50 (الجلسة 148 · علاج عيبَي gemini): TAX_LEVY_SINK_NULL_DECLINE_SWALLOWED —
 * الرفضُ التعاقديُّ للوسيطِ (ردُّ null «لم يُدوَّن») كان يُبتلَعُ في commit فيتحققُ انفصامُ
 * الجولة 49 بلا رميٍّ ولا إقفال؛ وCOLLECT_TREASURY_RECEIPT_TAX_LEVY_SPLIT_DOUBLE_RECEIPT —
 * إيصالُ الخزانةِ الدائمُ قبلَ قيدٍ فاشلٍ يفتحُ تحصيلًا مزدوجًا بعدَ الإقلاع (75000 ← 150000).
 * العلاج: كشفُ الرفضِ التعاقديِّ برميٍّ مسمًى وإقفالٍ كالرمي، وإيصالُ تحصيلٍ حتميُّ الهويةِ
 * من مفتاحِ الرسمِ (لا إيصالَ ثانيًا لتحصيلٍ واحدٍ بعدَ إقلاعٍ وإعادةِ محاولة).
 * ملفٌّ جديدٌ معلنٌ لسقفِ الوحدةِ 400 سطرًا (سابقةُ الجلستين 133 و138 و147 · توسيعُ نطاقٍ معلن).
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVENUE_TARGET, bootstrapState } from '../../src/index';

const NOW = Date.now();
const TREASURY = 'treasury:general';

/** يوميّةٌ حقيقيةٌ بمجلدِ حالةٍ — عينُ عدةِ المشهدِ في tax_rate_amendment_replay.test.ts */
function journalScene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rate-council50-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = NOW) => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('**T-53/مجلس 50أ** — TAX_LEVY_SINK_NULL_DECLINE_SWALLOWED (gemini · الجولة 50): ردُّ الوسيطِ التعاقديُّ null عند قيدِ tax_levy لا يُبتلَع — رميٌ مسمًّى وإقفالٌ كالرمي، والإقلاعُ من اليوميةِ الحقيقيةِ يحسمُ الحالَّ (علاجُ الجلسة 148)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 1_000;
    const s = sc.boot();
    const a = s.revenue.assess('compute_usage', 'external:compute-provider', 3_000_000, at, at);
    assert.equal(a.ok, true, 'تقديرٌ للمسبار');
    const idA = a.ok ? a.levy.levyId : '';
    const cmd = s.king.issueCommand('amend_policy', REVENUE_TARGET, { kind: 'economy' }, at);
    assert.equal(s.gateway.authorize(cmd, at).allowed, true, 'أمرُ الإعفاءِ معتمدٌ — بذرةُ المسبار');
    // عقدُ فشلِ وسيطِ الخدمةِ (محاكاةُ مسبارِ gemini بحرفِه): الشاهدُ يُلحَقُ في السجلِّ
    // الدائمِ ثمّ يردُّ الوسيطُ null عند tax_levy وحده — الرفضُ التعاقديُّ «لم يُدوَّن».
    s.revenue.attachJournal({
      record: (kind: string) => {
        if (kind === 'tax_levy') return null; // الرفضُ التعاقديُّ لا الرمي — عينُ العيبِ المبتلَع
        return null;
      },
    });
    // الكشف: رميٌ مسمًّى — الرفضُ التعاقديُّ ليس نجاحًا صامتًا (قبلَ العلاجِ كان ok:true)
    assert.throws(() => s.revenue.waive(cmd, idA, 'إعفاءٌ بوسيطِ خدمةٍ رافضٍ تعاقديًّا', at + 1),
      /TAX_LEVY_SINK_OUTCOME_UNKNOWN/, 'الرفضُ التعاقديُّ nulّ نتيجةٌ غيرُ معلومةٍ مسمّاة');
    assert.equal(s.audit.find('levy_waived').length, 1, 'الشاهدُ نُجّحَ قبلَ الفشل — جوهرُ العيب');
    // الإقفال: لا استمرارَ بعده — الخدمةُ مقفلةٌ كما في مسارِ الرمي
    assert.throws(() => s.revenue.assess('compute_usage', 'external:compute-provider', 4_000_000, at + 2, at + 2),
      /REVENUE_SINK_OUTCOME_UNRESOLVED/, 'لا تقديرَ على خدمةٍ مقفلة');
    assert.throws(() => s.revenue.collect(idA, at + 3),
      /REVENUE_SINK_OUTCOME_UNRESOLVED/, 'لا تحصيلَ على خدمةٍ مقفلة');
    // الإقلاعُ من اليوميةِ الحقيقيةِ يحسمُ الحالَّ: قيدُ tax_levy المعفي لم يُكتب قطُّ
    // فالتقديرُ assessed والشاهدُ اليتيمُ باقٍ والسلسلةُ سليمة.
    const second = sc.boot(at + 60_000);
    assert.equal(second.revenue.get(idA)?.status, 'assessed', 'اليوميةُ الحقيقيةُ تحسم: لا أثرَ دائمًا للإعفاء');
    assert.equal(second.audit.find('levy_waived').length, 1, 'وشاهدُ الإعفاءِ اليتيمُ باقٍ — الحدُّ المعلن');
    assert.equal(second.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمة');
    const retry = second.revenue.waive(cmd, idA, 'إعادةُ الأمرِ اليتيم', at + 61_000);
    assert.equal(retry.ok, false, 'الشاهدُ اليتيمُ يمنعُ إعادةَ الأمرِ — الحدُّ المعلن');
    assert.equal(second.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمةٌ بعدَ الإقلاعِ الثاني');
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 50ب** — COLLECT_TREASURY_RECEIPT_TAX_LEVY_SPLIT_DOUBLE_RECEIPT (gemini · الجولة 50): إيصالُ الخزانةِ الدائمُ قبلَ قيدٍ فاشلٍ لا يفتحُ تحصيلًا مزدوجًا بعدَ الإقلاع — إعادةُ المحاولةِ تستأنفُ بالإيصالِ نفسِهِ لا بثانٍ (علاجُ الجلسة 148)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 1_000;
    const s = sc.boot();
    const a = s.revenue.assess('compute_usage', 'external:compute-provider', 3_000_000, at, at);
    assert.equal(a.ok, true, 'تقديرٌ للمسبار (75000)');
    const idA = a.ok ? a.levy.levyId : '';
    // عقدُ فشلِ وسيطِ الخدمةِ (محاكاةُ مسبارِ gemini بحرفِه): الإيصالُ يُنشأ دومًا ثمّ يرمي
    // الوسيطُ عند قيدِ tax_levy وحده — فالإيصالُ دائمٌ والقيدُ مجهولُ العاقبة.
    s.revenue.attachJournal({
      record: (kind: string) => {
        if (kind === 'tax_levy') throw new Error('PROBE_TAX_LEVY_SINK_REFUSAL');
        return null;
      },
    });
    assert.throws(() => s.revenue.collect(idA, at + 1),
      /TAX_LEVY_SINK_OUTCOME_UNKNOWN/, 'فشلُ القيدِ بعدَ الإيصالِ نتيجةٌ غيرُ معلومةٍ مسمّاة');
    // الإيصالُ الأولُ دائمٌ: رصيدُ الخزانةِ 75000 وشاهدُ revenue_received واحد
    assert.equal(s.ledger.balance(TREASURY), 75_000, 'الإيصالُ دائمٌ بعدَ فشلِ القيد');
    assert.equal(s.audit.find('revenue_received').length, 1, 'إيصالٌ واحدٌ لا اثنان');
    // الإقلاعُ من اليوميةِ الحقيقيةِ يحسمُ الحالَّ: الرسمُ assessed والإيصالُ باقٍ
    const second = sc.boot(at + 60_000);
    assert.equal(second.revenue.get(idA)?.status, 'assessed', 'اليوميةُ تحسم: لا قيدَ للتحصيل');
    assert.equal(second.ledger.balance(TREASURY), 75_000, 'والإيصالُ الدائمُ باقٍ بعدَ الإقلاع');
    assert.equal(second.audit.find('revenue_received').length, 1, 'وشاهدُ الإيصالِ واحدٌ بعدَ الإقلاع');
    // إعادةُ المحاولةِ تستأنفُ بالإيصالِ نفسِهِ: تحصيلٌ واحدٌ لا ثانٍ — الرصيدُ لا يتضاعف
    const retry = second.revenue.collect(idA, at + 61_000);
    assert.equal(retry.ok, true, 'إعادةُ المحاولةِ تنجحُ بالإيصالِ القائمِ لا بثانٍ');
    assert.equal(second.ledger.balance(TREASURY), 75_000, 'تحصيلٌ ماليٌّ واحدٌ — لا 150000');
    assert.equal(second.revenue.get(idA)?.status, 'collected', 'والرسمُ محصَّلٌ بالإيصالِ نفسِه');
    assert.equal(second.audit.find('revenue_received').length, 1, 'لا إيصالَ ثانيًا لتحصيلٍ واحد');
    assert.equal(second.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمة');
    // والتحصيلُ المكتملُ لا يُعاد: رفضٌ مسمًّى لا إيصالٌ ثالث
    const again = second.revenue.collect(idA, at + 62_000);
    assert.equal(again.ok, false, 'محصَّل سابقًا — لا تحصيل مرتين (ثابت 5)');
  } finally {
    sc.clean();
  }
});
