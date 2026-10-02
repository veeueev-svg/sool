/**
 * tests/production/production_scanners.test.ts — ماسحات وحدات المراحل السابقة (المرحلة 37)
 * المالك: ديوان التدقيق | المدخلات: واجهات قراءة ضيّقة مُبدَلة + سجل تدقيق حقيقي
 * المخرجات: لكل ماسح حادثٌ يرفعه، ولا تكرار للحادث نفسه بين مسحتين
 * التبعيات: loadsProbe, digitalUnitProbe, factoriesProbe, hospitalsProbe, retentionProbe, passageProbe
 * الصلاحيات: قياس فقط — والماسح لا يُصلح ما يجده
 * حالات الفشل المقيسة: أمر بلا مصير، تباين عدّاد الوحدة، دفعة متجاوزة، خدمة بإعلان منتهٍ،
 *   سجل تجاوز الاحتفاظ، فعل إقليمي بلا إذن مرور، محاولة تجاوز مُنعت
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 * ثابت الاختبار: الماسح يقرأ الوحدة الفعلية لا نسخةً موازية — فتُبدَل الواجهة لا المنطق
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadsProbe, digitalUnitProbe, factoriesProbe, hospitalsProbe, retentionProbe, passageProbe,
  buildProductionScanners, ProductionScannerDeps, PRODUCTION_KNOWN_SCANNERS,
} from '../../src/index';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { OBSERVER, quietDeadlines, repoPolicy, silentProbes } from './helpers';

const POLICY = repoPolicy();
const NOW = 1_700_000_000_000;

function deps(patch: Partial<ProductionScannerDeps> = {}): ProductionScannerDeps {
  const audit = new AppendOnlyLog();
  return {
    audit,
    loads: { overdue: () => [] },
    unit: { reconcile: () => ({ consistent: true, counter: 1, ledger: 1 }) },
    factories: { sweep: () => [] },
    hospitals: { report: () => ({ expired: 0, halted: 0 }) },
    retention: { sweep: () => ({ purged: [] }) },
    passage: { active: true, wasOpenAt: () => true },
    policy: POLICY,
    retentionAuthority: OBSERVER,
    // T-120: الافتراض «ثابتٌ صحيح» لتبقى الماسحات الأخرى مقيسةً وحدها؛ ومن يقيس
    // الثبات يُبدّل هذا الحقل صراحةً.
    durable: {
      file: '/tmp/sool-test/state.jsonl',
      verify: () => ({ valid: true, length: 1, reason: null }),
      droppedByKind: () => new Map<string, number>(),
    },
    // T-16: كذلك الحصرُ يُثبَّت محصورًا لتبقى الماسحات الأخرى مقيسةً وحدها.
    confinement: { witnessRoot: '/proc(مُصطنع)', verify: () => ({ confined: true, failures: [] }) },
    deadlines: quietDeadlines(),
    ...patch,
  };
}

test('ماسح الأحمال: أمرٌ بلا مصير بعد المدة المعلنة فقدٌ يُرفع مرة واحدة', () => {
  const probe = loadsProbe(deps({ loads: { overdue: () => ['cmd:1', 'cmd:2'] } }));
  const first = probe(NOW);
  assert.equal(first.length, 2);
  assert.equal(first[0]?.kind, 'command_loss_over_limit');
  assert.match(String(first[0]?.detail), /cmd:1/);
  assert.equal(probe(NOW + POLICY.supervision.tick_ms).length, 0, 'لا تكرار للحادث نفسه');
});

test('ماسح الأحمال: المدة المقيسة هي المعلنة في التهيئة لا رقمًا في الكود', () => {
  const asked: number[] = [];
  const probe = loadsProbe(deps({
    loads: { overdue: (maxAgeMs: number) => { asked.push(maxAgeMs); return []; } },
  }));
  probe(NOW);
  assert.deepEqual(asked, [POLICY.loads.pending_max_ms]);
});

test('ماسح الوحدة الرقمية: تباين العدّاد والسجل حادث، والتطابق صمت', () => {
  const clean = digitalUnitProbe(deps());
  assert.equal(clean(NOW).length, 0);
  const probe = digitalUnitProbe(deps({
    unit: { reconcile: () => ({ consistent: false, counter: 7, ledger: 5 }) },
  }));
  const found = probe(NOW);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, 'unit_ledger_mismatch');
  assert.equal(probe(NOW + 1).length, 0, 'التباين نفسه لا يُرفع مرتين');
});

test('ماسح المصانع وماسح الخدمات الحرجة يرفعان نوعيهما المعلنين', () => {
  const factories = factoriesProbe(deps({ factories: { sweep: () => ['run:9'] } }));
  const batch = factories(NOW);
  assert.equal(batch[0]?.kind, 'overdue_batch');
  assert.equal(factories(NOW + 1).length, 0);
  const hospitals = hospitalsProbe(deps({ hospitals: { report: () => ({ expired: 2, halted: 0 }) } }));
  const services = hospitals(NOW);
  assert.equal(services[0]?.kind, 'critical_service_unverified');
  assert.equal(hospitals(NOW + 1).length, 0);
});

test('ماسح الاحتفاظ: المسح حادثٌ يُرفع لا صمتٌ يُطوى، وبجهةٍ مُمرَّرة لا مُخترعة', () => {
  const actors: (string | undefined)[] = [];
  let pending = ['rec:1'];
  const probe = retentionProbe(deps({
    retention: {
      sweep: (by?: string) => { actors.push(by); const purged = pending; pending = []; return { purged }; },
    },
  }));
  const found = probe(NOW);
  assert.equal(found[0]?.kind, 'expired_retention');
  assert.deepEqual(actors, [OBSERVER]);
  assert.equal(probe(NOW + 1).length, 0, 'ولا مسحَ فارغًا يُرفع حادثًا');
});

test('ماسح المرور: فعلٌ نفُذ بلا إذن مطابق حادثٌ حرج، والمطابَق لا يُرفع', () => {
  const audit = new AppendOnlyLog();
  const probe = passageProbe(deps({ audit }));
  audit.append('official:region:core', 'region_action_passed', {
    regionId: 'region:core', domain: 'infrastructure', action: 'فعل معتمد', at: NOW,
  });
  audit.append('official:region:core', 'region_action_executed', {
    regionId: 'region:core', domain: 'infrastructure', action: 'فعل معتمد', at: NOW,
  });
  audit.append('official:region:services', 'region_action_executed', {
    regionId: 'region:services', domain: 'services', action: 'فعل بلا إذن', at: NOW,
  });
  const found = probe(NOW);
  assert.equal(found.length, 1, `الحوادث: ${found.map((f) => f.kind).join(', ')}`);
  assert.equal(found[0]?.kind, 'region_action_without_passage');
  assert.match(String(found[0]?.detail), /region:services/);
  assert.equal(probe(NOW + 1).length, 0, 'ولا يُقرأ سجلٌ قُرئ');
});

test('ماسح المرور: محاولة تجاوزٍ مُنعت تُرفع دليلًا على الإنفاذ لا خرقًا للقبول', () => {
  const audit = new AppendOnlyLog();
  const probe = passageProbe(deps({ audit }));
  audit.append('official:region:core', 'region_action_bypass_blocked', {
    regionId: 'region:core', domain: 'infrastructure', action: 'فعل بلا إذن', at: NOW,
  });
  const found = probe(NOW);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, 'crown_passage_bypass');
  assert.ok(POLICY.severity.high.includes('crown_passage_bypass'), 'جسيمٌ لا حرج — فهو دليل إنفاذ');
  assert.ok(POLICY.severity.critical.includes('region_action_without_passage'), 'والنقض حرج');
});

test('ماسح المرور: فعلٌ وقع خارج نافذة مرور مفتوحة لا يُحكم عليه (المرحلة 24 كما هي)', () => {
  const audit = new AppendOnlyLog();
  const probe = passageProbe(deps({ audit, passage: { active: false, wasOpenAt: () => false } }));
  audit.append('official:region:core', 'region_action_executed', {
    regionId: 'region:core', domain: 'infrastructure', action: 'فعل إداري قديم', at: NOW,
  });
  assert.equal(probe(NOW).length, 0);
});

test('البناء يغطي كل ماسح معلن — ولا ماسحَ معلنًا بلا ماسحة (T-105)', () => {
  const probes = buildProductionScanners(deps(), silentProbes(POLICY));
  for (const scanner of POLICY.scanners) {
    assert.equal(typeof probes.get(scanner), 'function', `الماسح ${scanner} مبنيّ`);
  }
  assert.equal(POLICY.scanners.length, PRODUCTION_KNOWN_SCANNERS.length, 'والمعلن هو المعروف كله');
});
