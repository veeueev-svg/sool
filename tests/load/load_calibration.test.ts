/**
 * tests/load/load_calibration.test.ts — اختبار وحدة معايرة عتبات الزمن (البند W-2026-004)
 * المالك: ديوان التدقيق | المدخلات: أرقامٌ مصنوعةٌ تُحقن، وقياسٌ واحدٌ حقيقيٌّ للوحدة
 * المخرجات: حكمٌ على **الحساب** لا على سرعة الآلة التي يجري عليها الاختبار
 * التبعيات: src/load/load_calibration.ts + LoadDrill (لحقن `calibrationMs`)
 * الصلاحيات: قياس لا اعتماد
 * السجلات: load_calibration_measured يُتحقَّق من كتابته بأرقامه
 * حالات الفشل: إرخاءٌ فوق السقف بلا رمز خرق، أو تشديدٌ للعتبة على آلةٍ سريعة، أو قياسٌ
 *   مشكوكٌ فيه يُرخي عتبةً — كلُّها تُسقط الاختبار.
 * الوثيقة المرتبطة: docs/test-reports/W-2026-004-load-thresholds.md · docs/decisions/ADR-0041-load-threshold-calibration.md
 * ثوابت هذا الاختبار:
 *   1) **لا ساعةَ في اختبار الحكم**: النسبةُ تُحقن رقمًا، فالنتيجةُ نفسُها على كل آلة.
 *   2) **الحدُّ يُختبر من طرفيه**: تحت السقف إرخاءٌ، وفوقه إعلانُ خرقٍ لا مرورٌ صامت.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapState, CALIBRATION_ITERATIONS, CommandChannel, effectiveThresholds, FairScheduler,
  latencyScale, LoadDrill, LoadLedger, measureCalibrationMs,
} from '../../src/index';

/** تمرينٌ كاملٌ بمعايرةٍ محقونة: الرقمُ من الاختبار لا من عتاد المُشغّل */
function drillWith(calibrationMs: () => number) {
  const dir = mkdtempSync(join(tmpdir(), 'sool-calib-'));
  const now = Date.now();
  const s = bootstrapState({ now, auditPath: join(dir, 'audit.jsonl') });
  const channel = new CommandChannel(s.audit, s.gateway, join(dir, 'channel.json'));
  const scheduler = new FairScheduler(
    s.audit, s.killSwitch, 8,
    s.scaleConfig.policy.scheduler_queue_max, s.scaleConfig.policy.scheduler_owner_queue_max,
  );
  const policy = s.loadConfig.policy;
  const ledger = new LoadLedger({ audit: s.audit, authority: policy.drill_authority, maxLoss: policy.max_command_loss });
  const drill = new LoadDrill({
    audit: s.audit, killSwitch: s.killSwitch, resources: s.resources, ledger, policy,
    mode: () => s.gateway.mode, calibrationMs,
  });
  let counter = 0;
  const issue = () => {
    counter += 1;
    return s.king.issueCommand('create_agent', `agent:calib-${counter}`, { calib: counter }, now);
  };
  return {
    s, policy, drill, run: () => drill.run({ by: policy.drill_authority, channel, scheduler, issue, now }),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('المعايرة: الآلةُ الأسرعُ من المرجع لا تُحاكم بعتبةٍ أضيقَ من المعلنة', () => {
  const reading = latencyScale(3, 12, 8);
  assert.equal(reading.rawScale, 0.25, 'النسبةُ الخام تُدوَّن كما قِيست');
  assert.equal(reading.scale, 1, 'والمُعمَل بها لا تنزل عن 1 قطُّ');
  assert.deepEqual(reading.breaches, [], 'السرعةُ ليست خرقًا');
});

test('المعايرة: الآلةُ الأبطأُ تُرخى لها العتبةُ بقدرِ بطئها لا أكثر', () => {
  const reading = latencyScale(36, 12, 8);
  assert.equal(reading.rawScale, 3);
  assert.equal(reading.scale, 3);
  assert.deepEqual(reading.breaches, []);
  const effective = effectiveThresholds({ channel_p99_ms: 8, channel_max_ms: 60 }, reading.scale);
  assert.equal(effective.p99Ms, 24, 'العتبةُ الفعّالة = المعلنة × النسبة');
  assert.equal(effective.maxMs, 180);
});

test('المعايرة: فوق السقف المعلن يُعلن الخرقُ ولا تُرخى العتبةُ أكثر', () => {
  const reading = latencyScale(12 * 20, 12, 8);
  assert.equal(reading.rawScale, 20);
  assert.equal(reading.scale, 8, 'الإرخاءُ يتوقّف عند السقف');
  assert.deepEqual(reading.breaches, ['CALIBRATION_OVER_MAX_SCALE'], 'وبطءُ الآلة يُقال لا يُبتلع');
});

test('المعايرة: القياسُ المشكوكُ فيه يُبقي العتبةَ المعلنةَ كما هي', () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(latencyScale(bad, 12, 8).scale, 1, `قياسٌ ${bad} لا يُرخي عتبةً`);
    assert.equal(latencyScale(24, bad, 8).scale, 1, `أساسٌ ${bad} لا يُرخي عتبةً`);
  }
  assert.equal(latencyScale(240, 12, Number.NaN).scale, 1, 'سقفٌ غيرُ صالحٍ ⇒ لا إرخاء');
  assert.equal(effectiveThresholds({ channel_p99_ms: 8, channel_max_ms: 60 }, 0.5).p99Ms, 8);
});

test('المعايرة: وحدةُ القياس عددُ دوراتٍ ثابتٌ وزمنٌ موجبٌ منتهٍ', () => {
  assert.equal(CALIBRATION_ITERATIONS, 4_000_000, 'العددُ ثابتٌ مشتركٌ مع مقياس التأسيس');
  const measured = measureCalibrationMs();
  assert.equal(Number.isFinite(measured), true);
  assert.equal(measured > 0, true, 'الحلقةُ لا تُحذف فيصير القياسُ صفرًا كاذبًا');
});

test('المعايرة: التمرينُ يدوّن مقياسَه في السجل الأبدي قبل حكمه', () => {
  const h = drillWith(() => 12 * 3);
  try {
    const out = h.run();
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const entries = h.s.audit.find('load_calibration_measured');
    assert.equal(entries.length, 1, 'المعايرةُ تُقاس مرّةً واحدةً لا مرّةً لكل طور');
    const detail = entries[0]!.detail as Record<string, unknown>;
    assert.equal(detail.baselineMs, h.policy.channel_calibration_baseline_ms);
    assert.equal(detail.scale, 3);
    assert.equal(detail.effectiveP99Ms, h.policy.channel_p99_ms * 3);
    assert.equal(out.report.calibration.scale, 3, 'والتقريرُ يحمل مقياسَه لا يُخفيه');
    assert.equal(out.report.verdict, 'pass');
  } finally { h.clean(); }
});

test('المعايرة: آلةٌ أبطأُ من السقف تُسقط الحكمَ برمزٍ معلنٍ في آخر الخرق', () => {
  const h = drillWith(() => 12 * 500);
  try {
    const out = h.run();
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const r = out.report;
    assert.equal(r.verdict, 'fail', 'بطءٌ فوق المسموح لا يمرّ بحكمٍ ناجح');
    assert.equal(r.breaches[r.breaches.length - 1], 'CALIBRATION_OVER_MAX_SCALE',
      'ورمزُ المعايرة مُذيَّلٌ آخرًا فترتيبُ الرموز القائم لم يتغيّر');
    assert.equal(h.s.audit.find('load_drill_breach').length, 1);
    assert.equal(h.s.audit.find('escalated_to_king').length >= 1, true, 'الخرقُ يُصعَّد لا يُسكت');
  } finally { h.clean(); }
});
