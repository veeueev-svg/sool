/**
 * scripts/governance_scope_probe.ts — مسبارُ ثباتِ الوزارات والتعيينات (المرحلة 39، البند T-126)
 * المالك: وزارة الداخلية + وزارة البيانات | المدخلات: مجلدُ تهيئةٍ منسوخٌ ويوميّةٌ في tmpdir
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًا في docs/audit/measurements/phase-39-T126.txt
 * التبعيات: dist/src/index | الصلاحيات: لا يكتب في المستودع؛ كل مساره في tmpdir
 * السجلات: يعتمد على سجلات الوحدات — والمسبار لا يخترع قيدًا لنفسه
 * حالات الفشل: أي رفض سيادي غيرِ متوقَّعٍ يخرج برمزه — لا يُبتلع خطأ (RULE-007)
 * اختبار القبول: tests/data/rehydrate_governance.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0032-governance-durability.md
 * ثوابت هذا الملف:
 *   1) **«قبل» و«بعد» في جريانٍ واحد** بالبذرة نفسها على المهاد نفسه (كثابت 1 في مسبار T-125):
 *      فالمقارنةُ لا تُستدعى من ذاكرةِ جلسةٍ سابقة (RULE-001).
 *   2) **يُقاس أثرُ الفقد على قدرةِ الفعل لا الفقدُ وحده**: بعد الإقلاع يُنادى تنفيذُ اعتمادٍ
 *      قائم، ويُقترح جمعُ منصبَين متعارضَين، ويُحاول حلُّ وزارةٍ فيها منصبٌ مشغول — فما
 *      يُقبل بعد الإقلاع وكان يُرفض قبله **حرسٌ يُفَكُّ بإعادة تشغيل** لا تقريرٌ ينقص.
 *   3) **ما يُعاد إقامتُه عن قصدٍ يُعلن**: في حالة «قبل» تُعاد إقامةُ الوزارةِ وإعلانُ المنصب
 *      حتى يكون المقيسُ **الحرَسَ** (تعارضُ المناصب، شغلُ المنصب) لا غيابَ الوزارة (RULE-008).
 *   4) **الأرقامُ تُطبع كما قيست**: عددُ القيود وحجمُ الملف وزمنُ الإقلاع والتحقّق.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPOINTMENT_EXECUTOR, bootstrapState, ROYAL_COURT } from '../src/index';

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
/** نطاقُ ما قبل T-126 حرفًا: تسعةَ عشرَ صنفًا كما أقرّها T-122 وT-125 */
const NARROW = [
  'audit_entry', 'memory_record', 'memory_share', 'knowledge_fact', 'archive_snapshot',
  'journal_compacted', 'ledger_entry', 'contract_record', 'population_batch',
  'population_terminated', 'treasury_disbursement', 'treasury_state', 'budget_appropriation',
  'tax_levy', 'unit_supply', 'external_account', 'external_payment', 'partner_assessment',
  'partner_breach',
];

type State = ReturnType<typeof bootstrapState>;

/** مهادٌ بتهيئةٍ منسوخة: نطاقُ التدوين يُبدَّل في الملف لا في الشفرة (RULE-005) */
function scene(scope: readonly string[] | null) {
  const root = mkdtempSync(join(tmpdir(), 'sool-gov-probe-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  if (scope) {
    const file = join(config, 'persistence.yaml');
    const body = readFileSync(file, 'utf8');
    const head = body.slice(0, body.indexOf('  scope:'));
    const tail = body.slice(body.indexOf('\n# T-123'));
    writeFileSync(file, `${head}  scope:\n${scope.map((k) => `    - ${k}`).join('\n')}\n${tail}`, 'utf8');
  }
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
  if (!r.ok) throw new Error(`PROBE_MINISTRY_FAILED:${id}:${r.reason}`);
}

function declareOffice(
  s: State, officeId: string, title: string, ministryId: string,
  conflictsWith: readonly string[], at: number,
): void {
  const r = s.appointments.declareOffice(structural(s, officeId, at), {
    officeId, title, ministryId, conflictsWith: [...conflictsWith],
  }, at);
  if (!r.ok) throw new Error(`PROBE_OFFICE_FAILED:${officeId}:${r.reason}`);
}

/** مسارٌ كامل: اقتراحٌ من الديوان ← اعتمادٌ ملكيّ ← تنفيذٌ من حرس التاج */
function fullPath(s: State, proposalId: string, officeId: string, subject: string, at: number): void {
  const p = s.appointments.propose(ROYAL_COURT, {
    proposalId, kind: 'appointment', officeId, subject, reason: 'كفاءةٌ موثّقة',
  }, at);
  if (!p.ok) throw new Error(`PROBE_PROPOSE_FAILED:${proposalId}:${p.reason}`);
  const a = s.appointments.approve(appointing(s, subject, at), proposalId, at);
  if (!a.ok) throw new Error(`PROBE_APPROVE_FAILED:${proposalId}:${a.reason}`);
  const e = s.appointments.execute(APPOINTMENT_EXECUTOR, proposalId, at);
  if (!e.ok) throw new Error(`PROBE_EXECUTE_FAILED:${proposalId}:${e.reason}`);
}

/** بذرةٌ حكوميّة: ثلاثُ وزاراتٍ (إحداها محلولة) وثلاثةُ مناصبَ ومنصبان مشغولان واعتمادٌ معلَّق */
function seed(s: State, now = T0): void {
  establish(s, JUSTICE, 'وزارة العدل', ['justice', 'courts'], now);
  establish(s, FOREIGN, 'وزارة الخارجية', ['foreign_affairs'], now);
  establish(s, TRANSIENT, 'وزارةٌ مؤقّتة', ['transient_domain'], now);

  declareOffice(s, JUDGE, 'رئيسُ القضاء', JUSTICE, [PROSECUTOR], now);
  declareOffice(s, PROSECUTOR, 'المدّعي العام', JUSTICE, [JUDGE], now);
  declareOffice(s, ENVOY, 'المبعوثُ الأوّل', FOREIGN, [], now);

  fullPath(s, 'prop:judge-1', JUDGE, QADI, now + 1);
  fullPath(s, 'prop:envoy-1', ENVOY, SAFIR, now + 2);

  // اعتمادٌ قائمٌ لم يُنفَّذ: سلسلتُه ناقصةُ الحلقة الثالثة عن قصد
  const pending = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:pros-1', kind: 'appointment', officeId: PROSECUTOR,
    subject: NAIB, reason: 'ترشيحٌ معلن',
  }, now + 3);
  if (!pending.ok) throw new Error(`PROBE_PENDING_FAILED:${pending.reason}`);
  const approved = s.appointments.approve(appointing(s, NAIB, now + 3), 'prop:pros-1', now + 3);
  if (!approved.ok) throw new Error(`PROBE_PENDING_APPROVE_FAILED:${approved.reason}`);

  // وزارةٌ تُحلّ بأمرٍ: الحلُّ يوقف الاختصاص ويبقي التاريخ (ثابت 5 في سجل الوزارات)
  const dissolved = s.ministries.dissolve(
    structural(s, TRANSIENT, now + 4), TRANSIENT, 'انتهاءُ غرضها المعلن', now + 4,
  );
  if (!dissolved.ok) throw new Error(`PROBE_DISSOLVE_FAILED:${dissolved.reason}`);
}

interface Gov {
  active: number; dissolved: number; domains: number;
  transientDissolvedAt: string;
  offices: number; occupied: number; proposals: number;
  pendingStatus: string;
  qadiIsOfficial: boolean; qadiOffices: number;
  occupiedInForeign: number;
  chainComplete: number;
}

/** قراءةٌ محضة: لا تُقيّد سجلًا ولا تُغيّر حالة — فالقياسُ لا يُلوّث المقيس */
function read(s: State): Gov {
  const ministries = s.ministries.report();
  const appointments = s.appointments.report();
  const transient = s.ministries.get(TRANSIENT);
  const pending = s.appointments.proposal('prop:pros-1');
  let chainComplete = 0;
  for (const officeId of [JUDGE, PROSECUTOR, ENVOY]) {
    const holder = s.appointments.holderOf(officeId);
    if (holder && holder.chain.proposed && holder.chain.approved && holder.chain.executed) {
      chainComplete += 1;
    }
  }
  return {
    active: ministries.active, dissolved: ministries.dissolved, domains: ministries.domains,
    transientDissolvedAt: transient === undefined
      ? 'الوزارةُ نفسُها غيرُ موجودة'
      : (transient.dissolvedAt === null ? 'قائمةٌ (لا حلّ)' : `مقيَّدٌ عند ${transient.dissolvedAt}`),
    offices: appointments.offices, occupied: appointments.occupied,
    proposals: appointments.proposals,
    pendingStatus: pending === undefined ? 'الاقتراحُ غيرُ موجود' : pending.status,
    qadiIsOfficial: s.appointments.isOfficial(QADI),
    qadiOffices: s.appointments.officesOf(QADI).length,
    occupiedInForeign: s.appointments.occupiedOffices(FOREIGN).length,
    chainComplete,
  };
}

/**
 * ثابت 3: تُعاد إقامةُ الوزارةِ وإعلانُ المنصبَين **عن قصد** إن غابا، حتى يكون المقيسُ
 * حرَسَ تعارضِ المناصب لا غيابَ الوزارة. وما أُعيد يُطبع في الخرج فلا يُخفى.
 */
function reestablishIfMissing(s: State, now: number): string {
  const restored: string[] = [];
  if (!s.ministries.isActive(JUSTICE)) {
    establish(s, JUSTICE, 'وزارة العدل', ['justice', 'courts'], now);
    restored.push(JUSTICE);
  }
  for (const [officeId, title, conflicts] of [
    [JUDGE, 'رئيسُ القضاء', [PROSECUTOR]], [PROSECUTOR, 'المدّعي العام', [JUDGE]],
  ] as [string, string, string[]][]) {
    const declared = s.appointments.declareOffice(structural(s, officeId, now), {
      officeId, title, ministryId: JUSTICE, conflictsWith: conflicts,
    }, now);
    if (declared.ok) restored.push(officeId);
  }
  return restored.length === 0 ? 'لا شيء (كلُّه نجا)' : restored.join(' · ');
}

/** أثرٌ 1: حرَسُ تعارضِ المناصب — أيُجمع القضاءُ والادّعاءُ في شخصٍ واحدٍ بعد الإقلاع؟ */
function probeConflictGuard(s: State, now: number): string {
  const r = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:conflict-1', kind: 'appointment', officeId: PROSECUTOR,
    subject: QADI, reason: 'ترشيحٌ بعد الإقلاع',
  }, now);
  return r.ok ? `**مقبول** — القضاءُ والادّعاءُ يجتمعان في ${QADI}` : `مرفوض — ${r.reason}`;
}

/** أثرٌ 2: الاعتمادُ القائمُ قبل الإطفاء — أيُنفَّذ بعده أم يُعاد المسارُ من أوّله؟ */
function probePendingExecution(s: State, now: number): string {
  const r = s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:pros-1', now);
  return r.ok
    ? `مقبول — ${r.proposal.subject} شغل ${r.proposal.officeId} بسلسلته الكاملة`
    : `**مرفوض** — ${r.reason}`;
}

/** أثرٌ 3: حرَسُ الحلّ (ثابت 4) — أتُحلّ وزارةٌ فيها منصبٌ مشغولٌ بعد الإقلاع؟ */
function probeDissolveGuard(s: State, now: number): string {
  const reinstated = s.ministries.isActive(FOREIGN)
    ? ''
    : (establish(s, FOREIGN, 'وزارة الخارجية', ['foreign_affairs'], now), ' (أُعيدت إقامتُها عن قصد)');
  const occupied = s.appointments.occupiedOffices(FOREIGN).length;
  const r = s.ministries.dissolve(
    structural(s, FOREIGN, now), FOREIGN, 'حلٌّ بعد الإقلاع', now,
  );
  const verdict = r.ok
    ? `**مقبول** — وزارةٌ حُلّت والمنصبُ فيها مشغولٌ في السجل الأبديّ`
    : `مرفوض — ${r.reason}`;
  return `${verdict}${reinstated} · المناصبُ المشغولةُ التي رآها الحرَس: ${occupied}`;
}

function measure(label: string, scope: readonly string[] | null): void {
  const s = scene(scope);
  try {
    const first = s.boot();
    seed(first);
    const before = read(first);
    const records = first.journal?.read().length ?? 0;
    const bytes = first.journal ? statSync(first.journal.file).size : 0;
    first.journal?.close();

    const startedAt = Date.now();
    const second = s.boot(T0 + 1000);
    const bootMs = Date.now() - startedAt;
    const after = read(second);
    const verifyStarted = Date.now();
    const valid = second.journal?.verify().valid ?? false;
    const verifyMs = Date.now() - verifyStarted;

    console.log(`── ${label} ──`);
    console.log(`  أصنافُ النطاق: ${(scope ?? second.persistenceConfig.policy.scope).length}`);
    console.log(`  قيودُ اليوميّة: ${records} · حجمُها: ${bytes}B`
      + ` · لكل قيد: ${records > 0 ? (bytes / records).toFixed(1) : 0}B`);
    const rows: [string, string | number | boolean, string | number | boolean][] = [
      ['الوزاراتُ القائمة', before.active, after.active],
      ['الوزاراتُ المحلولة (في السجل)', before.dissolved, after.dissolved],
      ['نطاقاتُ الاختصاص المملوكة', before.domains, after.domains],
      ['تاريخُ حلِّ الوزارة المؤقّتة', before.transientDissolvedAt, after.transientDissolvedAt],
      ['المناصبُ المعلنة', before.offices, after.offices],
      ['المناصبُ المشغولة', before.occupied, after.occupied],
      ['الاقتراحاتُ في السجل', before.proposals, after.proposals],
      ['حالةُ الاقتراح المعتمد', before.pendingStatus, after.pendingStatus],
      [`هل ${QADI} صاحبُ منصب؟`, before.qadiIsOfficial, after.qadiIsOfficial],
      [`مناصبُ ${QADI}`, before.qadiOffices, after.qadiOffices],
      ['المشغولُ في وزارة الخارجية (ما يراه حرَسُ الحلّ)', before.occupiedInForeign, after.occupiedInForeign],
      ['المناصبُ ذاتُ سلسلةِ مشروعيّةٍ كاملة', before.chainComplete, after.chainComplete],
    ];
    for (const [name, b, a] of rows) {
      const lost = typeof b === 'number' && typeof a === 'number' ? ` (فُقد ${b - a})` : '';
      console.log(`  ${name}: ${b} ⇒ ${a}${lost}`);
    }
    console.log(`  أُعيد إقامتُه عن قصدٍ قبل قياس الحرَس: ${reestablishIfMissing(second, T0 + 1010)}`);
    console.log(`  أثرٌ 1 — حرَسُ تعارضِ المناصب: ${probeConflictGuard(second, T0 + 1020)}`);
    console.log(`  أثرٌ 2 — تنفيذُ الاعتماد القائم: ${probePendingExecution(second, T0 + 1030)}`);
    console.log(`  أثرٌ 3 — حرَسُ حلِّ الوزارة: ${probeDissolveGuard(second, T0 + 1040)}`);
    console.log(`  زمنُ الإقلاع: ${bootMs}ms · تحقُّقُ السلسلة: ${verifyMs}ms · صحيحة: ${valid}`);
    const report = (second as { rehydratedGovernance?: unknown }).rehydratedGovernance;
    console.log(`  تقريرُ الإرجاع الحكوميّ: ${report === undefined || report === null ? 'لا يوجد' : JSON.stringify(report)}`);
    second.journal?.close();
  } finally { s.clean(); }
}

function main(): void {
  console.log('مسبارُ ثباتِ الوزارات والتعيينات (T-126) — بذرةٌ واحدةٌ في نطاقَين');
  console.log('');
  measure('قبل التوسيع: النطاقُ كما أقرّه T-125 (تسعةَ عشرَ صنفًا)', NARROW);
  console.log('');
  measure('بعد التوسيع: النطاقُ الكامل المعلن في التهيئة (T-126)', null);
}

main();
