/**
 * tests/data/rehydrate_roundtrip.test.ts — برهانُ الإرجاعِ سلوكيًّا صنفًا صنفًا (المرحلة 39، W-2026-040)
 * شرطُ القبول المعلن في عقد البند §4 بعد جولةِ المراجعةِ الأولى: البرهانُ النحويُّ في
 * `scripts/check_rehydrate_census.ts` يُثبت أنّ لكلِّ صنفٍ **موضعَ توزيعٍ** في الملفِّ المُسمّى،
 * وهو برهانٌ بنيويٌّ لا سلوكيّ. وهذا الملفُّ هو الوجهُ السلوكيُّ المقابل: يُقاس فيه أثرُ
 * **نزعِ قيودِ الصنفِ من اليوميّة** على الحالةِ المُرجَعة. فإن لم يتغيّر شيءٌ فالمنطقُ ميّتٌ
 * وإن دلَّت الشجرةُ على وجودِه — وهذه هي العلّةُ التي رفعها المراجعان (أ) و(ب).
 * المالك: وزارة البيانات | المدخلات: يوميّةٌ مبذورةٌ بالأبوابِ المعلنة | المخرجات: فروقُ تقارير
 * التبعيات: bootstrapState وأربعةُ مسالكِ الإرجاع المعلنة وREHYDRATE_CLAIMS
 * الصلاحيات: الكتابة عبر الواجهات العامة وحدها؛ كلُّ مسارٍ في tmpdir ولا يُلمس المستودع
 * السجلات: لا سجلَّ لهذا الاختبار — قياسُه على التقارير لا على الأثر
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir
 * اختبارات الوحدة: tests/data/rehydrate_census.test.ts | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 * ثوابت هذا الاختبار:
 *   1) **الفرقُ هو الدليل**: لكلِّ صنفٍ مُدَّعًى يُبنى تقريرانِ — بقيودِه وبعدَ نزعِها —
 *      ويُطلب اختلافُهما. وتقريرٌ لا يتغيّر بنزعِ صنفٍ يُعلن أنّ الصنفَ غيرُ مُستهلَك.
 *   2) **البذرُ بالأبوابِ المعلنةِ وحدها** كما يمرّ بها المشغّل — لا حقلَ خاصًّا ولا حمولةً
 *      مصنوعةً بيدٍ، فالحمولاتُ كلُّها ممّا كتبته الوحداتُ الحقيقيّةُ في اليوميّة.
 *   3) **التأكيدُ على الأعدادِ والرموزِ** لا على النصوص العربية المشكولة.
 *   4) **حدُّ هذا الملفِّ مُعلن**: ما لا يبذره هذا الملفُّ لا يُدَّعى له برهانٌ سلوكيٌّ هنا —
 *      يُطبَع ويُقاس عددُه فيسقط الاختبارُ إن اتّسعت الفجوةُ صامتة.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SovereignViolation } from '../../src/kernel/types';
import {
  APPOINTMENT_EXECUTOR, ROYAL_COURT, UNIT_TARGET, bootstrapState,
} from '../../src/index';
import { REHYDRATE_CLAIMS } from '../../src/data/rehydrate_census';
import type { DurableKind } from '../../src/kernel/config/persistence';
import type { DurableRecord, StateJournal } from '../../src/data/persistence';
import { rehydrateFromJournal } from '../../src/data/persistence';
import { rehydrateStateFromJournal } from '../../src/data/rehydrate_state';
import { rehydrateFiscalFromJournal } from '../../src/data/rehydrate_fiscal';
import { rehydrateGovernanceFromJournal } from '../../src/data/rehydrate_governance';

/** بعد أحدثِ `declared_at` في نِسَبِ الجباية المعلنة — الجبايةُ الرجعيّة مرفوضة */
const T0 = Date.parse('2026-08-23T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const FOREIGN = 'ministry:foreign_affairs';
const JUSTICE = 'ministry:justice';
const JUDGE = 'office:chief_judge';
const QADI = 'official:qadi';
const COMPUTE = 'external:compute-provider';
const AUDITOR = 'authority:audit_bureau';
const KIND_COMPUTE = 'contract:compute-capacity';
const OWNER = 'agent:roundtrip-1';
const READER = 'agent:roundtrip-2';

type State = ReturnType<typeof bootstrapState>;

function scene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rehydrate-roundtrip-'));
  const config = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = T0): State => bootstrapState({
      configDir: config, now, persistenceDir: join(root, 'state'),
    }),
    /** دولةٌ بلا يوميّة: أهدافٌ نظيفةٌ تُملأ من قيودٍ نُمرّرها بأيدينا */
    bare: (now = T0): State => bootstrapState({ configDir: config, now }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** بذرٌ يمرّ بالأبوابِ المعلنةِ وحدَها فيُنتِج قيودًا حقيقيّةً لأصنافِ الحصرِ (ثابت 2) */
function seedAll(s: State, now = T0): void {
  const royal = (t: string) => s.king.issueCommand('amend_policy', t, { kind: 'external' }, now);
  const gov = (t: string) => s.king.issueCommand('amend_policy', t, { kind: 'government' }, now);
  const open = (t: string) => s.king.issueCommand('open_external_account', t, { kind: 'external' }, now);

  // حكومة: وزارتان ومنصبٌ واعتمادٌ يُنفَّذ — ministry_state · office_definition
  for (const [id, name, mandate] of [
    [FOREIGN, 'وزارة الخارجية', 'foreign_affairs'], [JUSTICE, 'وزارة العدل', 'justice'],
  ] as const) {
    assert.equal(s.ministries.establish(gov(id), {
      ministryId: id, name, mandate: [mandate], proposedBy: ROYAL_COURT,
    }, now).ok, true, `تعذّر إنشاء ${id}`);
  }
  assert.equal(s.appointments.declareOffice(gov(JUDGE), {
    officeId: JUDGE, title: JUDGE, ministryId: JUSTICE, conflictsWith: [],
  }, now).ok, true);
  // appointment_proposal · office_holder
  assert.equal(s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:judge-1', kind: 'appointment', officeId: JUDGE, subject: QADI,
    reason: 'كفاءةٌ موثّقة',
  }, now + 1).ok, true);
  assert.equal(s.appointments.approve(
    s.king.issueCommand('appoint_official', QADI, {}, now + 1), 'prop:judge-1', now + 1,
  ).ok, true);
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:judge-1', now + 1).ok, true);

  for (const cp of s.externalConfig.counterparties) {
    s.egress.declare(open(cp.host), {
      host: cp.host, port: cp.port, purpose: cp.purpose,
      expiresAt: now + 60 * DAY, maxCallsPerMinute: 60,
    }, now);
  }

  // ماليّة: unit_supply · budget_appropriation · treasury_* · tax_levy
  assert.equal(s.unit.issue(royal(UNIT_TARGET), 100_000_000, 'رأس مال تشغيلي معلن', now).ok, true);
  assert.equal(s.unit.burn(royal(UNIT_TARGET), 4_000_000, 'إتلاف معلن', now).ok, true);
  assert.equal(s.budget.declare(royal('budget:foreign'), {
    line: 'budget:foreign', owner: FOREIGN, ceiling: 60_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now).ok, true);
  s.ledger.openAccount('expense:operations', 'expense', 'تشغيل معلن', now);
  assert.equal(s.treasury.disburse({
    line: 'budget:foreign', amount: 1_500_000, to: 'expense:operations',
    purpose: 'تشغيل معلن ضمن بند قائم', by: 'ministry:finance',
  }, now + 2).ok, true);
  const levy = s.revenue.assess('compute_usage', COMPUTE, 2_000_000, now, now);
  assert.equal(levy.ok, true);
  if (levy.ok) assert.equal(s.revenue.collect(levy.levy.levyId, now).ok, true);

  // نافذةٌ خارجيّة: external_account · external_payment · partner_* · contract_record
  assert.equal(s.externalAccounts.open(open(COMPUTE), {
    counterparty: COMPUTE, expiresAt: now + 90 * DAY, requestedBy: FOREIGN,
    justification: 'تشغيل معلن ضمن نطاق وزارة الخارجية',
  }, now).ok, true);
  assert.equal(s.payments.pay({
    accountId: COMPUTE, amount: 300_000, line: 'budget:foreign',
    purpose: 'سعة حساب معلنة', requestedBy: FOREIGN,
  }, now).ok, true);
  assert.equal(s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: [], assessedBy: AUDITOR,
    justification: 'تقدير معلن لنوع عقد قائم',
  }, now).ok, true);
  const contract = s.contracts.sign(open(KIND_COMPUTE), {
    kindId: KIND_COMPUTE, value: 3_000_000, endsAt: now + 30 * DAY,
    proposedBy: FOREIGN, purpose: 'تعهّد معلن ينجو الإقلاع',
  }, now);
  assert.equal(contract.ok, true);
  if (contract.ok) {
    assert.equal(
      s.partnerRisk.noteBreach(AUDITOR, contract.contract.contractId, 'تأخر تسليم معلن', now), true,
    );
  }

  // دفترٌ وسكّان: ledger_entry · population_batch · population_terminated
  assert.equal(s.ledger.post({
    entryId: 'entry:roundtrip-1', memo: 'قيدٌ متوازنٌ معلن', by: 'ministry:finance',
    lines: [
      { account: s.economyConfig.treasury.account, debit: 250_000 },
      { account: s.economyConfig.treasury.revenue_account, credit: 250_000 },
    ],
  }, now).ok, true);
  assert.equal(s.population.registerBatch(
    s.king.issueCommand('create_agent', 'population:roundtrip', {}, now),
    [{ agentId: 'agent:pop-1', owner: 'ministry:infrastructure', resourceQuota: 'identity_slots:1' }],
    now,
  ).ok, true);
  s.population.terminateAll();

  // ذاكرةٌ ومعرفةٌ ومشاركة: memory_record · knowledge_fact · memory_share · audit_entry
  const written = s.memory.write(OWNER, {
    content: 'جوهرٌ ينجو من إعادة التشغيل', provenance: { kind: 'tool_call', ref: 'roundtrip:1' },
    retentionClass: 'official',
  }, now);
  assert.equal(written.ok, true);
  if (!written.ok) return;
  assert.equal(s.memory.share(written.record.recordId, OWNER, READER), true);
  assert.equal(s.knowledge.assert('ministry:data', {
    subject: 'durable:state', predicate: 'ينجو', object: 'نعم',
    sourceRecordId: written.record.recordId,
  }, now).ok, true);

  // آخرًا: تجميدُ الخزانة — فحالُ الخزانةِ لا يُقاس إلّا إن تبدّل (treasury_state)
  assert.equal(s.treasury.freeze(
    s.king.issueCommand('declare_emergency', 'treasury:state', { kind: 'emergency' }, now + 3),
    'تجميدٌ معلن لقياس نجاةِ الحال', now + 3,
  ).ok, true, 'التجميدُ شرطُ قياسِ treasury_state');
}

/** مسالكُ الإرجاعِ الأربعةُ مُسمّاةً بملفّاتِها كما في جدولِ الدعاوى — لا سلسلةَ نصٍّ تُطابَق */
type Family = 'core' | 'state' | 'fiscal' | 'governance';
const FAMILY_OF: Readonly<Record<string, Family>> = {
  'src/data/persistence.ts': 'core',
  'src/data/rehydrate_state.ts': 'state',
  'src/data/rehydrate_fiscal.ts': 'fiscal',
  'src/data/rehydrate_governance.ts': 'governance',
};

/**
 * يوميّةٌ صوريّةٌ للقراءةِ: `rehydrateFromJournal` يقرأ بـ`read()`، والوحداتُ التي يُملأها
 * قد تُدوّن أثرَ الملءِ فيُبلَع `record` صراحةً — فالمقيسُ هنا التقريرُ لا أثرُ الملء.
 */
const asJournal = (entries: readonly DurableRecord[]): StateJournal => ({
  read: () => entries,
  record: () => null,
  covers: () => false,
  get droppedOutOfScope() { return 0; },
  droppedByKind: () => new Map<string, number>(),
} as unknown as StateJournal);

function reportOf(family: Family, entries: readonly DurableRecord[], s: State): unknown {
  if (family === 'core') {
    return rehydrateFromJournal(asJournal(entries), {
      audit: s.audit, memory: s.memory, knowledge: s.knowledge, terminationRoll: s.terminationRoll,
    }, 'ministry:data', { rebuildTerminationRoll: true });
  }
  if (family === 'state') {
    return rehydrateStateFromJournal(entries, {
      ledger: s.ledger, contracts: s.contracts, population: s.population,
    }, 'ministry:data');
  }
  if (family === 'fiscal') {
    // إرجاعُ الماليّةِ يشترط قيدَ الدفترِ للمصروف، فيُملأ الدفترُ أوّلًا بالمسلكِ المعلن
    // لا بحقلٍ خاصّ — وهذا ترتيبُ `src/index.ts` نفسُه (الحالةُ ثمّ الماليّة).
    rehydrateStateFromJournal(entries, {
      ledger: s.ledger, contracts: s.contracts, population: s.population,
    }, 'ministry:data');
    return rehydrateFiscalFromJournal(entries, {
      treasury: s.treasury, budget: s.budget, revenue: s.revenue, unit: s.unit,
      accounts: s.externalAccounts, payments: s.payments, risk: s.partnerRisk,
    }, 'ministry:data');
  }
  return rehydrateGovernanceFromJournal(entries, {
    ministries: s.ministries, appointments: s.appointments,
  }, 'ministry:data');
}

test('الإرجاعُ سلوكيًّا: البذرُ بالأبوابِ المعلنةِ يُنتِج قيودًا لأصنافِ الحصرِ المُدَّعاة', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    seedAll(first);
    const entries = first.journal!.read();
    const seen = new Set<string>(entries.map((e) => e.kind));
    assert.ok(entries.length > 20, `اليوميّةُ شبهُ فارغةٍ فلا برهانَ فيها: ${entries.length}`);
    const claimedKinds = REHYDRATE_CLAIMS
      .filter((c) => c.consumer !== null).map((c) => c.kind);
    const uncovered = claimedKinds.filter((k) => !seen.has(k)).sort();
    // ثابت 4: الفجوةُ تُعلن ولا تُخفى — واتّساعُها يُسقط الاختبارَ لا يمرّ صامتًا
    assert.deepEqual(uncovered, [], `أصنافٌ مُدَّعاةٌ لم يبذرها هذا الملف: ${uncovered.join(', ')}`);
    assert.equal(claimedKinds.length, 21);
  } finally {
    sc.clean();
  }
});

/**
 * حقولٌ تقيس **حجمَ المُدخَل** لا أثرَ الإرجاع، فتُستبعد من الملحوظ.
 *
 * **العيبُ الذي أوجب هذا**: مراجعةُ الجولةِ الثانيةِ أقامت مجتمعةً
 * (`ROUNDTRIP_CORE_COUNT_CONFUNDS_RESTORE` · `ROUNDTRIP_CORE_COUNTS_JOURNAL_LENGTH_NOT_RESTORE`)
 * أنّ `RehydrateReport.records = entries.length` (`src/data/persistence.ts`) يجعل الملحوظَ
 * يتبدّل حتمًا عند نزعِ أيِّ قيدٍ — فيمرُّ الاختبارُ ولو كان منطقُ الإرجاعِ
 * محذوفًا بأكملِه. فما كان يُقاس طولُ اليوميّةِ لا أثرُ قراءتِها.
 *
 * وما يبقى مقيسًا هو ما يكتبُه فرعُ التوزيعِ وحدَه: `auditEntries` · `memoryRecords`
 * · `memoryShares` · `facts` · `terminations` — و`silent` في المسالكِ الأخرى لأنّه يُرفعُ
 * من داخلِ الفرعِ نفسِه (`…Seen = true`) فتبدُّلُه شهادةُ تنفيذٍ لا شهادةُ مُدخَل.
 */
const INPUT_SIZE_FIELDS: readonly string[] = Object.freeze(['records']);

/**
 * والرفضُ فرقٌ كذلك: نزعُ صنفٍ قد يقطع شرطَ إرجاعٍ لصنفٍ آخرَ فيسقط المسلكُ برمزه —
 * وهو أقوى شهادةٍ على الاستهلاك من عددٍ يتبدّل. فيُقاس **الملحوظُ** لا التقريرُ وحدَه،
 * ويُنزَع من الملحوظِ ما يقيس حجمَ المُدخَلِ حتّى يكون التبدُّلُ أثرَ إرجاعٍ لا أثرَ حذف.
 */
function observe(family: Family, entries: readonly DurableRecord[], s: State): string {
  try {
    return JSON.stringify(
      reportOf(family, entries, s),
      (key, value) => (INPUT_SIZE_FIELDS.includes(key) ? undefined : value),
    );
  } catch (error) {
    return `رفض:${error instanceof SovereignViolation ? error.code : String(error)}`;
  }
}

test('الإرجاعُ سلوكيًّا: نزعُ قيودِ صنفٍ يُغيّر التقريرَ — وتقريرٌ لا يتغيّر يفضح منطقًا ميّتًا', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    seedAll(first);
    const entries = first.journal!.read();
    const dead: string[] = [];
    for (const claim of REHYDRATE_CLAIMS) {
      if (claim.consumer === null) continue;
      const family = FAMILY_OF[claim.consumer];
      assert.ok(family, `${claim.kind}: مستهلكٌ خارجَ المسالكِ الأربعةِ المعلنة: ${claim.consumer}`);
      const withoutKind = entries.filter((e) => e.kind !== claim.kind);
      assert.ok(
        withoutKind.length < entries.length,
        `${claim.kind}: لا قيدَ لهذا الصنفِ في اليوميّة فلا فرقَ يُقاس`,
      );
      const full = observe(family!, entries, sc.bare(T0 + 10));
      const cut = observe(family!, withoutKind, sc.bare(T0 + 20));
      if (full === cut) dead.push(claim.kind);
    }
    assert.deepEqual(
      dead, [],
      `أصنافٌ نُزعت قيودُها فلم يتغيّر تقريرُ مسلكِها — منطقُ إرجاعِها ميّتٌ أو غيرُ مقيس: ${dead.join(', ')}`,
    );
  } finally {
    sc.clean();
  }
});

test('الإرجاعُ سلوكيًّا: الإقلاعُ الثاني يُعيد الحالةَ لا عددَها — أربعةُ مسالكَ تشهد', () => {
  const sc = scene();
  try {
    seedAll(sc.boot());
    const second = sc.boot(T0 + 1000);
    assert.ok((second.rehydrated?.records ?? 0) > 0, 'المسلكُ الأساسيُّ لم يُرجع شيئًا');
    assert.equal(second.rehydrated?.memoryRecords, 1);
    assert.equal(second.rehydrated?.facts, 1);
    assert.ok((second.rehydrated?.memoryShares ?? 0) >= 1);
    assert.ok((second.rehydratedState?.ledgerEntries ?? 0) >= 1);
    assert.equal(second.rehydratedState?.contracts, 1);
    assert.ok((second.rehydratedFiscal?.disbursements ?? 0) >= 1);
    assert.ok((second.rehydratedFiscal?.levies ?? 0) >= 1);
    assert.equal(second.rehydratedFiscal?.unitIssued, 100_000_000);
    assert.ok((second.rehydratedGovernance?.ministries ?? 0) >= 2);
    assert.ok((second.rehydratedGovernance?.holders ?? 0) >= 1);
    // والحرَسُ هو المقيس لا العدد: المنتهي لا يُحيا بإقلاع
    assert.equal(second.population.population, 0, 'المنتهي عاد حيًّا — الإرجاعُ صورةٌ لا حالة');
    assert.equal(second.knowledge.report().total, 1);
  } finally {
    sc.clean();
  }
});
