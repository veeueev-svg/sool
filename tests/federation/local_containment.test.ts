/**
 * tests/federation/local_containment.test.ts — احتواءُ إقليمٍ بعينه لا إيقافُ الوكلاء كلِّهم (T-44 · W-2026-056)
 * المالك: حرس التاج | يوثّق في: docs/test-reports/phase-40-W-2026-056.md
 * يثبت: احتواءُ الإقليم يرفض أفعالَ حاكمه عند الباب ولا يمسّ الإقليمَ السليم ولا يشغّل القاطعَ العامّ؛
 *       ورفعُه لحرس التاج وحده وبسبب، ويُعيد الفعل؛ ومصدرُ الاحتواء لا يُربط مرّتين.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, GOVERNOR_EXECUTOR, GOVERNOR_PROPOSER, ROYAL_COURT } from '../../src/index';

const T0 = Date.now();
const VACANCY = 10_000;

function twoRegions() {
  const s = bootstrapState({ now: T0, federation: { vacancyGraceMs: VACANCY } });
  const structural = (target: string) => s.king.issueCommand('amend_policy', target, { kind: 'federation' }, T0);
  for (const [regionId, name, domain] of [['region:research', 'إقليم البحث', 'research'], ['region:industry', 'إقليم الصناعة', 'manufacturing']] as const) {
    s.regions.establish(structural(regionId), { regionId, name, proposedBy: ROYAL_COURT }, T0);
    s.regions.delegate(structural(regionId), regionId, [domain], T0);
  }
  s.regionMonitor.sweep(T0 + VACANCY * 2); // شغورٌ مطوَّل ⇒ مخالفتان
  const at = T0 + VACANCY * 2 + 1;
  for (const [regionId, candidate] of [['region:research', 'official:noor'], ['region:industry', 'official:sara']] as const) {
    const nominationId = `nom:${regionId}`;
    s.governors.propose(GOVERNOR_PROPOSER, { nominationId, kind: 'appointment', regionId, candidate, reason: 'كفاءة موثّقة' }, at);
    s.governors.approve(s.king.issueCommand('appoint_official', candidate, {}, at), nominationId, at);
    s.governors.execute(GOVERNOR_EXECUTOR, nominationId, at);
  }
  return { s, at };
}

test('T-44: الإقليمُ المحتوى وحده يُوقَف — والسليمُ يعمل، والقاطعُ العامّ لا يُشغَّل', () => {
  const { s, at } = twoRegions();
  const act = (gov: string, regionId: string, domain: string) =>
    s.governors.act(gov, { regionId, domain, action: 'فعلٌ إقليميٌّ معلن' }, at + 10);
  assert.equal(act('official:noor', 'region:research', 'research').ok, true, 'قبل الاحتواء يعمل');
  assert.equal(s.regionMonitor.contain(GOVERNOR_EXECUTOR, 'region:research', 'delegated_without_governor', 'شغورٌ مطوَّل', at + 5).ok, true);

  const blocked = act('official:noor', 'region:research', 'research');
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /محتوًى/);
  assert.equal(act('official:sara', 'region:industry', 'manufacturing').ok, true, 'الإقليمُ السليمُ لا يُوقَف معه');
  assert.equal(s.killSwitch.status.engaged, false);
  assert.equal(s.audit.find('region_contained').at(-1)?.detail['scope'], 'region');
});

test('T-44: رفعُ الاحتواء لحرس التاج وحده وبسبب — ثمّ يعود الفعل، والمخالفةُ باقية', () => {
  const { s, at } = twoRegions();
  s.regionMonitor.contain(GOVERNOR_EXECUTOR, 'region:research', 'delegated_without_governor', 'شغورٌ مطوَّل', at + 5);
  assert.equal(s.regionMonitor.release('official:noor', 'region:research', 'أرفع عن نفسي', at + 6).ok, false);
  assert.equal(s.regionMonitor.release(GOVERNOR_EXECUTOR, 'region:research', '', at + 6).ok, false);
  assert.equal(s.regionMonitor.release(GOVERNOR_EXECUTOR, 'region:industry', 'ليس محتوًى', at + 6).ok, false);
  assert.equal(s.regionMonitor.release(GOVERNOR_EXECUTOR, 'region:research', 'جلس الحاكم وزال السبب', at + 7).ok, true);
  assert.equal(s.regionMonitor.isContained('region:research'), false);
  assert.equal(s.governors.act('official:noor', { regionId: 'region:research', domain: 'research', action: 'فعلٌ بعد الرفع' }, at + 8).ok, true);
  assert.equal(s.regionMonitor.report().contained, 1, 'أثرُ الاحتواء باقٍ في التاريخ');
  assert.equal(s.audit.find('region_released').length, 1);
  assert.throws(() => s.governors.bindContainment(() => false), /مربوطٌ سابقًا/);
});
