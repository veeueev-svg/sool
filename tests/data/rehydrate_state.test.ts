/**
 * tests/data/rehydrate_state.test.ts — قبولُ توسيع نطاق التدوين (المرحلة 39، البند T-122)
 * شرطُ القبول المعلن في PROGRESS.md: «توسيعُ scope إلى الاقتصاد والعقود والسكان بعد قياس
 * كلفةِ التدوين عند السكان الضخم — ولا يُوسَّع بلا رقمٍ مقيس». والرقمُ في
 * docs/audit/measurements/phase-39-T122-T123.txt، وهذا الملف يُثبت أثرَه: دولتان
 * تتعاقبان على مجلد يوميّةٍ واحد، فالثانيةُ ترث دفترَ الأولى وعقودَها وسكانَها.
 * المالك: وزارة البيانات | المدخلات: تهيئةٌ مؤقتة ومجلدُ يوميّة | المخرجات: حالةٌ تنجو أو رفض
 * التبعيات: bootstrapState وrehydrateStateFromJournal | الصلاحيات: الكتابة عبر الواجهات العامة وحدها
 * السجلات: ledger_restored وpopulation_restored وexternal_contracts_restored
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir ولا يكتب في المستودع
 * اختبارات الوحدة: tests/data/persistence.test.ts | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/decisions/ADR-0030-durability-scope-and-retention.md
 * ثوابت هذا الاختبار:
 *   1) لا كتابة بحقلٍ خاص: كل بذرةٍ تمر بالباب المعلن كما يمر به المشغّل.
 *   2) الإقلاعُ الثاني دولةٌ جديدة بالكامل — لا كائنَ مشتركًا بين الإقلاعين.
 *   3) التأكيد على الأرقام والرموز لا على النصوص العربية المشكولة.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROYAL_COURT, UNIT_TARGET, bootstrapState } from '../../src/index';

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const FOREIGN = 'ministry:foreign_affairs';
const COMPUTE = 'external:compute-provider';
const KIND_COMPUTE = 'contract:compute-capacity';
const AUDITOR = 'authority:audit_bureau';

type State = ReturnType<typeof bootstrapState>;

function scene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rehydrate-state-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = T0) => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** أرضيةُ العقود: وزارةٌ وأذونُ خروجٍ ورأسُ مالٍ وبندُ موازنةٍ وحسابٌ خارجي مفتوح */
function ground(s: State, now = T0): void {
  const royal = (target: string) => s.king.issueCommand('amend_policy', target, { kind: 'external' }, now);
  const royalOpen = (target: string) => s.king.issueCommand('open_external_account', target, { kind: 'external' }, now);
  s.ministries.establish(royal(FOREIGN), {
    ministryId: FOREIGN, name: 'وزارة الخارجية', mandate: ['foreign_affairs'], proposedBy: ROYAL_COURT,
  }, now);
  for (const cp of s.externalConfig.counterparties) {
    s.egress.declare(royalOpen(cp.host), {
      host: cp.host, port: cp.port, purpose: cp.purpose,
      expiresAt: now + 60 * DAY, maxCallsPerMinute: 60,
    }, now);
  }
  s.unit.issue(royal(UNIT_TARGET), 100_000_000, 'رأس مال تشغيلي معلن', now);
  s.budget.declare(royal('budget:foreign'), {
    line: 'budget:foreign', owner: FOREIGN, ceiling: 60_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now);
  const opened = s.externalAccounts.open(royalOpen(COMPUTE), {
    counterparty: COMPUTE, expiresAt: now + 90 * DAY, requestedBy: FOREIGN,
    justification: 'تشغيل معلن ضمن نطاق وزارة الخارجية',
  }, now);
  assert.equal(opened.ok, true, 'الحساب الخارجي شرطُ العقد');
}

function signOne(s: State, now = T0): string {
  const assessed = s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: [], assessedBy: AUDITOR,
    justification: 'تقدير معلن لنوع عقد قائم',
  }, now);
  assert.equal(assessed.ok, true);
  const signed = s.contracts.sign(
    s.king.issueCommand('open_external_account', KIND_COMPUTE, { kind: 'external' }, now),
    {
      kindId: KIND_COMPUTE, value: 5_000_000, endsAt: now + 30 * DAY,
      proposedBy: FOREIGN, purpose: 'تعهّد معلن ضمن نطاق وزارة الخارجية',
    },
    now,
  );
  assert.equal(signed.ok, true, 'العقد المرجعي يجب أن يُوقَّع');
  if (!signed.ok) throw new Error('SEED_CONTRACT');
  return signed.contract.contractId;
}

/** قيدٌ متوازن بين حسابين سياديّين قائمين من التأسيس */
function postEntry(s: State, entryId: string, amount: number, now = T0) {
  return s.ledger.post({
    entryId, memo: `قيد قياس ${entryId}`, by: 'ministry:finance',
    lines: [
      { account: s.economyConfig.treasury.account, debit: amount },
      { account: s.economyConfig.treasury.revenue_account, credit: amount },
    ],
  }, now);
}

function population(count: number, prefix = 'agent:durable') {
  return Array.from({ length: count }, (_, index) => ({
    agentId: `${prefix}-${index + 1}`, owner: 'ministry:infrastructure',
    resourceQuota: 'identity_slots:1',
  }));
}

// ═══ 1) النطاق: الأصنافُ الأربعة تُدوَّن فعلًا ═══

test('التهيئة تُعلن الأصناف الأربعة، واليوميّة تشهد لها بقيدٍ لكلٍّ منها', () => {
  const s = scene();
  try {
    const first = s.boot();
    const journal = first.journal;
    assert.ok(journal, 'المجلد مُمرَّر فاليوميّة قائمة');
    for (const kind of ['ledger_entry', 'contract_record', 'population_batch', 'population_terminated'] as const) {
      assert.equal(journal.covers(kind), true, `${kind} داخل النطاق المعلن`);
    }
    ground(first);
    signOne(first);
    assert.equal(postEntry(first, 'entry:1', 1_000).ok, true);
    first.population.registerBatch(
      first.king.issueCommand('create_agent', 'population:durable', {}, T0), population(3), T0,
    );
    const kinds = journal.read().map((entry) => entry.kind);
    assert.ok(kinds.includes('ledger_entry'), 'الدفتر يُدوَّن');
    assert.ok(kinds.includes('contract_record'), 'العقد يُدوَّن');
    assert.equal(kinds.filter((kind) => kind === 'population_batch').length, 1,
      'دفعةٌ واحدة ⇒ قيدٌ واحد لا ثلاثة (الدفعةُ وحدةُ التدوين — ثابت 7 في population.ts)');
    journal.close();
  } finally { s.clean(); }
});

// ═══ 2) الإرجاع: الدولةُ الثانية ترث ═══

test('قبول T-122: الدفترُ والعقدُ والسكان ينجون من إعادة التشغيل', () => {
  const s = scene();
  try {
    const first = s.boot();
    ground(first);
    signOne(first);
    assert.equal(postEntry(first, 'entry:1', 1_000).ok, true);
    assert.equal(postEntry(first, 'entry:2', 2_500).ok, true);
    first.population.registerBatch(
      first.king.issueCommand('create_agent', 'population:durable', {}, T0), population(3), T0,
    );
    const balanceBefore = first.ledger.trialBalance();
    first.journal?.close();

    // دولةٌ ثانية جديدة بالكامل على المجلد نفسه
    const second = s.boot(T0 + 1000);
    assert.ok(second.rehydratedState, 'تقريرُ الإرجاع يُعلن ولا يُخفى');
    // العددُ يُقابل بما كان لا برقمٍ مُثبَّت: تأسيسُ الأرضية يُثبت قيودًا أيضًا (إصدارُ الوحدة).
    assert.equal(second.rehydratedState!.ledgerEntries, balanceBefore.entries);
    assert.ok(balanceBefore.entries >= 2, 'قيدانا القياس ضمن ما أُثبت');
    assert.equal(second.rehydratedState!.contracts, 1);
    assert.equal(second.rehydratedState!.population, 3);
    assert.deepEqual(second.rehydratedState!.silent, []);

    const balanceAfter = second.ledger.trialBalance();
    assert.equal(balanceAfter.entries, balanceBefore.entries);
    assert.equal(balanceAfter.debits, balanceBefore.debits);
    assert.equal(balanceAfter.balanced, true, 'دفترٌ يرجع غير متوازن لا يُقلع عليه');
    assert.ok(second.ledger.entry('entry:2'), 'القيدُ بعينه موجود لا مجموعُه فقط');
    assert.equal(second.contracts.report(T0 + 1000).signed, 1);
    assert.equal(second.population.population, 3);
    assert.ok(second.population.get('agent:durable-2'), 'الهويّةُ بعينها ترجع');
    // الحساباتُ السياديّة الثلاثة تُفتح في التأسيس **قبل** ربط الوسيط، فلا تُدوَّن أصلًا
    // — وهذا مقصود: فتحُها حتميٌّ في كل إقلاع، وتدوينُها تكرارٌ بلا فائدة. ولذلك
    // `restore` يدمج ولا يستبدل، فالقيودُ المُرجَعة تجد حسابَها قائمًا (وإلّا رُفض الإرجاع).
    assert.ok(second.rehydratedState!.ledgerAccounts >= 1, 'حسابٌ فُتح بعد الربط يُدوَّن ويُرجَع');
    assert.ok(second.rehydratedState!.ledgerAccounts < 3, 'وحساباتُ التأسيس الثلاثة لا تُدوَّن');
    assert.ok(balanceAfter.accounts >= 3, 'ومع ذلك هي قائمةٌ في الدفتر المُرجَع — دمجٌ لا استبدال');
    second.journal?.close();
  } finally { s.clean(); }
});

test('إنهاءُ العقد ينجو: إقلاعٌ ثانٍ لا يُحيي التزامًا أنهاه التاج', () => {
  const s = scene();
  try {
    const first = s.boot();
    ground(first);
    const contractId = signOne(first);
    const terminated = first.contractTermination.terminate(
      first.king.issueCommand('open_external_account', contractId, { kind: 'external' }, T0 + 10),
      contractId, 'authority:crown_guard', 'قطع معلن لسبب موثَّق', T0 + 10,
    );
    assert.equal(terminated.ok, true);
    first.journal?.close();

    const second = s.boot(T0 + 1000);
    const report = second.contracts.report(T0 + 1000);
    assert.equal(report.active, 0, 'المنتهي ليس قائمًا');
    assert.equal(report.terminated, 1, 'وهو محفوظٌ منتهيًا لا محذوفًا');
    assert.equal(second.rehydratedState!.contracts, 1, 'العقدُ مُرجَعٌ بحالته المنتهية لا محذوف');
    const restored = second.contracts.exportAll().contracts.find((c) => c.contractId === contractId);
    assert.ok(restored);
    assert.equal(restored!.terminatedAt, T0 + 10);
    second.journal?.close();
  } finally { s.clean(); }
});

test('إنهاءُ السكان ينجو: هويّةٌ أُنهيت لا تعود بحصّتها', () => {
  const s = scene();
  try {
    const first = s.boot();
    first.population.registerBatch(
      first.king.issueCommand('create_agent', 'population:durable', {}, T0), population(3), T0,
    );
    const killed = first.population.terminateAll();
    assert.equal(killed, 3);
    first.journal?.close();

    const second = s.boot(T0 + 1000);
    assert.equal(second.population.population, 0, 'المنتهي لا يُحيا بإقلاع');
    assert.equal(second.rehydratedState!.populationTerminated, 3);
    second.journal?.close();
  } finally { s.clean(); }
});

test('الإرجاعُ لا يُدوَّن ثانيةً: اليوميّةُ لا تتضاعف مع كل إقلاع', () => {
  const s = scene();
  try {
    const first = s.boot();
    ground(first);
    signOne(first);
    assert.equal(postEntry(first, 'entry:1', 1_000).ok, true);
    first.population.registerBatch(
      first.king.issueCommand('create_agent', 'population:durable', {}, T0), population(2), T0,
    );
    const countOf = (state: State, kind: string): number =>
      state.journal!.read().filter((entry) => entry.kind === kind).length;
    const ledgerFirst = countOf(first, 'ledger_entry');
    const contractsFirst = countOf(first, 'contract_record');
    const batchesFirst = countOf(first, 'population_batch');
    first.journal?.close();

    const second = s.boot(T0 + 1000);
    // الإقلاعُ الثاني يفتح الحسابات السياديّة الثلاثة قبل ربط الوسيط، فلا تُدوَّن
    assert.equal(countOf(second, 'ledger_entry'), ledgerFirst, 'لا قيدَ دفترٍ مكرَّر');
    assert.equal(countOf(second, 'contract_record'), contractsFirst, 'لا عقدَ مكرَّر');
    assert.equal(countOf(second, 'population_batch'), batchesFirst, 'لا دفعةَ مكرَّرة');
    second.journal?.close();
  } finally { s.clean(); }
});

test('بلا مجلدِ يوميّةٍ لا إرجاعَ ولا دعوى: التقريرُ null صريحًا', () => {
  const bare = bootstrapState({ now: T0 });
  assert.equal(bare.journal, null);
  assert.equal(bare.rehydratedState, null);
});

test('حصصُ الموارد تُحجز مع إرجاع السكان: لا سكانٌ بلا حصّة', () => {
  const s = scene();
  try {
    const first = s.boot();
    first.population.registerBatch(
      first.king.issueCommand('create_agent', 'population:durable', {}, T0), population(3), T0,
    );
    first.journal?.close();
    const second = s.boot(T0 + 1000);
    // الحجزُ يرفض تكرارَ الهويّة، فمحاولةُ تسجيلها ثانيةً تُرفض — وهي شاهدُ الحجز.
    const again = second.population.registerBatch(
      second.king.issueCommand('create_agent', 'population:durable', {}, T0 + 1000),
      population(3), T0 + 1000,
    );
    assert.equal(again.ok, false, 'هويّةٌ محجوزةٌ لا تُسجَّل ثانيةً');
    second.journal?.close();
  } finally { s.clean(); }
});
