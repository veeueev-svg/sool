/**
 * tests/data/rehydrate_governance.test.ts — قبولُ دوامِ الوزارات والتعيينات (المرحلة 39، البند T-126)
 * شرطُ القبول المعلن في PROGRESS.md: «سجلُّ الوزارات والتعيينات لا يُدوَّن — تُقاس الفجوة
 * أوّلًا ثم تُغلق بأبوابٍ ذرّيّة». والمقيسُ في docs/audit/measurements/phase-39-T126.txt أنّ
 * الفقدَ لم يكن نقصَ تقريرٍ بل **فَكَّ ثلاثةِ حرّاسٍ بإطفاءة**: قُبل جمعُ القضاءِ والادّعاءِ
 * في شخصٍ واحد، وحُلّت وزارةٌ ومنصبُها مشغولٌ في السجل الأبديّ، وسقط اعتمادٌ ملكيٌّ قائم.
 * وتاريخُ الحلّ يُمحى معها فتعود وزارةٌ محلولةٌ كأنّ حلَّها لم يكن. وهذا الملف يُثبت الإغلاق.
 * المالك: وزارة البيانات | المدخلات: تهيئةٌ مؤقتة ومجلدُ يوميّة | المخرجات: حكومةٌ تنجو أو رفض
 * التبعيات: bootstrapState — والبذرُ كلُّه بالأبواب المعلنة لا بحقلٍ خاص
 * الصلاحيات: الكتابة عبر الواجهات العامة وحدها
 * السجلات: ministries_restored · appointments_restored
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir ولا يكتب في المستودع
 * اختبارات الوحدة: tests/governance/appointments.test.ts | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/decisions/ADR-0032-governance-durability.md
 *
 * ثوابت هذا الاختبار:
 *   1) لا كتابة بحقلٍ خاص: كلُّ بذرةٍ تمرّ بالباب المعلن كما يمرّ به المشغّل.
 *   2) الإقلاعُ الثاني دولةٌ جديدةٌ بالكامل — لا كائنَ مشتركًا بين الإقلاعين.
 *   3) التأكيد على الأرقام والرموز لا على النصوص العربية المشكولة.
 *   4) **الحرَسُ هو المقيس لا العدد**: لا يكفي أن تعود وزارةٌ إلى الوجود؛ يجب أن يرفض
 *      البابُ بعد الإقلاع ما كان يرفضه قبله — فالثباتُ قدرةُ منعٍ لا صورةُ تقرير.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPOINTMENT_EXECUTOR, ROYAL_COURT, bootstrapState } from '../../src/index';
import { guardAppointmentSnapshot } from '../../src/governance/appointment_restore';

const T0 = Date.parse('2026-08-23T00:00:00Z');
const JUSTICE = 'ministry:justice';
const FOREIGN = 'ministry:foreign_affairs';
const TRANSIENT = 'ministry:transient';
const JUDGE = 'office:chief_judge';
const PROSECUTOR = 'office:prosecutor';
const ENVOY = 'office:envoy';
const QADI = 'official:qadi';
const SAFIR = 'official:safir';
const NAIB = 'official:naib';

type State = ReturnType<typeof bootstrapState>;

function scene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rehydrate-gov-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = T0): State => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

const structural = (s: State, target: string, at: number) =>
  s.king.issueCommand('amend_policy', target, { kind: 'government' }, at);
const appointing = (s: State, subject: string, at: number) =>
  s.king.issueCommand('appoint_official', subject, {}, at);

function establish(s: State, id: string, name: string, mandate: readonly string[], at: number): void {
  const r = s.ministries.establish(structural(s, id, at), {
    ministryId: id, name, mandate: [...mandate], proposedBy: ROYAL_COURT,
  }, at);
  assert.equal(r.ok, true, `تعذّر إنشاء ${id}`);
}

function declareOffice(
  s: State, officeId: string, ministryId: string, conflictsWith: readonly string[], at: number,
): void {
  const r = s.appointments.declareOffice(structural(s, officeId, at), {
    officeId, title: officeId, ministryId, conflictsWith: [...conflictsWith],
  }, at);
  assert.equal(r.ok, true, `تعذّر إعلان ${officeId}`);
}

function fullPath(s: State, proposalId: string, officeId: string, subject: string, at: number): void {
  const p = s.appointments.propose(ROYAL_COURT, {
    proposalId, kind: 'appointment', officeId, subject, reason: 'كفاءةٌ موثّقة',
  }, at);
  assert.equal(p.ok, true);
  const a = s.appointments.approve(appointing(s, subject, at), proposalId, at);
  assert.equal(a.ok, true);
  const e = s.appointments.execute(APPOINTMENT_EXECUTOR, proposalId, at);
  assert.equal(e.ok, true);
}

/** بذرةٌ حكوميّة: ثلاثُ وزاراتٍ (إحداها محلولة) وثلاثةُ مناصبَ ومنصبان مشغولان واعتمادٌ معلَّق */
function seed(s: State, now = T0): void {
  establish(s, JUSTICE, 'وزارة العدل', ['justice', 'courts'], now);
  establish(s, FOREIGN, 'وزارة الخارجية', ['foreign_affairs'], now);
  establish(s, TRANSIENT, 'وزارةٌ مؤقّتة', ['transient_domain'], now);
  declareOffice(s, JUDGE, JUSTICE, [PROSECUTOR], now);
  declareOffice(s, PROSECUTOR, JUSTICE, [JUDGE], now);
  declareOffice(s, ENVOY, FOREIGN, [], now);
  fullPath(s, 'prop:judge-1', JUDGE, QADI, now + 1);
  fullPath(s, 'prop:envoy-1', ENVOY, SAFIR, now + 2);

  const pending = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:pros-1', kind: 'appointment', officeId: PROSECUTOR,
    subject: NAIB, reason: 'ترشيحٌ معلن',
  }, now + 3);
  assert.equal(pending.ok, true);
  const approved = s.appointments.approve(appointing(s, NAIB, now + 3), 'prop:pros-1', now + 3);
  assert.equal(approved.ok, true);

  const dissolved = s.ministries.dissolve(
    structural(s, TRANSIENT, now + 4), TRANSIENT, 'انتهاءُ غرضها المعلن', now + 4,
  );
  assert.equal(dissolved.ok, true);
}

test('T-126: الحكومةُ تنجو الإطفاءَ — وزاراتٌ ومناصبُ وأصحابُها وسلاسلُهم', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s = sc.boot(T0 + 1000);
    const ministries = s.ministries.report();
    assert.equal(ministries.active, 2);
    assert.equal(ministries.dissolved, 1);
    assert.equal(ministries.domains, 3);
    const appointments = s.appointments.report();
    assert.equal(appointments.offices, 3);
    assert.equal(appointments.occupied, 2);
    assert.equal(appointments.proposals, 3);
    assert.equal(s.appointments.isOfficial(QADI), true);
    assert.equal(s.appointments.holderOf(JUDGE)?.holder, QADI);
    assert.equal(s.appointments.holderOf(ENVOY)?.holder, SAFIR);
    assert.equal(s.rehydratedGovernance?.silent.length, 0);
    assert.equal(s.rehydratedGovernance?.ministriesDissolved, 1);
  } finally { sc.clean(); }
});

test('T-126: حلُّ الوزارة تاريخٌ لا يُمحى بإقلاع', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s = sc.boot(T0 + 1000);
    const transient = s.ministries.get(TRANSIENT);
    assert.notEqual(transient, undefined);
    assert.equal(transient?.dissolvedAt, T0 + 4);
  } finally { sc.clean(); }
});

test('T-126: حرَسُ تعارضِ المناصب يبقى قائمًا بعد الإقلاع', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s = sc.boot(T0 + 1000);
    // القضاءُ والادّعاءُ لا يجتمعان: هذا ما قُبل قبل البند لأنّ المنصبَ الأوّلَ نُسي.
    const clash = s.appointments.propose(ROYAL_COURT, {
      proposalId: 'prop:clash', kind: 'appointment', officeId: PROSECUTOR,
      subject: QADI, reason: 'محاولةُ جمعٍ',
    }, T0 + 1001);
    assert.equal(clash.ok, false);
  } finally { sc.clean(); }
});

test('T-126: حرَسُ حلِّ الوزارة يرى المنصبَ المشغولَ بعد الإقلاع', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s = sc.boot(T0 + 1000);
    assert.deepEqual(s.appointments.occupiedOffices(FOREIGN), [ENVOY]);
    const dissolve = s.ministries.dissolve(
      structural(s, FOREIGN, T0 + 1001), FOREIGN, 'محاولةُ حلٍّ ومنصبُها مشغول', T0 + 1001,
    );
    assert.equal(dissolve.ok, false);
  } finally { sc.clean(); }
});

test('T-126: الاعتمادُ القائم يُنفَّذ بعد الإقلاع بسلسلتِه لا بإعادة مسارِه', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s = sc.boot(T0 + 1000);
    assert.equal(s.appointments.proposal('prop:pros-1')?.status, 'approved');
    assert.equal(typeof s.appointments.trailOf('prop:pros-1')?.approved, 'string');
    // مدةُ الاعتماد سبعةُ أيام، فالتنفيذُ في اليوم نفسِه داخلَها.
    const done = s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:pros-1', T0 + 1001);
    assert.equal(done.ok, true);
    assert.equal(s.appointments.holderOf(PROSECUTOR)?.holder, NAIB);
  } finally { sc.clean(); }
});

test('T-126: العزلُ ينجو الإطفاءَ كما ينجو التعيين', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    seed(first);
    const out = first.appointments.propose(ROYAL_COURT, {
      proposalId: 'prop:out-1', kind: 'dismissal', officeId: ENVOY,
      subject: SAFIR, reason: 'إخلالٌ موثّق',
    }, T0 + 5);
    assert.equal(out.ok, true);
    assert.equal(first.appointments.approve(appointing(first, SAFIR, T0 + 5), 'prop:out-1', T0 + 5).ok, true);
    assert.equal(first.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:out-1', T0 + 5).ok, true);
    assert.equal(first.appointments.holderOf(ENVOY), undefined);

    const s = sc.boot(T0 + 1000);
    assert.equal(s.appointments.holderOf(ENVOY), undefined);
    assert.equal(s.appointments.report().occupied, 1);
  } finally { sc.clean(); }
});

test('T-126: ثلاثةُ إقلاعاتٍ لا تُضاعف قيودَ الحكومة', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const kinds = new Set(['ministry_state', 'office_definition', 'appointment_proposal', 'office_holder']);
    const count = (s: State): number =>
      s.journal!.read().filter((e) => kinds.has(e.kind)).length;
    const after1 = count(sc.boot(T0 + 1000));
    const after2 = count(sc.boot(T0 + 2000));
    assert.equal(after1 > 0, true);
    assert.equal(after2, after1);
  } finally { sc.clean(); }
});

test('T-126: حرَسُ اللقطة يرفض بالرموز لا بالنصوص', () => {
  const office = {
    officeId: JUDGE, title: 'ق', ministryId: JUSTICE, conflictsWith: [PROSECUTOR],
  };
  const other = { officeId: PROSECUTOR, title: 'د', ministryId: JUSTICE, conflictsWith: [JUDGE] };
  const chain = { proposed: 'a', approved: 'b', executed: 'c' };
  const known = (id: string) => id === JUSTICE;
  const empty = { offices: [], proposals: [], holders: [] };

  assert.throws(() => guardAppointmentSnapshot(
    { ...empty, offices: [{ ...office, officeId: 'bad' }] }, known,
  ), /RECOVERY_OFFICE_INVALID/);
  // ثابت 2 في وحدة الحرَس: الوزاراتُ تُرجَع أوّلًا، فترتيبٌ معكوسٌ يُرفض لا يُقبل صامتًا.
  assert.throws(() => guardAppointmentSnapshot(
    { ...empty, offices: [office] }, () => false,
  ), /RECOVERY_OFFICE_MINISTRY_MISSING/);
  assert.throws(() => guardAppointmentSnapshot(
    { ...empty, holders: [{ officeId: JUDGE, holder: QADI, since: T0, chain }] }, known,
  ), /RECOVERY_HOLDER_OFFICE_MISSING/);
  assert.throws(() => guardAppointmentSnapshot({
    offices: [office], proposals: [],
    holders: [{ officeId: JUDGE, holder: QADI, since: T0, chain: { ...chain, executed: '' } }],
  }, known), /RECOVERY_HOLDER_CHAIN_INCOMPLETE/);
  assert.throws(() => guardAppointmentSnapshot({
    offices: [office, other], proposals: [],
    holders: [
      { officeId: JUDGE, holder: QADI, since: T0, chain },
      { officeId: PROSECUTOR, holder: QADI, since: T0, chain },
    ],
  }, known), /RECOVERY_HOLDER_CONFLICT/);

  const proposal = {
    proposalId: 'p1', kind: 'appointment' as const, officeId: ENVOY, subject: NAIB,
    reason: 'r', proposedBy: ROYAL_COURT, proposedAt: T0, status: 'approved' as const,
    approvedBy: 'crown:king', approvedAt: T0, commandId: 'c1',
    executedBy: null, executedAt: null,
  };
  assert.throws(() => guardAppointmentSnapshot({
    offices: [office], proposals: [{ proposal, trail: { proposed: 'a', approved: 'b' } }], holders: [],
  }, known), /RECOVERY_PROPOSAL_OFFICE_MISSING/);
  // اعتمادٌ بلا بصمةِ اعتمادٍ اعتمادٌ ميتٌ حاضرٌ في السجل: لا يُنفَّذ أبدًا فلا يُقبل.
  assert.throws(() => guardAppointmentSnapshot({
    offices: [{ ...office, officeId: ENVOY, conflictsWith: [] }],
    proposals: [{ proposal, trail: { proposed: 'a' } }], holders: [],
  }, known), /RECOVERY_PROPOSAL_TRAIL_MISSING/);
});

test('T-126: بابُ إرجاع الوزارات يرفض اللقطةَ الفاسدةَ برمزها', () => {
  const sc = scene();
  try {
    const s = sc.boot();
    assert.throws(() => s.ministries.restore([
      { ministryId: 'bad', name: 'س', mandate: ['x'], establishedAt: T0, dissolvedAt: null,
        proposedBy: ROYAL_COURT, dissolutionReason: null } as never,
    ], 'ministry:data'), /RECOVERY_MINISTRY_INVALID/);
    assert.throws(() => s.ministries.restore([
      { ministryId: JUSTICE, name: 'أ', mandate: ['justice'], establishedAt: T0, dissolvedAt: null,
        proposedBy: ROYAL_COURT, dissolutionReason: null } as never,
      { ministryId: FOREIGN, name: 'ب', mandate: ['justice'], establishedAt: T0, dissolvedAt: null,
        proposedBy: ROYAL_COURT, dissolutionReason: null } as never,
    ], 'ministry:data'), /RECOVERY_MINISTRY_MANDATE_CONFLICT/);
  } finally { sc.clean(); }
});
