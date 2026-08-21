/**
 * tests/federation/federation_lifecycle.test.ts — اختبار قبول المرحلة 24
 * معياري القبول في ROADMAP.md:
 *   1) اجتماع كل الأقاليم لا ينقض الملك — ولو بالإجماع الكامل
 *   2) فضّ نزاع إقليمي مسجَّل في سجل التدقيق
 * المالك: مجلس الأقاليم | يوثّق في: docs/test-reports/phase-24.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, GOVERNOR_EXECUTOR, GOVERNOR_PROPOSER, REGIONAL_ARBITER, REGIONS_COUNCIL,
  ROYAL_COURT, SovereignAction,
} from '../../src/index';

const T0 = Date.now();

/** اتحاد كامل: أربعة أقاليم معلنة، كلها قائمة، واثنان مفوَّضان بحاكمين */
function federation() {
  const s = bootstrapState({ now: T0, federation: { responseWindowMs: 5_000 } });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'federation' }, at);
  const declared: readonly [string, string][] = [
    ['region:core', 'إقليم النواة'],
    ['region:research', 'إقليم البحث'],
    ['region:industry', 'إقليم الصناعة'],
    ['region:services', 'إقليم الخدمات'],
  ];
  for (const [regionId, name] of declared) {
    const r = s.regions.establish(structural(regionId), { regionId, name, proposedBy: ROYAL_COURT }, T0);
    assert.equal(r.ok, true, `تأسيس ${regionId}`);
  }
  s.regions.delegate(structural('region:research'), 'region:research', ['research'], T0);
  s.regions.delegate(structural('region:industry'), 'region:industry', ['manufacturing'], T0);
  const seat = (regionId: string, candidate: string) => {
    const nominationId = `nom:${regionId}`;
    s.governors.propose(GOVERNOR_PROPOSER, {
      nominationId, kind: 'appointment', regionId, candidate, reason: 'كفاءة موثّقة',
    }, T0);
    s.governors.approve(s.king.issueCommand('appoint_official', candidate, {}, T0), nominationId, T0);
    assert.equal(s.governors.execute(GOVERNOR_EXECUTOR, nominationId, T0).ok, true);
  };
  seat('region:research', 'official:noor');
  seat('region:industry', 'official:sara');
  const allRegions = declared.map(([id]) => id);
  return { s, structural, allRegions };
}

test('قبول 1: اجتماع كل الأقاليم بالإجماع لا ينقض الملك — رفض مسجَّل', () => {
  const { s, allRegions } = federation();
  assert.equal(s.regions.active().length, 4);

  const sovereign: readonly SovereignAction[] = [
    'amend_policy', 'terminate_agent', 'declare_emergency', 'appoint_official', 'judicial_review',
  ];
  for (const action of sovereign) {
    const r = s.assembly.override(allRegions, action, T0);
    assert.equal(r.allowed, false, `${action} لا يُنتزع بالإجماع`);
  }
  const refusals = s.audit.find('assembly_override_refused');
  assert.equal(refusals.length, sovereign.length, 'كل محاولة مسجَّلة');
  const first = refusals[0];
  assert.equal(first?.detail['attending'], 4);
  assert.equal(first?.detail['totalActive'], 4);
  assert.equal(first?.detail['unanimous'], true, 'الإجماع الكامل مسجَّل — ومع ذلك مرفوض');
  // البوابة سجّلت المحاولة أيضًا باسم الأقاليم مجتمعةً
  assert.equal(s.audit.find('collective_override_rejected').length, sovereign.length);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('قبول 1 (تكملة): أقصى ما تستطيعه الأقاليم مجتمعةً التماسٌ لا أثر له إلا بأمر ملكي', () => {
  const { s, allRegions } = federation();
  const p = s.assembly.petition(allRegions, {
    petitionId: 'pet:1', subject: 'توسيع نطاق البحث ليشمل الصناعة',
  }, T0);
  assert.equal(p.ok, true);
  assert.equal(p.ok && p.petition.unanimous, true);
  assert.equal(p.ok && p.petition.status, 'pending');
  // لا أثر: النطاقات لم تتغيّر بمجرّد الالتماس
  assert.equal(s.regions.competentFor('manufacturing')?.regionId, 'region:industry');
  assert.equal(s.audit.find('assembly_petitioned')[0]?.detail['effect'], 'لا أثر حتى أمر ملكي');

  const answer = s.assembly.answer(
    s.king.issueCommand('amend_policy', REGIONS_COUNCIL, {}, T0), 'pet:1', 'rejected', T0,
  );
  assert.equal(answer.ok, true);
  assert.equal(s.assembly.getPetition('pet:1')?.status, 'rejected');
  assert.equal(s.audit.find('petition_answered').length, 1);
  assert.equal(s.assembly.report().pending, 0);
});

test('قبول 2: فضّ نزاع إقليمي مسجَّل من رفع الدعوى إلى الحكم الملكي', () => {
  const { s } = federation();
  const evidence = s.audit.find('region_action_executed')[0]?.hash
    ?? s.audit.find('delegation_granted')[0]?.hash ?? '';

  const raised = s.tribunal.raise('region:research', {
    disputeId: 'dis:federal', respondent: 'region:industry',
    subject: 'تنازع على مخرجات مخبر مشترك', domain: 'research', evidence: [evidence],
  }, T0);
  assert.equal(raised.ok, true);
  s.tribunal.respond('region:industry', 'dis:federal', 'المخرجات صناعية بحكم التفويض', T0 + 100);
  const resolved = s.tribunal.resolve(REGIONAL_ARBITER, 'dis:federal', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'النطاق نصّ التفويض ولا يُنقل بحكم',
  }, T0 + 200);
  assert.equal(resolved.ok, true);
  s.tribunal.escalate('region:industry', 'dis:federal', 'تسبيب ناقص', T0 + 300);
  const royal = s.tribunal.royalSettlement(
    s.king.issueCommand('judicial_review', 'region:research', {}, T0 + 400),
    'dis:federal', 'region:research', T0 + 400,
  );
  assert.equal(royal.ok, true);

  // كل مرحلة لها سجل: لا نزاع يُطوى بلا أثر (RULE-006)
  for (const kind of [
    'dispute_raised', 'dispute_answered', 'dispute_resolved', 'dispute_escalated', 'royal_settlement',
  ]) {
    assert.equal(s.audit.find(kind).length, 1, `سجل مفقود: ${kind}`);
  }
  assert.equal(s.tribunal.dispute('dis:federal')?.status, 'royal_settled');
  assert.equal(s.tribunal.open().length, 0);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('دورة حياة كاملة: تأسيس ← تفويض ← حاكم ← فعل ← سحب ← عزل ← حلّ', () => {
  const { s, structural } = federation();
  // فعل داخل النطاق يقع
  assert.equal(s.governors.act('official:noor', {
    regionId: 'region:research', domain: 'research', action: 'تشغيل مخبر بحثي',
  }, T0).ok, true);
  // سحب التفويض يُسكت الحاكم
  s.regions.revokeDelegation(structural('region:research'), 'region:research', 'إعادة تنظيم', T0);
  assert.equal(s.governors.act('official:noor', {
    regionId: 'region:research', domain: 'research', action: 'تشغيل مخبر بحثي',
  }, T0).ok, false);
  // الحلّ مرفوض قبل العزل
  assert.equal(s.regions.dissolve(structural('region:research'), 'region:research', 'دمج معلن', T0).ok,
    false);
  // العزل بالمسار الثلاثي
  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:recall', kind: 'recall', regionId: 'region:research',
    candidate: 'official:noor', reason: 'انتهاء الحاجة',
  }, T0);
  s.governors.approve(
    s.king.issueCommand('appoint_official', 'official:noor', {}, T0), 'nom:recall', T0,
  );
  assert.equal(s.governors.execute(GOVERNOR_EXECUTOR, 'nom:recall', T0).ok, true);
  // ثم الحلّ يقع
  assert.equal(s.regions.dissolve(structural('region:research'), 'region:research', 'دمج معلن', T0).ok,
    true);
  assert.equal(s.regions.active().length, 3);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('الاتحاد لا يعمل بلا تاج حاضر: الأوامر تُرفض في وضع الحماية', () => {
  const s = bootstrapState({ now: T0 });
  const late = T0 + s.config.absence_grace_seconds * 1000 + 60_000;
  assert.equal(s.heartbeat.mode(late), 'protective');
  const r = s.regions.establish(
    s.king.issueCommand('amend_policy', 'region:core', {}, late),
    { regionId: 'region:core', name: 'إقليم النواة', proposedBy: ROYAL_COURT }, late,
  );
  assert.equal(r.ok, false, 'لا تأسيس إقليم بغياب التاج');
  assert.equal(s.regions.active().length, 0);
});
