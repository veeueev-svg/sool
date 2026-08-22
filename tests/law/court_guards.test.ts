/**
 * tests/law/court_guards.test.ts — حرَس مداخل الدعوى (المرحلة 39، البند T-114)
 * المالك: وزارة العدل
 * المدخلات: دولةٌ مبنيّة بـ`bootstrapState` — السطحُ العام وحده كما يراه أي مُنادٍ خارجي
 * المخرجات: تأكيدٌ أن `markEnforced` و`markAppealPending` يرفضان النداء غير المشروع
 * التبعيات: `src/index` · `src/law/case_guards` (الحرَس مباشرةً بلا دولة)
 * الصلاحيات (RULE-004): اختبارٌ يقرأ ولا يعدّل تهيئةً ولا يُخفّف شرطًا
 * السجلات: يتحقّق أن كل رفضٍ مُقيَّد في السلسلة (`enforcement_refused` / `appeal_refused`)
 * حالات الفشل المُغطّاة: جهة غير مخوَّلة · لا حكم · غير مُدان · طعن قائم · قبل النهائية ·
 *   تنفيذٌ مرتين · معرّف طعنٍ مُلفَّق · جهةٌ لا مصلحة لها في الطعن
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md · docs/audit/criteria/C-14.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **يسقط قبل الإصلاح ويمرّ بعده.** كُتب من نصّ الفجوة التي كشفها قياسُ التدقيق
 *    (الفحص C-14ب في المرحلة 38): إعلانُ التنفيذ كان يُنتزَع بنداءٍ مباشر من كيانٍ ليس
 *    جهةَ تنفيذ ولدعوى لم يُحكم فيها.
 *
 * 2) **لا يُنادى إلا السطحُ العام** كما يناديه الغريب — فلو رُدّت الحواجزُ إلى مسار
 *    `Enforcement.execute` وحده لسقط هذا الملف.
 *
 * 3) **الرفضُ يُقاس بأثره لا بنصّه وحده**: حالُ الدعوى لا يتغيّر، والسجلُّ يحمل قيدَ الرفض.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, PUBLIC_DEFENDER } from '../../src/index';
import { guardAppealMark, guardEnforcementMark } from '../../src/law/case_guards';
import { ENFORCEMENT_AUTHORITIES } from '../../src/law/authorities';

// الجهةُ المستعملة هنا هي عينُ الجهة المعلنة — لا قائمةً تخصّ الاختبار

const T0 = Date.now(); // كتهيئة بقية اختبارات العدل: الشهادة الملكية تنتهي بمدة، فلا وقتٌ مُختلق
const HOUR = 3_600_000;
const ENFORCER = 'authority:crown_guard';
const PROSECUTOR = 'authority:audit_bureau';
const JUDGE = 'court:first_instance';

/** يبني دعوى بحكمٍ صادر (status = ruled) على وكيلٍ قائم */
function caseWithRuling(): ReturnType<typeof bootstrapState> {
  const s = bootstrapState({ now: T0, justice: { defenseWindowMs: 4 * HOUR, appealWindowMs: 8 * HOUR } });
  const create = s.king.issueCommand('create_agent', 'agent:g1', { role: 'agent' }, T0);
  assert.equal(s.agents.create(create, {
    agentId: 'agent:g1', template: 'limited_worker', supervisor: 'ministry:interior',
  }).ok, true);
  assert.equal(s.agents.start('agent:g1', 'ministry:interior', T0).ok, true);

  const amend = s.king.issueCommand('amend_policy', 'statute:g1', {}, T0);
  assert.equal(s.law.enact(amend, {
    statuteId: 'statute:g1',
    title: 'الخروج إلى مضيف غير معلن',
    text: 'يُمنع على الوكيل الاتصال بمضيف خارج قائمته المعلنة.',
    severity: 'major',
    penalties: ['suspension'],
    appliesTo: ['agent:'],
    proposedBy: 'ministry:justice',
    effectiveFrom: T0,
  }, T0).ok, true);

  const snap = s.audit.snapshot();
  const evidence = snap[snap.length - 1]!;
  const charged = s.court.charge(PROSECUTOR, {
    caseId: 'case:g1',
    statuteId: 'statute:g1',
    defendant: 'agent:g1',
    chargeText: 'خروجٌ غير معلن',
    evidence: [evidence.hash],
    occurredAt: T0 + 1000,
  }, T0 + 60_000);
  assert.equal(charged.ok, true);
  assert.equal(
    s.court.submitDefense('case:g1', 'agent:g1', 'إنكار', [], T0 + 120_000).ok, true,
  );
  const ruled = s.court.rule('case:g1', JUDGE, {
    guilty: true, penalty: 'suspension', reason: 'ثبت الخروج',
  }, T0 + 180_000);
  assert.equal(ruled.ok, true);
  return s;
}

test('T-114: إعلان التنفيذ لا يُنتزع من غير جهة التنفيذ ولا قبل النهائية', () => {
  assert.deepEqual([...ENFORCEMENT_AUTHORITIES], [ENFORCER], 'الاختبار يقيس القائمة المعلنة');
  const s = caseWithRuling();
  const before = s.court.get('case:g1');
  assert.equal(before?.status, 'ruled');

  // 1) كيانٌ ليس جهة تنفيذ — وهو عين ما نجح قبل الإصلاح
  const rogue = s.court.markEnforced('case:g1', 'agent:rogue', T0 + 5 * HOUR);
  assert.equal(rogue.ok, false);
  assert.equal(rogue.ok === false && rogue.reason, 'جهة غير مخوَّلة بالتنفيذ');
  assert.equal(s.court.get('case:g1')?.status, 'ruled', 'حالُ الدعوى لا يتغيّر بالرفض');

  // 2) جهة التنفيذ نفسها لا تُعلن قبل تثبيت النهائية
  const early = s.court.markEnforced('case:g1', ENFORCER, T0 + 5 * HOUR);
  assert.equal(early.ok, false);
  assert.equal(early.ok === false && early.reason, 'لا تنفيذ قبل نهائية الحكم');

  // 3) القاضي والمدّعي لا ينفّذان (RULE-004) — ولو كانا في قائمةٍ ما
  assert.equal(s.court.markEnforced('case:g1', JUDGE, T0 + 5 * HOUR).ok, false);
  assert.equal(s.court.markEnforced('case:g1', PROSECUTOR, T0 + 5 * HOUR).ok, false);

  // 4) كل رفضٍ مُقيَّد في السلسلة، والسلسلة سليمة
  const refusals = s.audit.find('enforcement_refused')
    .filter((e) => e.detail.caseId === 'case:g1');
  assert.ok(refusals.length >= 4, 'كل نداءٍ مرفوض له قيدٌ في السجل');
  assert.equal(s.audit.verifyIntegrity().valid, true);

  // 5) دعوى غير موجودة تُرفض ولا تُنشأ
  const ghost = s.court.markEnforced('case:none', ENFORCER, T0 + 5 * HOUR);
  assert.equal(ghost.ok, false);
  assert.equal(ghost.ok === false && ghost.reason, 'دعوى غير موجودة');
  assert.equal(s.court.get('case:none'), undefined);
});

test('T-114: الطريق الصحيح يبقى مفتوحًا — التنفيذ بعد النهائية يُعلَن مرة واحدة', () => {
  const s = caseWithRuling();
  const after = T0 + 9 * HOUR; // بعد انقضاء مدة الطعن (8 ساعات)
  const done = s.enforcement.execute('case:g1', ENFORCER, {}, after);
  assert.equal(done.ok, true, 'الحرَس لا يسدّ الطريق المشروع');
  assert.equal(s.court.get('case:g1')?.status, 'enforced');
  assert.equal(s.agents.get('agent:g1')?.status, 'suspended', 'العقوبة أثرٌ لا إعلان');

  // إعلانٌ ثانٍ مرفوض، والحالُ لا يتبدّل
  const again = s.court.markEnforced('case:g1', ENFORCER, after + HOUR);
  assert.equal(again.ok, false);
  assert.equal(again.ok === false && again.reason, 'الحكم نُفِّذ سابقًا');
  assert.equal(s.court.get('case:g1')?.enforcedBy, ENFORCER);
});

test('T-114: تعليق التنفيذ لطعن محروسٌ في المدخل', () => {
  const s = caseWithRuling();

  // 1) كيانٌ لا مصلحة له لا يُعلّق التنفيذ
  const rogue = s.court.markAppealPending('case:g1', 'agent:rogue', 'appeal:case:g1:1', T0 + 5 * HOUR);
  assert.equal(rogue.ok, false);
  assert.equal(rogue.ok === false && rogue.reason, 'جهة لا مصلحة لها في الطعن');
  assert.equal(s.court.get('case:g1')?.appealPending, false);

  // 2) معرّفٌ لا يخصّ الدعوى مرفوض ولو كان المُنادي ذا مصلحة
  const forged = s.court.markAppealPending('case:g1', 'agent:g1', 'appeal:case:other:9', T0 + 5 * HOUR);
  assert.equal(forged.ok, false);
  assert.equal(forged.ok === false && forged.reason, 'معرّف طعن لا يخصّ هذه الدعوى');

  // 3) الطعن من طريقه يمرّ، ثم لا يُعلَّق مرتين
  const filed = s.appeals.file('case:g1', 'agent:g1', 'الحكم بلا سند كافٍ', T0 + 5 * HOUR);
  assert.equal(filed.ok, true);
  assert.equal(s.court.get('case:g1')?.appealPending, true);
  const twice = s.court.markAppealPending('case:g1', PUBLIC_DEFENDER, 'appeal:case:g1:2', T0 + 6 * HOUR);
  assert.equal(twice.ok, false);
  assert.equal(twice.ok === false && twice.reason, 'طعن قائم أصلًا');

  // 4) وطعنٌ قائم يمنع إعلان التنفيذ من جهته المخوَّلة
  const blocked = s.court.markEnforced('case:g1', ENFORCER, T0 + 6 * HOUR);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok === false && blocked.reason, 'طعن قائم — التنفيذ موقوف حتى الفصل');
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('T-114: الحرَس دالّةٌ نقيّة تُختبر وحدها بلا دولة', () => {
  const base = {
    caseId: 'case:x',
    defendant: 'agent:x',
    prosecutor: PROSECUTOR,
    ruling: { judge: JUDGE, guilty: true },
    appeal: null,
    appealPending: false,
    status: 'final',
  };
  assert.equal(guardEnforcementMark(base, ENFORCER), null, 'الحالة المشروعة تمرّ');
  assert.equal(guardEnforcementMark(undefined, ENFORCER), 'دعوى غير موجودة');
  assert.equal(guardEnforcementMark(base, 'agent:rogue'), 'جهة غير مخوَّلة بالتنفيذ');
  assert.equal(
    guardEnforcementMark({ ...base, ruling: null }, ENFORCER), 'لا تنفيذ بلا حكم',
  );
  assert.equal(
    guardEnforcementMark({ ...base, ruling: { judge: JUDGE, guilty: false } }, ENFORCER),
    'لا تنفيذ على غير مُدان — الحكم بالبراءة أو نُقض',
  );
  assert.equal(
    guardEnforcementMark({ ...base, status: 'ruled' }, ENFORCER), 'لا تنفيذ قبل نهائية الحكم',
  );
  assert.equal(
    guardEnforcementMark({ ...base, status: 'enforced' }, ENFORCER), 'الحكم نُفِّذ سابقًا',
  );
  assert.equal(
    guardEnforcementMark({ ...base, appealPending: true }, ENFORCER),
    'طعن قائم — التنفيذ موقوف حتى الفصل',
  );

  // ولا يُمرَّر الحرَسُ بقائمةِ جهاتٍ يختارها المُنادي لنفسه في مسار الدولة:
  // القائمةُ المعلنة هي الافتراض، والتمرير للاختبار والتهيئة فقط
  assert.equal(guardEnforcementMark(base, 'authority:other', ['authority:other']), null);

  const appealBase = { ...base, status: 'ruled' };
  assert.equal(guardAppealMark(appealBase, 'agent:x', 'appeal:case:x:1', PUBLIC_DEFENDER), null);
  assert.equal(
    guardAppealMark(appealBase, PUBLIC_DEFENDER, 'appeal:case:x:1', PUBLIC_DEFENDER), null,
  );
  assert.equal(
    guardAppealMark({ ...appealBase, ruling: null }, 'agent:x', 'appeal:case:x:1', PUBLIC_DEFENDER),
    'لا طعن على دعوى بلا حكم',
  );
  assert.equal(
    guardAppealMark({ ...appealBase, status: 'enforced' }, 'agent:x', 'appeal:case:x:1', PUBLIC_DEFENDER),
    'الحكم نُفِّذ — لا تعليق بعد التنفيذ',
  );
  assert.equal(
    guardAppealMark({ ...appealBase, appeal: { verdict: 'upheld' } }, 'agent:x', 'appeal:case:x:1', PUBLIC_DEFENDER),
    'فُصل في الطعن — لا يُعلَّق مرتين',
  );
});
