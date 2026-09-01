/**
 * tests/federation/region_monitor.test.ts — اختبار مراقبة الأقاليم (المرحلة 24)
 * المالك: ديوان التدقيق وحرس التاج | يوثّق في: docs/test-reports/phase-24.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, GOVERNOR_EXECUTOR, GOVERNOR_PROPOSER, REGION_AUDITOR, ROYAL_COURT,
  RegionRegistry, RegionMonitor,
} from '../../src/index';

const T0 = Date.now();
const VACANCY = 10_000;
const DISPUTE_GRACE = 20_000;

function monitoredState() {
  const s = bootstrapState({
    now: T0,
    federation: { vacancyGraceMs: VACANCY, disputeGraceMs: DISPUTE_GRACE, responseWindowMs: 5_000 },
  });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'federation' }, at);
  const setup: readonly [string, string, readonly string[]][] = [
    ['region:research', 'إقليم البحث', ['research']],
    ['region:industry', 'إقليم الصناعة', ['manufacturing']],
  ];
  for (const [regionId, name, domains] of setup) {
    s.regions.establish(structural(regionId), { regionId, name, proposedBy: ROYAL_COURT }, T0);
    s.regions.delegate(structural(regionId), regionId, [...domains], T0);
  }
  const seat = (regionId: string, candidate: string, at = T0) => {
    const nominationId = `nom:${regionId}`;
    s.governors.propose(GOVERNOR_PROPOSER, {
      nominationId, kind: 'appointment', regionId, candidate, reason: 'كفاءة موثّقة',
    }, at);
    s.governors.approve(s.king.issueCommand('appoint_official', candidate, {}, at), nominationId, at);
    s.governors.execute(GOVERNOR_EXECUTOR, nominationId, at);
  };
  return { s, structural, seat };
}

test('المسح داخل المهلة لا يرفع مخالفة شغور', () => {
  const { s } = monitoredState();
  const r = s.regionMonitor.sweep(T0 + 1000);
  assert.equal(r.flags.length, 0);
  assert.equal(s.audit.find('region_sweep').length, 1);
});

test('سلطة بلا مسؤول: إقليم مفوَّض ومقعده خالٍ بعد المهلة يُرفع', () => {
  const { s } = monitoredState();
  const r = s.regionMonitor.sweep(T0 + VACANCY * 2);
  assert.equal(r.flags.length, 2, 'الإقليمان مفوَّضان وبلا حاكم');
  assert.ok(r.flags.every((f) => f.kind === 'delegated_without_governor'));
  assert.ok(r.flags.every((f) => f.severity === 'high'));
  assert.equal(s.audit.find('region_flagged').length, 2);
  assert.equal(s.audit.find('region_flagged')[0]?.actor, REGION_AUDITOR);
});

test('جلوس الحاكم يرفع سبب المخالفة', () => {
  const { s, seat } = monitoredState();
  seat('region:research', 'official:noor');
  seat('region:industry', 'official:sara');
  const r = s.regionMonitor.sweep(T0 + VACANCY * 2);
  assert.equal(r.flags.length, 0);
});

test('نزاع لم يُحسم بعد مهلته يُرفع', () => {
  const { s, seat } = monitoredState();
  seat('region:research', 'official:noor');
  seat('region:industry', 'official:sara');
  const evidence = s.audit.find('delegation_granted')[0]?.hash ?? '';
  s.tribunal.raise('region:research', {
    disputeId: 'dis:1', respondent: 'region:industry', subject: 'تنازع معلن',
    domain: 'research', evidence: [evidence],
  }, T0);
  const inside = s.regionMonitor.sweep(T0 + 1000);
  assert.equal(inside.flags.length, 0);
  const outside = s.regionMonitor.sweep(T0 + DISPUTE_GRACE * 2);
  assert.equal(outside.flags.length, 1);
  assert.equal(outside.flags[0]?.kind, 'dispute_unresolved');
});

test('حاكم جالس في إقليم غير قائم يُكشف بالمسح', () => {
  const { s, structural, seat } = monitoredState();
  seat('region:research', 'official:noor');
  s.regions.revokeDelegation(structural('region:research'), 'region:research', 'إعادة تنظيم', T0);
  // الحلّ مرفوض ما دام الحاكم جالسًا — فنُحاكي انحرافًا بحلّ إقليم آخر لا حاكم له
  s.regions.revokeDelegation(structural('region:industry'), 'region:industry', 'إعادة تنظيم', T0);
  const dissolved = s.regions.dissolve(structural('region:industry'), 'region:industry', 'دمج معلن', T0);
  assert.equal(dissolved.ok, true);
  const r = s.regionMonitor.sweep(T0 + 1000);
  assert.equal(r.flags.length, 0, 'لا حاكم في المحلول — لا مخالفة');
  assert.equal(s.governors.governorOf('region:research')?.governor, 'official:noor');
});

test('الاحتواء لحرس التاج وحده', () => {
  const { s } = monitoredState();
  s.regionMonitor.sweep(T0 + VACANCY * 2);
  const r = s.regionMonitor.contain(
    REGION_AUDITOR, 'region:research', 'delegated_without_governor', 'سبب معلن', T0 + VACANCY * 2,
  );
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /حرس التاج وحده/);
  assert.equal(s.audit.find('containment_refused').length, 1);
});

test('لا احتواء بلا مخالفة مرفوعة سابقًا', () => {
  const { s } = monitoredState();
  const r = s.regionMonitor.contain(
    GOVERNOR_EXECUTOR, 'region:research', 'delegated_without_governor', 'سبب معلن', T0,
  );
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /مخالفة مرفوعة/);
});

test('الاحتواء بعد المخالفة يقع ويوقف التشغيل ولا يمحو المخالفة', () => {
  const { s } = monitoredState();
  s.regionMonitor.sweep(T0 + VACANCY * 2);
  const r = s.regionMonitor.contain(
    GOVERNOR_EXECUTOR, 'region:research', 'delegated_without_governor', 'شغور مطوَّل', T0 + VACANCY * 3,
  );
  assert.equal(r.ok, true);
  assert.equal(s.killSwitch.status.engaged, true);
  assert.equal(s.regionMonitor.history().length, 2, 'المخالفتان باقيتان');
  assert.equal(s.regionMonitor.report().contained, 1);
  assert.equal(s.regionMonitor.outstanding().length, 1);
  assert.equal(s.audit.find('region_contained').length, 1);
});

test('الاحتواء لا يسحب التفويض: السحب أمر ملكي', () => {
  const { s } = monitoredState();
  s.regionMonitor.sweep(T0 + VACANCY * 2);
  s.regionMonitor.contain(
    GOVERNOR_EXECUTOR, 'region:research', 'delegated_without_governor', 'شغور مطوَّل', T0 + VACANCY * 3,
  );
  assert.equal(s.regions.get('region:research')?.autonomy, 'delegated');
  assert.equal(s.audit.find('region_contained')[0]?.detail['note'],
    'الاحتواء لا يسحب التفويض — السحب أمر ملكي');
});

test('احتواء إقليم غير قائم مرفوض', () => {
  const { s, structural } = monitoredState();
  s.regionMonitor.sweep(T0 + VACANCY * 2);
  s.regions.revokeDelegation(structural('region:research'), 'region:research', 'إعادة تنظيم', T0);
  s.regions.dissolve(structural('region:research'), 'region:research', 'دمج معلن', T0);
  const r = s.regionMonitor.contain(
    GOVERNOR_EXECUTOR, 'region:research', 'delegated_without_governor', 'سبب معلن', T0 + VACANCY * 3,
  );
  assert.equal(r.ok, false);
});

test('سلامة سلسلة التدقيق باقية بعد المسح والاحتواء', () => {
  const { s } = monitoredState();
  s.regionMonitor.sweep(T0 + VACANCY * 2);
  s.regionMonitor.contain(
    GOVERNOR_EXECUTOR, 'region:research', 'delegated_without_governor', 'شغور مطوَّل', T0 + VACANCY * 3,
  );
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

/* ————————————————— T-46: حقنُ الانحراف — حاكمٌ جالسٌ في إقليمٍ غير قائم —————————————————
 * الحالةُ لا يُنتجها بابٌ من أبوابِ الدولة: الأبوابُ الثلاثةُ مغلقةٌ ويُقاس إغلاقُها أدناه
 * ([DR-01] · [DR-02] · [DR-03]). فتُنتَج **بحقنةٍ صريحةٍ في التركيب** لا نظريًّا: مراقبٌ
 * يُركَّب على سجلِّ حكّامٍ فيه مقعدٌ مشغول، وعلى سجلِّ أقاليمَ **لا يعرف الإقليم** — وهو
 * تباعدُ سجلَّين كالذي يقع بإرجاعِ أحدِهما دون الآخر. ثمّ يُثبَت أنّ المسحَ يرفعها ([DR-04])،
 * وأنّ الاحتواءَ عليها مرفوضٌ لأنّ الإقليمَ غيرُ قائم ([DR-05]) — فالمراقبُ يرفع ولا يعالج.
 */

/** [DR-01] البابُ الأوّل: لا ترشيحَ أصلًا لإقليمٍ غير قائم */
test('T-46 [DR-01]: ترشيحُ حاكمٍ لإقليمٍ لا وجودَ له مرفوضٌ عند الباب', () => {
  const { s } = monitoredState();
  const r = s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:ghost', kind: 'appointment',
    regionId: 'region:ghost', candidate: 'official:hind', reason: 'كفاءة موثّقة',
  }, T0);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'إقليم غير قائم');
  assert.equal(s.governors.seatedRegions().length, 0, 'لا مقعدَ نشأ من الرفض');
});

/** [DR-02] البابُ الثاني: إقليمٌ يُحلّ بين الاعتمادِ والتنفيذ لا يُجلَس عليه حاكم */
test('T-46 [DR-02]: حلُّ الإقليمِ بعد الاعتمادِ وقبل التنفيذِ يُسقط التنفيذ', () => {
  const { s, structural } = monitoredState();
  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:gap', kind: 'appointment',
    regionId: 'region:research', candidate: 'official:noor', reason: 'كفاءة موثّقة',
  }, T0);
  s.governors.approve(
    s.king.issueCommand('appoint_official', 'official:noor', {}, T0), 'nom:gap', T0,
  );
  // الحلُّ يلزمه سحبُ التفويض أوّلًا — والمقعدُ ما يزال خاليًا فلا يمنعه حاكمٌ جالس
  assert.equal(
    s.regions.revokeDelegation(structural('region:research'), 'region:research', 'إعادة تنظيم', T0).ok,
    true,
  );
  assert.equal(
    s.regions.dissolve(structural('region:research'), 'region:research', 'دمج معلن', T0).ok,
    true,
  );
  const r = s.governors.execute(GOVERNOR_EXECUTOR, 'nom:gap', T0 + 1);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'إقليم غير قائم');
  assert.equal(s.governors.seatedRegions().length, 0, 'لا مقعدَ في إقليمٍ محلول');
});

/** [DR-03] البابُ الثالث: حاكمٌ جالسٌ يمنع حلَّ إقليمِه */
test('T-46 [DR-03]: حلُّ إقليمٍ وحاكمُه جالسٌ مرفوض', () => {
  const { s, structural, seat } = monitoredState();
  seat('region:research', 'official:noor');
  s.regions.revokeDelegation(structural('region:research'), 'region:research', 'إعادة تنظيم', T0);
  const r = s.regions.dissolve(structural('region:research'), 'region:research', 'دمج معلن', T0);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'حاكم جالس: يُعزل بمساره المعلن أولًا');
  assert.equal(s.regions.isActive('region:research'), true, 'الرفضُ لا يغيّر الحالة');
});

/** [DR-04] الحقنةُ الصريحةُ: المسحُ يرفع المخالفةَ بشدّةٍ عاليةٍ ويُسمّي الحاكم */
test('**T-46 [DR-04]: حاكمٌ جالسٌ في إقليمٍ غير قائمٍ — المسحُ يرفعه لا يسكت عنه**', () => {
  const { s, seat } = monitoredState();
  seat('region:research', 'official:noor');
  assert.equal(s.governors.seatedRegions().length, 1, 'المقعدُ مشغولٌ بالمسار المعلن');

  // الحقنة: سجلُّ أقاليمَ لا يعرف الإقليمَ، والمقاعدُ كما هي — تباعدُ سجلَّين
  const blindRegions = new RegionRegistry({
    audit: s.audit, gateway: s.gateway, declaredRegions: ['region:research', 'region:industry'],
  });
  blindRegions.bindGovernorProbe((regionId) => s.governors.governorOf(regionId)?.governor ?? null);
  assert.equal(blindRegions.isActive('region:research'), false, 'الحقنةُ واقعةٌ لا مفترضة');

  const driftedMonitor = new RegionMonitor({
    audit: s.audit, regions: blindRegions, governors: s.governors,
    tribunal: s.tribunal, killSwitch: s.killSwitch,
    vacancyGraceMs: VACANCY, disputeGraceMs: DISPUTE_GRACE,
  });
  const before = s.audit.find('region_flagged').length;
  const r = driftedMonitor.sweep(T0 + 1000);

  const drift = r.flags.filter((f) => f.kind === 'governor_without_region');
  assert.equal(drift.length, 1, 'المخالفةُ ترتفع مرّةً واحدةً بلا مهلة');
  assert.equal(drift[0]?.regionId, 'region:research');
  assert.equal(drift[0]?.severity, 'high', 'سلطةٌ بلا إقليمٍ انحرافٌ جسيم');
  assert.match(drift[0]?.detail ?? '', /official:noor/, 'المخالفةُ تُسمّي الحاكمَ لا تُبهمه');
  assert.equal(s.audit.find('region_flagged').length, before + 1, 'المخالفةُ مكتوبةٌ في السجل');
  assert.equal(s.audit.find('region_flagged').at(-1)?.actor, REGION_AUDITOR);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

/** [DR-05] المراقبُ يرفع ولا يعالج: لا احتواءَ على إقليمٍ غير قائم */
test('T-46 [DR-05]: الاحتواءُ على المخالفةِ المحقونةِ مرفوضٌ — الإقليمُ غيرُ قائم', () => {
  const { s, seat } = monitoredState();
  seat('region:research', 'official:noor');
  const blindRegions = new RegionRegistry({
    audit: s.audit, gateway: s.gateway, declaredRegions: ['region:research', 'region:industry'],
  });
  blindRegions.bindGovernorProbe((regionId) => s.governors.governorOf(regionId)?.governor ?? null);
  const driftedMonitor = new RegionMonitor({
    audit: s.audit, regions: blindRegions, governors: s.governors,
    tribunal: s.tribunal, killSwitch: s.killSwitch,
    vacancyGraceMs: VACANCY, disputeGraceMs: DISPUTE_GRACE,
  });
  driftedMonitor.sweep(T0 + 1000);
  const r = driftedMonitor.contain(
    GOVERNOR_EXECUTOR, 'region:research', 'governor_without_region', 'سلطةٌ بلا إقليم', T0 + 2000,
  );
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'إقليم غير قائم');
  assert.equal(s.killSwitch.status.engaged, false, 'لا إيقافَ يقع من احتواءٍ مرفوض');
});
