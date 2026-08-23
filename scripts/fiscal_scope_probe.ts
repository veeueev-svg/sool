/**
 * scripts/fiscal_scope_probe.ts — مسبارُ ثباتِ الوحدات الماليّة والخارجيّة (المرحلة 39، البند T-125)
 * المالك: وزارة المالية + وزارة البيانات | المدخلات: مجلدُ تهيئةٍ منسوخٌ ويوميّةٌ في tmpdir
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًا في docs/audit/measurements/phase-39-T125.txt
 * التبعيات: dist/src/index | الصلاحيات: لا يكتب في المستودع؛ كل مساره في tmpdir
 * السجلات: يعتمد على سجلات الوحدات — والمسبار لا يخترع قيدًا لنفسه
 * حالات الفشل: أي رفض سيادي غيرِ متوقَّعٍ يخرج بشفرة 1 برمزه — لا يُبتلع خطأ (RULE-007)
 * اختبار القبول: tests/data/rehydrate_fiscal.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0031-fiscal-durability.md
 * ثوابت هذا الملف:
 *   1) **«قبل» و«بعد» في جريانٍ واحد**: تُقاس الحالتان على المهاد نفسه بالبذرة نفسها،
 *      فالمقارنةُ لا تُستدعى من ذاكرةِ جلسةٍ سابقة (RULE-001).
 *   2) **يُقاس أثرُ الفقد لا الفقدُ وحده**: بعد الإقلاع يُنادى صرفٌ جديد — فإن رُفض
 *      لتكرار معرّفٍ فذلك برهانُ أنّ العدّادَ المنسيَّ **يُعطّل الدولة** لا يُنقص تقريرًا.
 *   3) **الأرقامُ تُطبع كما قيست**: عددُ القيود وحجمُ الملف وزمنُ الإقلاع والتحقّق.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../src/index';

/** بعد إعلان نسب الجباية في config/economy.yaml (2026-08-22) — لا أثر رجعي */
const T0 = Date.parse('2026-08-23T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const FOREIGN = 'ministry:foreign_affairs';
const AUDIT = 'authority:audit_bureau';
/** نطاقُ ما قبل T-125 حرفًا: عشرةُ أصنافٍ كما أقرّها T-122 */
const NARROW = [
  'audit_entry', 'memory_record', 'memory_share', 'knowledge_fact', 'archive_snapshot',
  'journal_compacted', 'ledger_entry', 'contract_record', 'population_batch',
  'population_terminated',
];

type State = ReturnType<typeof bootstrapState>;

/** مهادٌ بتهيئةٍ منسوخة: نطاقُ التدوين يُبدَّل في الملف لا في الشفرة (RULE-005) */
function scene(scope: readonly string[] | null) {
  const root = mkdtempSync(join(tmpdir(), 'sool-fiscal-probe-'));
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

/** بذرةٌ ماليّةٌ متطابقة: إصدارٌ وحرقٌ وبندٌ وصرفٌ وجبايةٌ وحسابٌ ودفعةٌ وتقديرٌ وخرق */
function seed(s: State, now = T0): void {
  const royal = (t: string) => s.king.issueCommand('amend_policy', t, { kind: 'external' }, now);
  const royalOpen = (t: string) => s.king.issueCommand('open_external_account', t, { kind: 'external' }, now);

  s.ministries.establish(royal(FOREIGN), {
    ministryId: FOREIGN, name: 'وزارة الخارجية', mandate: ['foreign_affairs'],
    proposedBy: 'authority:royal_court',
  }, now);
  for (const cp of s.externalConfig.counterparties) {
    s.egress.declare(royalOpen(cp.host), {
      host: cp.host, port: cp.port, purpose: cp.purpose,
      expiresAt: now + 60 * DAY, maxCallsPerMinute: 60,
    }, now);
  }

  // 1) وحدةٌ رقميّة: إصدارٌ ثم حرقٌ — عدّادان لا يُشتقّان من التهيئة
  const issued = s.unit.issue(royal('economy:unit'), 100_000_000, 'رأس مال معلن', now);
  if (!issued.ok) throw new Error(`PROBE_ISSUE_FAILED:${issued.reason}`);
  const burned = s.unit.burn(royal('economy:unit'), 4_000_000, 'سحبٌ معلن', now + 1);
  if (!burned.ok) throw new Error(`PROBE_BURN_FAILED:${burned.reason}`);

  // 2) بندُ موازنةٍ ثم صرفٌ عليه: البندُ والمصروفُ حالتان متراكمتان
  const declared = s.budget.declare(royal('budget:foreign'), {
    line: 'budget:foreign', owner: FOREIGN, ceiling: 60_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now);
  if (!declared.ok) throw new Error(`PROBE_BUDGET_FAILED:${declared.reason}`);
  const paidTo = 'expense:operations';
  if (!s.ledger.hasAccount(paidTo)) {
    const opened = s.ledger.openAccount(paidTo, 'expense', 'مصروفات تشغيل', now);
    if (!opened.ok) throw new Error(`PROBE_ACCOUNT_FAILED:${opened.reason}`);
  }
  const disbursed = s.treasury.disburse({
    line: 'budget:foreign', amount: 1_500_000, to: paidTo,
    purpose: 'تشغيلٌ معلن', by: 'ministry:finance',
  }, now + 2);
  if (!disbursed.ok) throw new Error(`PROBE_DISBURSE_FAILED:${disbursed.reason}`);

  // 3) جبايةٌ ثم تحصيلُها: حالةُ الالتزام تُحدَّث ولا تُشتقّ
  const assessed = s.revenue.assess('compute_usage', FOREIGN, 2_000_000, now + 3, now + 4);
  if (!assessed.ok) throw new Error(`PROBE_LEVY_FAILED:${assessed.reason}`);
  const collected = s.revenue.collect(assessed.levy.levyId, now + 5);
  if (!collected.ok) throw new Error(`PROBE_COLLECT_FAILED:${collected.reason}`);

  // 4) حسابٌ خارجيٌّ مفتوحٌ بأمرٍ ثم دفعةٌ عليه: كلاهما فعلٌ لا تهيئة
  const account = s.externalAccounts.open(royalOpen('external:compute-provider'), {
    counterparty: 'external:compute-provider', expiresAt: now + 90 * DAY, requestedBy: FOREIGN,
    justification: 'تشغيل معلن',
  }, now);
  if (!account.ok) throw new Error(`PROBE_EXTERNAL_FAILED:${account.reason}`);
  const payment = s.payments.pay({
    accountId: account.account.accountId, amount: 300_000, line: 'budget:foreign',
    purpose: 'سعةُ حسابٍ معلنة', requestedBy: FOREIGN,
  }, now + 6);
  if (!payment.ok) throw new Error(`PROBE_PAYMENT_FAILED:${payment.reason}`);

  // 5) تقديرُ خطرٍ ثم خرقٌ مقيَّد: سلسلةٌ تُضاف ولا تُمحى
  const risk = s.partnerRisk.assess({
    kindId: 'contract:compute-capacity', factors: [], assessedBy: AUDIT,
    justification: 'تقدير معلن',
  }, now);
  if (!risk.ok) throw new Error(`PROBE_RISK_FAILED:${risk.reason}`);
  s.partnerRisk.noteBreach(AUDIT, 'external:compute-provider', 'تأخُّرُ سعةٍ معلن', now + 7);
}

interface Fiscal {
  disbursements: number; totalDisbursed: number; frozen: boolean;
  budgetLines: number; budgetSpent: number;
  levies: number; collected: number;
  issued: number; burned: number;
  accounts: number; payments: number; paid: number;
  assessments: number; breaches: number;
}

function read(s: State, now: number): Fiscal {
  const treasury = s.treasury.report();
  const budget = s.budget.report();
  const revenue = s.revenue.report();
  const unit = s.unit.report();
  const accounts = s.externalAccounts.report(now);
  const payments = s.payments.report(now);
  const risk = s.partnerRisk.report(now);
  return {
    disbursements: treasury.disbursements, totalDisbursed: treasury.totalDisbursed,
    frozen: treasury.frozen,
    budgetLines: budget.active, budgetSpent: budget.spent,
    levies: revenue.assessed + revenue.collected + revenue.waived, collected: revenue.collectedTotal,
    issued: unit.issued, burned: unit.burned,
    accounts: accounts.opened, payments: payments.payments, paid: payments.totalPaid,
    assessments: s.partnerRisk.history().length,
    breaches: s.partnerRisk.breachCount('external:compute-provider'),
  };
}

/** ثابت 2: بعد الإقلاع يُنادى صرفٌ جديد — فرفضُه أو قبولُه بمعرّفٍ مكرَّر كلاهما دليل */
function probeDisburseAfterBoot(s: State, now: number): string {
  const result = s.treasury.disburse({
    line: 'budget:foreign', amount: 1_000, to: 'expense:operations',
    purpose: 'صرفٌ بعد الإقلاع', by: 'ministry:finance',
  }, now);
  if (result.ok) return `مقبول — المعرّف ${result.disbursement.disbursementId}`;
  return `مرفوض — ${result.reason}`;
}

/**
 * ثابت 2 مكمَّلًا: السقفُ المستهلَكُ في الدفتر — هل يُعاد تعبئتُه بإقلاع؟
 * يُعاد إعلانُ البند نفسِه بالسقف نفسِه، ثم يُقابَل المتاحُ فيه بما يشهد الدفترُ أنه صُرف.
 */
function probeCeilingRefill(s: State, now: number): string {
  // الوزارةُ نفسُها ليست في نطاق T-125 (سجلُّ الوزارات مشتقٌّ كذلك — دَينٌ يُعلن لا يُخفى)،
  // فتُعاد إقامتُها هنا حتى يكون المقيسُ **بندَ الموازنة** لا صاحبَه.
  const establish = s.king.issueCommand('amend_policy', FOREIGN, { kind: 'external' }, now);
  s.ministries.establish(establish, {
    ministryId: FOREIGN, name: 'وزارة الخارجية', mandate: ['foreign_affairs'],
    proposedBy: 'authority:royal_court',
  }, now);
  const royal = s.king.issueCommand('amend_policy', 'budget:foreign', { kind: 'external' }, now);
  const declared = s.budget.declare(royal, {
    line: 'budget:foreign', owner: FOREIGN, ceiling: 60_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now);
  const spentInLedger = s.ledger.balance('expense:operations');
  if (!declared.ok) {
    return `إعلانُ البند ثانيةً مرفوض (${declared.reason}) · والدفترُ يشهد بصرفِ ${spentInLedger}`;
  }
  return `متاحٌ في البند بعد الإقلاع: ${s.budget.available('budget:foreign')}`
    + ` · والدفترُ يشهد بصرفِ ${spentInLedger} من قبل`
    + ` · المستهلَكُ المعلن: ${s.budget.report().spent}`;
}

function measure(label: string, scope: readonly string[] | null): void {
  const s = scene(scope);
  try {
    const first = s.boot();
    seed(first);
    const before = read(first, T0 + 10);
    const records = first.journal?.read().length ?? 0;
    const bytes = first.journal ? statSync(first.journal.file).size : 0;
    first.journal?.close();

    const startedAt = Date.now();
    const second = s.boot(T0 + 1000);
    const bootMs = Date.now() - startedAt;
    const after = read(second, T0 + 1010);
    const verifyStarted = Date.now();
    const valid = second.journal?.verify().valid ?? false;
    const verifyMs = Date.now() - verifyStarted;
    const collision = probeDisburseAfterBoot(second, T0 + 1020);

    console.log(`── ${label} ──`);
    console.log(`  أصنافُ النطاق: ${(scope ?? second.persistenceConfig.policy.scope).length}`);
    console.log(`  قيودُ اليوميّة: ${records} · حجمُها: ${bytes}B`
      + ` · لكل قيد: ${records > 0 ? (bytes / records).toFixed(1) : 0}B`);
    const rows: [string, number | boolean, number | boolean][] = [
      ['مصروفاتُ الخزينة (عددًا)', before.disbursements, after.disbursements],
      ['مجموعُ المصروف', before.totalDisbursed, after.totalDisbursed],
      ['بنودُ الموازنة القائمة', before.budgetLines, after.budgetLines],
      ['المستهلَكُ من البنود', before.budgetSpent, after.budgetSpent],
      ['التزاماتُ الجباية', before.levies, after.levies],
      ['المُحصَّلُ منها', before.collected, after.collected],
      ['المُصدَرُ من الوحدة', before.issued, after.issued],
      ['المحروقُ منها', before.burned, after.burned],
      ['الحساباتُ الخارجيّة', before.accounts, after.accounts],
      ['الدفعاتُ الخارجيّة', before.payments, after.payments],
      ['تقديراتُ الخطر', before.assessments, after.assessments],
      ['خروقُ الشريك المقيَّدة', before.breaches, after.breaches],
    ];
    for (const [name, b, a] of rows) {
      const lost = typeof b === 'number' && typeof a === 'number' ? ` (فُقد ${b - a})` : '';
      console.log(`  ${name}: ${b} ⇒ ${a}${lost}`);
    }
    console.log(`  صرفٌ جديدٌ بعد الإقلاع: ${collision}`);
    console.log(`  سقفُ الموازنة بعد الإقلاع: ${probeCeilingRefill(second, T0 + 1030)}`);
    console.log(`  زمنُ الإقلاع: ${bootMs}ms · تحقُّقُ السلسلة: ${verifyMs}ms · صحيحة: ${valid}`);
    const report = (second as { rehydratedFiscal?: unknown }).rehydratedFiscal;
    console.log(`  تقريرُ الإرجاع الماليّ: ${report === undefined || report === null ? 'لا يوجد' : JSON.stringify(report)}`);
    second.journal?.close();
  } finally { s.clean(); }
}

function main(): void {
  console.log('مسبارُ الثبات الماليّ (T-125) — بذرةٌ واحدةٌ في نطاقَين');
  console.log('');
  measure('قبل التوسيع: النطاقُ كما أقرّه T-122 (عشرةُ أصناف)', NARROW);
  console.log('');
  measure('بعد التوسيع: النطاقُ الكامل المعلن في التهيئة (T-125)', null);
}

main();
