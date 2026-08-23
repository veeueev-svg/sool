/**
 * scripts/durability_scope_probe.ts — مسبارُ نطاق التدوين وسياسةِ الاحتفاظ (المرحلة 39، البندان T-122 وT-123)
 * المالك: وزارة البيانات | المدخلات: عددُ الهويّات المزروعة (اختياري) ومجلدُ يوميّةٍ مؤقّت
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًا في docs/audit/measurements/phase-39-T122-T123.txt
 * التبعيات: dist/src/index | الصلاحيات: لا يكتب في المستودع؛ كل مساره في tmpdir
 * السجلات: يعتمد على سجلات الوحدات — والمسبار لا يخترع قيدًا لنفسه
 * حالات الفشل: أي رفض سيادي يخرج بشفرة 1 برمزه — لا يُبتلع خطأ (RULE-007)
 * اختبارات الوحدة: tests/data/compaction_policy.test.ts
 * اختبار القبول: tests/data/rehydrate_state.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0030-durability-scope-and-retention.md
 * ثوابت هذا الملف:
 *   1) **«قبل» و«بعد» في جريانٍ واحد**: يُقاس النطاقُ الضيّق (خمسةُ أصنافٍ كما كان)
 *      ثم النطاقُ الكامل (تسعةُ أصناف) على المهاد نفسه — فالمقارنةُ لا تُستدعى من ذاكرة.
 *   2) **الفقدُ يُقاس لا يُروى**: يُطبع ما فُقد من الدفتر والعقود والسكان في «قبل».
 *   3) **الكلفةُ تُطبع كما قيست**: عددُ القيود وحجمُ الملف وزمنُ التحقّق والإقلاع.
 *   4) **الاحتفاظُ يُبرهن عمليًّا**: يُنادى المحو على أرشيفٍ غيرِ مُغطّى فيُرفض، ثم على
 *      مُغطّى فيُقبل — الدعوى «لا يمحو شاهدًا» تُختبر لا تُعلن.
 */
import {
  cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../src/index';
import { pruneArchives, shouldCompact } from '../src/data/compaction_policy';
import { compactJournal } from '../src/data/journal_compaction';
import { loadPersistence } from '../src/kernel/config/persistence';

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const FOREIGN = 'ministry:foreign_affairs';
/** نطاقُ ما قبل T-122 حرفًا كما كان في التهيئة: ستةُ أصناف لا أكثر */
const NARROW = [
  'audit_entry', 'memory_record', 'memory_share', 'knowledge_fact', 'archive_snapshot',
  'journal_compacted',
];

type State = ReturnType<typeof bootstrapState>;

/** مهادٌ بتهيئةٍ منسوخة: نطاقُ التدوين يُبدَّل في الملف لا في الشفرة (RULE-005) */
function scene(scope: readonly string[] | null) {
  const root = mkdtempSync(join(tmpdir(), 'sool-durability-probe-'));
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
    config,
    boot: (now = T0): State => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

function ground(s: State, now = T0): void {
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
  s.unit.issue(royal('treasury:general'), 100_000_000, 'رأس مال معلن', now);
  s.budget.declare(royal('budget:foreign'), {
    line: 'budget:foreign', owner: FOREIGN, ceiling: 60_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now);
  s.externalAccounts.open(royalOpen('external:compute-provider'), {
    counterparty: 'external:compute-provider', expiresAt: now + 90 * DAY, requestedBy: FOREIGN,
    justification: 'تشغيل معلن',
  }, now);
  s.partnerRisk.assess({
    kindId: 'contract:compute-capacity', factors: [], assessedBy: 'authority:audit_bureau',
    justification: 'تقدير معلن',
  }, now);
  const signed = s.contracts.sign(royalOpen('contract:compute-capacity'), {
    kindId: 'contract:compute-capacity', value: 5_000_000, endsAt: now + 30 * DAY,
    proposedBy: FOREIGN, purpose: 'تعهّد معلن',
  }, now);
  if (!signed.ok) throw new Error('PROBE_CONTRACT_FAILED');
}

/** بذرةٌ متطابقة في الحالتين: قيودٌ في الدفتر ودفعتا سكان */
function seed(s: State, entries: number, identities: number, now = T0): void {
  for (let i = 0; i < entries; i++) {
    const posted = s.ledger.post({
      entryId: `probe:${i}`, memo: `قيد قياس ${i}`, by: 'ministry:finance',
      lines: [
        { account: 'treasury:general', debit: 1_000 },
        { account: 'revenue:levies', credit: 1_000 },
      ],
    }, now + i);
    if (!posted.ok) throw new Error(`PROBE_ENTRY_FAILED:${posted.reason}`);
  }
  const batch = Array.from({ length: identities }, (_, i) => ({
    agentId: `agent:probe-${i + 1}`, owner: 'ministry:infrastructure',
    resourceQuota: 'identity_slots:1',
  }));
  const registered = s.population.registerBatch(
    s.king.issueCommand('create_agent', 'population:probe', {}, now), batch, now,
  );
  if (!registered.ok) throw new Error('PROBE_BATCH_FAILED');
}

/** يقيس دولتين متعاقبتين على نطاقٍ مُعطى ويطبع ما نجا وما فُقد */
function measure(label: string, scope: readonly string[] | null, entries: number, identities: number): void {
  const s = scene(scope);
  try {
    const first = s.boot();
    ground(first);
    seed(first, entries, identities);
    const before = {
      entries: first.ledger.trialBalance().entries,
      contracts: first.contracts.report(T0).signed,
      population: first.population.population,
      records: first.journal?.read().length ?? 0,
      bytes: first.journal ? statSync(first.journal.file).size : 0,
    };
    first.journal?.close();

    const startedAt = Date.now();
    const second = s.boot(T0 + 1000);
    const bootMs = Date.now() - startedAt;
    const after = {
      entries: second.ledger.trialBalance().entries,
      contracts: second.contracts.report(T0 + 1000).signed,
      population: second.population.population,
    };
    const verifyStarted = Date.now();
    const valid = second.journal?.verify().valid ?? false;
    const verifyMs = Date.now() - verifyStarted;

    console.log(`── ${label} ──`);
    console.log(`  أصنافُ النطاق: ${(scope ?? second.persistenceConfig.policy.scope).length}`);
    console.log(`  قيودُ اليوميّة: ${before.records} · حجمُها: ${before.bytes}B`
      + ` · لكل قيد: ${before.records > 0 ? (before.bytes / before.records).toFixed(1) : 0}B`);
    console.log(`  الدفتر: ${before.entries} قيدًا ⇒ ${after.entries} بعد الإقلاع`
      + ` (فُقد ${before.entries - after.entries})`);
    console.log(`  العقود: ${before.contracts} ⇒ ${after.contracts}`
      + ` (فُقد ${before.contracts - after.contracts})`);
    console.log(`  السكان: ${before.population} ⇒ ${after.population}`
      + ` (فُقد ${before.population - after.population})`);
    console.log(`  زمنُ الإقلاع مع الإرجاع: ${bootMs}ms · تحقُّقُ السلسلة: ${verifyMs}ms · صحيحة: ${valid}`);
    const report = second.rehydratedState;
    console.log(`  تقريرُ الإرجاع: ${report === null ? 'لا يوجد' : JSON.stringify(report)}`);
    second.journal?.close();
  } finally { s.clean(); }
}

/** يبرهن سياسةَ الاحتفاظ عمليًّا: رفضٌ بلا شاهد ثم قبولٌ معه (ثابت 4) */
function retention(): void {
  const s = scene(null);
  try {
    const state = s.boot();
    const journal = state.journal;
    if (!journal) throw new Error('PROBE_NO_JOURNAL');
    const config = loadPersistence(s.config);
    for (let i = 0; i < 6; i++) {
      state.memory.write('agent:probe-1', {
        content: `محتوى ${i}`, provenance: { kind: 'tool_call', ref: `probe:${i}` },
        retentionClass: 'official',
      }, T0 + i);
    }
    const verdict = shouldCompact(journal, config.compaction, T0 + 10);
    console.log('── سياسةُ مناداة الضغط (T-123) ──');
    console.log(`  العتبةُ المعلنة: ${verdict.threshold} · القيود: ${verdict.records}`
      + ` · الرأي: ${verdict.compact ? 'اضغط' : 'لا تضغط'} — ${verdict.reason}`);
    console.log(`  الفاصلُ الأدنى المعلن: ${verdict.minIntervalMs}ms`
      + ` · آخرُ ضغطٍ مشهودٌ في الملف: ${verdict.lastCompactedAt ?? 'لم تُضغط قطّ'}`);

    // أربعُ ضغطاتٍ ⇒ أربعةُ أرشيفات: أحدثُ اثنين محميّان بـkeep_min، والأقدمان يُفحصان.
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 3; i++) {
        state.memory.write('agent:probe-1', {
          content: `دورة ${round} محتوى ${i}`,
          provenance: { kind: 'tool_call', ref: `probe:${round}:${i}` },
          retentionClass: 'official',
        }, T0 + 100 * round + i);
      }
      compactJournal(journal, T0 + 100 * round + 50);
    }
    // نُزيّف أقدمَ أرشيفٍ بقيدٍ لا شاهدَ له في اليوميّة، فالمحوُ يجب أن يرفضه وحده.
    const names = readdirSync(join(s.config, '..', 'state'))
      .filter((name) => name.endsWith('.archive'))
      .sort((left, right) => Number(left.split('.')[2]) - Number(right.split('.')[2]));
    const oldest = join(s.config, '..', 'state', names[0] ?? '');
    writeFileSync(oldest, `${JSON.stringify({
      seq: 1, at: T0, kind: 'audit_entry', payload: { actor: 'شاهدٌ مفقود' },
      prevHash: 'x', hash: 'y',
    })}\n`, 'utf8');
    const forged = pruneArchives(journal, config.archives, Date.now() + 365 * DAY);
    console.log('── احتفاظُ الأرشيفات (T-123) ──');
    console.log(`  أرشيفاتٌ فُحصت: ${forged.examined} · مُحيت: ${forged.pruned.length}`
      + ` · أُبقيت: ${forged.kept.length} · استُرجع: ${forged.reclaimedBytes}B`);
    for (const decision of forged.decisions) {
      console.log(`  · ${decision.file.split('/').pop()} (${decision.bytes}B): `
        + `${decision.pruned ? 'محو' : 'إبقاء'} — ${decision.reason}`);
    }
    const guard = { ...config.archives, require_witness_coverage: false };
    try {
      pruneArchives(journal, guard, Date.now());
      console.log('  حرسُ الشاهد مُعطَّلًا: لم يُرفض ⇐ عيبٌ');
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'غير-سيادي';
      console.log(`  حرسُ الشاهد مُعطَّلًا: رُفض برمز ${code}`);
    }
    journal.close();
  } finally { s.clean(); }
}

function main(): void {
  const entries = Number(process.argv[2] ?? 20);
  const identities = Number(process.argv[3] ?? 50);
  if (!Number.isSafeInteger(entries) || entries <= 0) throw new Error('PROBE_ARGS_INVALID');
  console.log(`مسبارُ الثبات — قيودُ دفترٍ مزروعة: ${entries} · هويّاتٌ في دفعةٍ واحدة: ${identities}`);
  console.log('');
  measure('قبل التوسيع: النطاقُ كما كان (حالةُ ما قبل T-122)', NARROW, entries, identities);
  console.log('');
  measure('بعد التوسيع: النطاقُ الكامل المعلن في التهيئة (T-122)', null, entries, identities);
  console.log('');
  retention();
}

main();
