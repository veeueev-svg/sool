/**
 * tests/federation/regions.test.ts — اختبار سجل الأقاليم (المرحلة 24)
 * المالك: مجلس الأقاليم | يوثّق في: docs/test-reports/phase-24.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, CROWN_RESERVED_DOMAINS, REGIONS_COUNCIL, ROYAL_COURT } from '../../src/index';

const T0 = Date.now();

function regionState() {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'federation' }, at);
  const establish = (regionId: string, name: string, at = T0) =>
    s.regions.establish(structural(regionId, at), { regionId, name, proposedBy: ROYAL_COURT }, at);
  return { s, structural, establish };
}

test('الأقاليم المعلنة في التهيئة تُقرأ ولا تُخفى في الكود', () => {
  const { s } = regionState();
  assert.equal(s.regions.report().declared, 4);
  assert.equal(s.regions.report().active, 0, 'الإعلان ليس تأسيسًا (RULE-001)');
});

test('التأسيس بأمر ملكي معتمد ينشئ إقليمًا محدود الاستقلال', () => {
  const { s, establish } = regionState();
  const r = establish('region:core', 'إقليم النواة');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.region.autonomy, 'limited');
  assert.equal(r.ok && r.region.domains.length, 0, 'لا نطاق قبل التفويض');
  assert.equal(s.audit.find('region_established').length, 1);
});

test('إقليم غير معلن في التهيئة مرفوض', () => {
  const { s, establish } = regionState();
  const r = establish('region:shadow', 'إقليم الظل');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /غير معلن/);
  assert.equal(s.regions.isActive('region:shadow'), false);
});

test('معرّف لا يبدأ بـ region: مرفوض', () => {
  const { establish } = regionState();
  assert.equal(establish('core', 'نواة').ok, false);
});

test('الإقليم لا يقترح تأسيس نفسه', () => {
  const { s, structural } = regionState();
  const r = s.regions.establish(structural('region:core'), {
    regionId: 'region:core', name: 'إقليم النواة', proposedBy: 'region:core',
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /RULE-005/);
});

test('أمر بفعل غير amend_policy لا يؤسّس إقليمًا', () => {
  const { s } = regionState();
  const wrong = s.king.issueCommand('appoint_official', 'region:core', {}, T0);
  const r = s.regions.establish(wrong, {
    regionId: 'region:core', name: 'إقليم النواة', proposedBy: ROYAL_COURT,
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /amend_policy/);
});

test('أمر موجَّه إلى غير الإقليم مرفوض', () => {
  const { s, structural } = regionState();
  const r = s.regions.establish(structural('region:research'), {
    regionId: 'region:core', name: 'إقليم النواة', proposedBy: ROYAL_COURT,
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /هدف الأمر/);
});

test('تأسيس إقليم قائم مرفوض', () => {
  const { establish } = regionState();
  establish('region:core', 'إقليم النواة');
  assert.equal(establish('region:core', 'إقليم النواة').ok, false);
});

test('التفويض يمنح نطاقات ويرفع الاستقلال إلى delegated', () => {
  const { s, structural, establish } = regionState();
  establish('region:research', 'إقليم البحث');
  const r = s.regions.delegate(structural('region:research'), 'region:research', ['research'], T0);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.region.autonomy, 'delegated');
  assert.equal(s.regions.hasDomain('region:research', 'research'), true);
  assert.equal(s.audit.find('delegation_granted').length, 1);
});

test('نطاق محفوظ للتاج لا يُفوَّض بحال', () => {
  const { s, structural, establish } = regionState();
  establish('region:core', 'إقليم النواة');
  for (const domain of CROWN_RESERVED_DOMAINS) {
    const r = s.regions.delegate(structural('region:core'), 'region:core', [domain], T0);
    assert.equal(r.ok, false, `النطاق ${domain} لا يجوز تفويضه`);
    assert.match(r.ok ? '' : r.reason, /محفوظ للتاج/);
  }
  assert.equal(s.regions.get('region:core')?.autonomy, 'limited');
});

test('لا نطاق بمالكين: التزاحم مرفوض', () => {
  const { s, structural, establish } = regionState();
  establish('region:research', 'إقليم البحث');
  establish('region:industry', 'إقليم الصناعة');
  s.regions.delegate(structural('region:research'), 'region:research', ['research'], T0);
  const clash = s.regions.delegate(structural('region:industry'), 'region:industry', ['research'], T0);
  assert.equal(clash.ok, false);
  assert.match(clash.ok ? '' : clash.reason, /تزاحم نطاق/);
  assert.equal(s.regions.competentFor('research')?.regionId, 'region:research');
});

test('تفويض بلا نطاق معلن مرفوض', () => {
  const { s, structural, establish } = regionState();
  establish('region:core', 'إقليم النواة');
  assert.equal(s.regions.delegate(structural('region:core'), 'region:core', [], T0).ok, false);
});

test('سحب التفويض يعيد الإقليم محدودًا ويفرّغ نطاقه', () => {
  const { s, structural, establish } = regionState();
  establish('region:services', 'إقليم الخدمات');
  s.regions.delegate(structural('region:services'), 'region:services', ['services'], T0);
  const r = s.regions.revokeDelegation(
    structural('region:services'), 'region:services', 'إعادة تنظيم', T0,
  );
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.region.autonomy, 'limited');
  assert.equal(s.regions.hasDomain('region:services', 'services'), false);
  assert.equal(s.regions.competentFor('services'), null);
  assert.equal(s.audit.find('delegation_revoked').length, 1);
});

test('سحب بلا تفويض قائم مرفوض، وسحب بلا سبب مرفوض', () => {
  const { s, structural, establish } = regionState();
  establish('region:core', 'إقليم النواة');
  assert.equal(s.regions.revokeDelegation(structural('region:core'), 'region:core', 'سبب', T0).ok, false);
  s.regions.delegate(structural('region:core'), 'region:core', ['compute'], T0);
  assert.equal(s.regions.revokeDelegation(structural('region:core'), 'region:core', '', T0).ok, false);
});

test('لا حلّ لإقليم وله تفويض قائم', () => {
  const { s, structural, establish } = regionState();
  establish('region:core', 'إقليم النواة');
  s.regions.delegate(structural('region:core'), 'region:core', ['compute'], T0);
  const r = s.regions.dissolve(structural('region:core'), 'region:core', 'دمج', T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /تفويض قائم/);
  assert.equal(s.regions.isActive('region:core'), true);
});

test('الحلّ يوقف الإقليم ولا يمحو تاريخه', () => {
  const { s, structural, establish } = regionState();
  establish('region:core', 'إقليم النواة');
  const r = s.regions.dissolve(structural('region:core'), 'region:core', 'دمج معلن', T0);
  assert.equal(r.ok, true);
  assert.equal(s.regions.isActive('region:core'), false);
  assert.equal(s.regions.get('region:core')?.dissolveReason, 'دمج معلن');
  assert.equal(s.audit.find('region_dissolved').length, 1);
});

test('الرفض يُسجَّل دائمًا: لا رفض صامت', () => {
  const { s, establish } = regionState();
  const before = s.audit.find('region_refused').length;
  establish('region:shadow', 'إقليم الظل');
  assert.equal(s.audit.find('region_refused').length, before + 1);
});

test('تقرير السجل يعدّ القائم والمفوَّض والمحلول', () => {
  const { s, structural, establish } = regionState();
  establish('region:core', 'إقليم النواة');
  establish('region:research', 'إقليم البحث');
  s.regions.delegate(structural('region:research'), 'region:research', ['research'], T0);
  s.regions.dissolve(structural('region:core'), 'region:core', 'دمج معلن', T0);
  const rep = s.regions.report();
  assert.equal(rep.total, 2);
  assert.equal(rep.active, 1);
  assert.equal(rep.dissolved, 1);
  assert.equal(rep.delegated, 1);
  assert.equal(rep.domains, 1);
});

test('مجلس الأقاليم هو الفاعل المسجَّل في قرارات السجل', () => {
  const { s, establish } = regionState();
  establish('region:core', 'إقليم النواة');
  const entry = s.audit.find('region_established')[0];
  assert.equal(entry?.actor, REGIONS_COUNCIL);
});
