/**
 * tests/kernel/resource_lease_duration.test.ts — مدةُ الإيجارِ عقدٌ لا قيمةٌ واحدة (T-74 · W-2026-018)
 * المالك: وزارة البنية | يوثّق في: docs/test-reports/phase-40-T74.md
 *
 * ما يُثبته:
 *   LD-01 غيابُ التصريح ⇒ السقفُ المعلن كما كان قبل هذا البند (لا سلوكَ قائمًا يتغيّر صامتًا).
 *   LD-02 مدةٌ أقصرُ من السقفِ تُمنح كما طُلبت، فتُستعاد الحصةُ مع انتهاءِ العملِ لا بعده بساعة.
 *   LD-03 مدةٌ أطولُ تُقصَّر إلى السقفِ **ويُسجَّل** التقصيرُ بمطلوبِه وممنوحِه وفارقِه.
 *   LD-04 مدةٌ غيرُ صالحةٍ تُرفض ولا تُحمل على الافتراض، ولا إيجارَ يُنشأ بها.
 *   LD-05 استعادةُ إيجارٍ سبق أن استُعيد بانتهاءِ وقتِه حدثٌ مسمّى لا `false` صامتة.
 *   LD-06 **اتّساقُ الإعلانَين** (T-160 · W-2026-044): مدةُ الدفعةِ المعلنةُ لا تتجاوز سقفَ حصةِ
 *         أيِّ موردٍ يستأجره نوعٌ معلن — وكانت 86400 فوق 3600 (82800 ثانيةً عاطلة). **الأرقامُ
 *         تُقرأ من الإعلانِ لا تُكتب هنا**، والتركيبُ يرفض التناقضَ (`ENTERPRISE_RUN_EXCEEDS_LEASE`).
 *
 * لا تأكيدَ على نصٍّ عربيٍّ مشكول: الأحكامُ على أرقامٍ وأسماءِ أحداثٍ ورموزٍ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { ResourceRegistry } from '../../src/kernel/resource_registry';
import { loadEnterprises, loadQuotas } from '../../src/kernel/config';

const CEILING = 3600;
const SPECS = {
  compute_units: { total: 100, per_agent_max: 10, lease_seconds: CEILING },
};
const T0 = 1_000_000;
const CAPPED = 'resource_lease_duration_capped';
const MISSED = 'resource_release_missed';

function reg() {
  const audit = new AppendOnlyLog();
  return { audit, registry: new ResourceRegistry(audit, SPECS) };
}

function seconds(lease: { grantedAt: number; expiresAt: number }): number {
  return (lease.expiresAt - lease.grantedAt) / 1000;
}

/* ————— LD-01 ————— */

test('LD-01: بلا تصريحٍ بالمدة ⇒ سقفُ الإعلانِ كما كان — لا سلوكَ قائمًا يتغيّر صامتًا', () => {
  const { audit, registry } = reg();
  const result = registry.lease('agent:1', 'compute_units', 5, T0);
  assert.equal(result.granted, true);
  if (!result.granted) return;
  assert.equal(seconds(result.lease), CEILING);
  assert.equal(audit.find(CAPPED).length, 0, 'لا تقصيرَ يُسجَّل حيث لا تصريح');
  const leased = audit.find('resource_leased')[0];
  assert.equal(leased?.detail.grantedSeconds, CEILING);
  assert.equal(leased?.detail.ceilingSeconds, CEILING);
});

/* ————— LD-02: نصُّ T-74 نفسُه ————— */

test('LD-02: عملٌ يعيشُ دقيقةً يستأجرُ دقيقةً — لا ساعةً محتجزةً بعد انتهائه', () => {
  const { audit, registry } = reg();
  const result = registry.lease('facility:f1', 'compute_units', 10, T0, 60);
  assert.equal(result.granted, true);
  if (!result.granted) return;
  assert.equal(seconds(result.lease), 60, 'المدةُ الممنوحةُ هي المطلوبةُ لا السقف');
  assert.equal(registry.allocated('compute_units', T0 + 59_000), 10);
  assert.equal(registry.allocated('compute_units', T0 + 61_000), 0,
    'الحصةُ تُفرَج مع انتهاءِ العملِ لا بعده بـ3540 ثانية');
  assert.equal(registry.reclaimExpired(T0 + 61_000).length, 1);
  assert.equal(audit.find('resource_lease_expired').length, 1);
  assert.equal(audit.find(CAPPED).length, 0);
});

/* ————— LD-03 ————— */

test('LD-03: مدةٌ فوق السقفِ تُقصَّر إليه ويُسجَّل التقصيرُ بمطلوبِه وممنوحِه وفارقِه', () => {
  const { audit, registry } = reg();
  const asked = 86_400;
  const result = registry.lease('facility:f1', 'compute_units', 4, T0, asked);
  assert.equal(result.granted, true);
  if (!result.granted) return;
  assert.equal(seconds(result.lease), CEILING, 'المستأجرُ لا يرفعُ سقفَ نفسِه (RULE-005)');
  const capped = audit.find(CAPPED);
  assert.equal(capped.length, 1, 'الفارقُ الذي كان صامتًا يُسجَّل مرّةً واحدةً عند المنح');
  assert.equal(capped[0]?.detail.requestedSeconds, asked);
  assert.equal(capped[0]?.detail.grantedSeconds, CEILING);
  assert.equal(capped[0]?.detail.shortfallSeconds, asked - CEILING);
  assert.equal(capped[0]?.detail.resource, 'compute_units');
});

test('LD-03ب: مدةٌ مساويةٌ للسقفِ تُمنح بلا تقصيرٍ يُسجَّل — الحدُّ ليس خرقًا', () => {
  const { audit, registry } = reg();
  const result = registry.lease('agent:1', 'compute_units', 1, T0, CEILING);
  assert.equal(result.granted, true);
  if (!result.granted) return;
  assert.equal(seconds(result.lease), CEILING);
  assert.equal(audit.find(CAPPED).length, 0);
});

/* ————— LD-04 ————— */

test('LD-04: مدةٌ غيرُ صالحةٍ تُرفض بذكرِ رمزِها ولا تُحمل على الافتراض', () => {
  for (const asked of [0, -1, -3600, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    const { audit, registry } = reg();
    const result = registry.lease('agent:1', 'compute_units', 5, T0, asked);
    assert.equal(result.granted, false, `مدةٌ مرفوضةٌ متوقّعةٌ عند ${String(asked)}`);
    if (result.granted) return;
    assert.match(result.reason, /LEASE_DURATION_INVALID/);
    assert.equal(registry.activeLeases(T0).length, 0, 'لا إيجارَ يُنشأ بمدةٍ مرفوضة');
    assert.equal(registry.allocated('compute_units', T0), 0);
    assert.equal(audit.find('resource_denied').length, 1);
    assert.equal(audit.find('resource_leased').length, 0);
  }
});

/* ————— LD-05 ————— */

test('LD-05: استعادةٌ لإيجارٍ انتهى وقتُه حدثٌ مسمّى لا false صامتة', () => {
  const { audit, registry } = reg();
  const result = registry.lease('facility:f1', 'compute_units', 6, T0, 60);
  assert.equal(result.granted, true);
  if (!result.granted) return;
  const { leaseId } = result.lease;
  assert.equal(registry.reclaimExpired(T0 + 61_000).length, 1);
  assert.equal(audit.find(MISSED).length, 0, 'لا حدثَ قبل الاستعادةِ الفائتة');
  assert.equal(registry.release(leaseId), false, 'الجوابُ يبقى false — لا اختراعَ لنجاح');
  const missed = audit.find(MISSED);
  assert.equal(missed.length, 1);
  assert.equal(missed[0]?.detail.leaseId, leaseId);
  assert.equal(registry.release(leaseId), false);
  assert.equal(audit.find(MISSED).length, 2, 'كلُّ استعادةٍ فائتةٍ تُقرأ بنفسِها');
});

/* ————— LD-06: اتّساقُ الإعلانَين (T-160 · W-2026-044) ————— */

test('LD-06: مدةُ الدفعةِ المعلنةُ لا تتجاوز سقفَ حصةِ أيِّ موردٍ يستأجره نوعٌ معلن (T-160)', () => {
  const quotas = loadQuotas();
  const enterprises = loadEnterprises();
  const runSeconds = enterprises.policy.max_run_duration_hours * 3600;
  assert.equal(enterprises.kinds.length > 0, true, 'حصرٌ لا يرى نوعًا حصرٌ أعمى');
  for (const kind of enterprises.kinds) {
    const spec = quotas.resources[kind.resource_cost.resource];
    assert.notEqual(spec, undefined, `موردُ ${kind.id} معلنٌ في config/quotas.yaml`);
    assert.equal(runSeconds <= spec!.lease_seconds, true,
      `${kind.id}: مدةُ الدفعة ${runSeconds}ث فوق سقفِ حصتِها ${spec!.lease_seconds}ث — عاد دَينُ T-160`);
  }
});

test('LD-06ب: آليّةُ التقصيرِ باقيةٌ لمن طلب فوق السقف — بمدةٍ مصطنعةٍ لا بالإعلان', () => {
  const quotas = loadQuotas();
  const ceiling = quotas.resources.compute_units!.lease_seconds;
  const runSeconds = ceiling * 24;
  const { audit, registry } = reg();
  const specs = { compute_units: { total: 100, per_agent_max: 10, lease_seconds: ceiling } };
  const live = new ResourceRegistry(audit, specs);
  const result = live.lease('facility:f1', 'compute_units', 4, T0, runSeconds);
  assert.equal(result.granted, true);
  if (!result.granted) return;
  assert.equal(seconds(result.lease), ceiling);
  assert.equal(audit.find(CAPPED)[0]?.detail.shortfallSeconds, runSeconds - ceiling);
  assert.equal(registry.activeLeases(T0).length, 0, 'السجلُّ الأوّلُ لم يُلمس');
});
