/**
 * src/data/persistence.ts — الثبات العام: يوميّة دائمة تنجو من إعادة التشغيل (المرحلة 39، البند T-27)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: قيود لحظة الكتابة من السجل الأبدي والذاكرة والمعرفة (النطاق معلن في config/persistence.yaml)
 * المخرجات: ملف يوميّة مضافٍ إليه فقط، كل قيدٍ فيه مربوط ببصمة سابقه، وإقلاعٌ يعيد الحالة من الصفر
 * التبعيات: نظام الملفات وcrypto وتهيئة الثبات — ولا وحدة حالة واحدة (الأنواع فقط، بلا حلقة استيراد)
 * الصلاحيات: التدوين والقراءة فقط. لا تُصلح اليوميّة حالةً ولا تكتب في سجل التدقيق قيدًا لكل كتابة
 *            (وإلا لدارت: السجل يُدوَّن هنا، فلو دوّنّا في السجل لكل تدوين لما توقّفت السلسلة).
 * السجلات: state_rehydrated / state_rehydrate_empty — تُكتب مرة واحدة عند الإقلاع لا لكل قيد
 * حالات الفشل (كلها مغلقة):
 *   - قيدٌ لا تطابق بصمته محتواه أو لا يشير إلى سابقه ⇒ PERSISTENCE_JOURNAL_TAMPERED
 *   - سطرٌ غير قابل للتحليل ⇒ PERSISTENCE_JOURNAL_CORRUPT
 *   - تجاوز الحدّ المعلن للقيود ⇒ PERSISTENCE_JOURNAL_FULL
 *   - سلسلة سجل مستعادة فاسدة ⇒ PERSISTENCE_AUDIT_INVALID
 * اختبارات الوحدة: tests/data/persistence.test.ts
 * اختبار القبول: tests/data/durable_rehydrate.test.ts و tests/recovery/restart_durability.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0024-durable-persistence.md
 * ثوابت هذه الوحدة:
 *   1) **الإضافة فقط**: لا سطر يُحدَّث ولا يُحذف. التصحيح قيدٌ لاحق يعلو سابقه عند الإرجاع.
 *   2) **البصمة متسلسلة**: كل قيد يحمل بصمة سابقه، فحذف سطرٍ من الوسط يُكتشف لا يُبتلع.
 *   3) **المزامنة قبل الإقرار**: `fsync` بعد كل قيد؛ فوعد النجاة لا يُوفى بذاكرة نظام الملفات.
 *   4) **النطاق يُنفَّذ ولا يُسكَت عنه**: صنفٌ خارج `scope` لا يُدوَّن أصلًا — التهيئة تحكم لا
 *      الشفرة، فلا رميَ. لكنّ الإسقاط **يُعَدّ بحسب الصنف** ويُقرأ من `droppedByKind()`
 *      (W-2026-040): عائدُ `null` يُهمله المنادونَ، فلولا العدّاد لظنّت الوحدةُ أنّها دوّنت.
 *   5) **الإرجاع لا يُدوَّن مرتين**: يُختصر إلى لقطةٍ ثم يُسلَّم لـ`importAll` الذرّي القائم.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../kernel/types';
import type { AuditEntry, EntityId } from '../kernel/types';
import type { DurableKind, PersistenceConfig } from '../kernel/config/persistence';
import { JournalDropLedger } from './journal_drops';
import { assertExemptionsHold, assertRehydrateCensus } from './rehydrate_census';
import type { AppendOnlyLog } from '../audit/append_only_log';
import type { AgentMemory, MemoryRecord } from './agent_memory';
import type { Fact, KnowledgeGraph } from './knowledge_graph';
import type { TerminationRoll } from '../kernel/termination_roll';

export type { DurableKind };

/** قيد اليوميّة: بيانٌ واحد مربوط ببصمة سابقه */
export interface DurableRecord {
  readonly seq: number;
  readonly at: number;
  readonly kind: DurableKind;
  readonly payload: unknown;
  readonly prevHash: string;
  readonly hash: string;
}

/**
 * ما تراه وحدات الحالة من اليوميّة: دالّة تدوين واحدة. الوحدات لا تعرف ملفًا ولا مسارًا،
 * فلا تصير الذاكرة والمعرفة رهينةَ نظام ملفات، ويبقى الاختبار بمزيّف سطرين.
 */
export interface DurableSink {
  record(kind: DurableKind, payload: unknown, at?: number): DurableRecord | null;
}

export interface JournalPolicy {
  readonly directory: string;
  readonly file: string;
  readonly fsync: boolean;
  readonly verifyOnBoot: boolean;
  readonly maxRecords: number;
  readonly scope: readonly DurableKind[];
}

export interface JournalVerification {
  readonly valid: boolean;
  readonly length: number;
  readonly brokenAt: number | null;
  readonly reason: string | null;
}

const GENESIS = 'genesis';

/**
 * بصمةُ الأصل المعلنة — تُصدَّر ليبنيَ ضاغطُ اليوميّة (T-121) سلسلةً بالقاعدة نفسها،
 * فلا تُحسب البصمة بقاعدتين ولا تُنسخ الصيغة نسخًا يفترق عن أصله بعد تعديل.
 */
export const JOURNAL_GENESIS = GENESIS;

function hashRecord(base: Omit<DurableRecord, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(base), 'utf8').digest('hex');
}

/** تُصدَّر لدالّة الضغط وحدها: من يُعيد بناء السلسلة يجب أن يبصمها ببصمة قارئها */
export function hashDurableRecord(base: Omit<DurableRecord, 'hash'>): string {
  return hashRecord(base);
}

/** اليوميّة الدائمة — وسيطٌ يُضاف إليه فقط، يفتح مرةً ويُزامن لكل قيد */
export class StateJournal implements DurableSink {
  private readonly path: string;
  private readonly scope: ReadonlySet<DurableKind>;
  /**
   * دفترُ ما أُسقط لخروجه عن النطاق (الثابت 4 · W-2026-040).
   *
   * **وحدةٌ مُستقلّةٌ لا حقلٌ هنا** لأنّ سلطتَها غيرُ سلطةِ اليوميّة: اليوميّةُ تُدوّن
   * ما دخلَ النطاقَ في سلسلةٍ مبصومة، والدفترُ يعدُّ ما رُدَّ على البابِ في ملفٍّ
   * لا بصمةَ له. ودمجُهما كان يُقرِّب رقمًا غيرَ محروسٍ من سلسلةٍ محروسة.
   * انظر `src/data/journal_drops.ts` لعيبِ المراجعةِ الذي أوجبَه وحدِّه المُعلَن.
   */
  private readonly drops: JournalDropLedger;
  private fd: number | null = null;
  private seq = 0;
  private lastHash = GENESIS;

  constructor(private readonly policy: JournalPolicy) {
    this.path = join(policy.directory, policy.file);
    this.drops = new JournalDropLedger(`${this.path}.drops.json`);
    this.scope = new Set(policy.scope);
    mkdirSync(policy.directory, { recursive: true });
    if (existsSync(this.path)) {
      const existing = this.readInternal(policy.verifyOnBoot);
      this.seq = existing.length;
      this.lastHash = existing.length > 0 ? existing[existing.length - 1]!.hash : GENESIS;
    }
  }

  /** مسار الملف المعلن — للقياس والتقارير لا للكتابة من الخارج */
  get file(): string {
    return this.path;
  }

  get length(): number {
    return this.seq;
  }

  /** هل هذا الصنف مشمول بالنطاق المعلن؟ الجواب تهيئة لا شفرة */
  covers(kind: DurableKind): boolean {
    return this.scope.has(kind);
  }

  /** مجموعُ ما أُسقط خارج النطاق — عبرَ الإقلاعاتِ لا في إقلاعٍ واحد */
  get droppedOutOfScope(): number {
    return this.drops.total;
  }

  /** تفصيلُ المُسقَط بحسب الصنف: نسخةٌ للقراءة، فلا يُصلح الخارجُ عدّادًا */
  droppedByKind(): ReadonlyMap<DurableKind, number> {
    return this.drops.byKind();
  }

  /** مسارُ دفترِ الإسقاطِ المعلن — للقياس لا للكتابة من الخارج */
  get dropLedgerFile(): string {
    return this.drops.file;
  }

  record(kind: DurableKind, payload: unknown, at = Date.now()): DurableRecord | null {
    if (!this.scope.has(kind)) {
      // العدُّ والتثبيتُ فعلٌ واحدٌ في الدفتر لا مؤجَّلٌ إلى ماسحٍ قد لا يُشغَل (RULE-007)
      this.drops.count(kind);
      return null;
    }
    if (this.seq >= this.policy.maxRecords) {
      throw new SovereignViolation(
        `تجاوز حدّ قيود اليوميّة المعلن (${this.policy.maxRecords})`,
        'PERSISTENCE_JOURNAL_FULL',
      );
    }
    const base = { seq: this.seq + 1, at, kind, payload, prevHash: this.lastHash };
    const entry: DurableRecord = { ...base, hash: hashRecord(base) };
    if (this.fd === null) this.fd = openSync(this.path, 'a');
    writeSync(this.fd, `${JSON.stringify(entry)}\n`, null, 'utf8');
    if (this.policy.fsync) fsyncSync(this.fd);
    this.seq = entry.seq;
    this.lastHash = entry.hash;
    return entry;
  }

  /**
   * قراءة اليوميّة بعد التحقق — تُستخدم في الإقلاع وفي القياس المستقل. **والحصرُ قبلَها**
   * (W-2026-040 · الجولةُ السابعة): كلُّ مسلكِ إرجاعٍ يقرأ من هنا، فلا يُعادُ قيدٌ قبلَ أن
   * يُبرهَنَ لكلِّ صنفٍ في النطاقِ مستهلكٌ أو إعفاء — أيًّا كانت صيغةُ تعطيلِ نداءِ الإقلاع.
   *
   * **والجولةُ الثامنة** (عييبُ gpt المُجمَّعُ عليه عندَ grok
   * `EXEMPTION_RUNTIME_GUARD_NOT_DOMINATING_ALL_REHYDRATION_PATHS`): تكذيبُ الإعفاءِ
   * («لا مُنتِجَ له») صار **هنا** عندَ نقطةِ القراءةِ المشتركةِ نفسِها لا داخلَ مسلكِ
   * إرجاعٍ واحدٍ — فحذفُ نداءِ ذلك المسلكِ من الإقلاعِ لم يعد يُبقي القيدَ المكتوبَ
   * للمُعفى يُقرأُ صامتًا عبرَ مسالكِ الإرجاعِ الأخرى: كلُّ قارئٍ للقيودِ يمرُّ بهذا
   * الحارسِ أو لا يقرأُ شيئًا.
   */
  read(): readonly DurableRecord[] {
    assertRehydrateCensus([...this.scope]);
    const entries = existsSync(this.path) ? this.readInternal(true) : [];
    assertExemptionsHold(entries.map((e) => e.kind));
    return entries;
  }

  /** تحقق لا يرفع استثناء — لتقارير التدقيق التي تريد الرقم لا التوقف */
  verify(): JournalVerification {
    try {
      const entries = existsSync(this.path) ? this.readInternal(true) : [];
      return { valid: true, length: entries.length, brokenAt: null, reason: null };
    } catch (error) {
      const violation = error as { code?: string; message?: string; brokenAt?: number };
      return {
        valid: false,
        length: this.seq,
        brokenAt: typeof violation.brokenAt === 'number' ? violation.brokenAt : null,
        reason: violation.code ?? violation.message ?? 'PERSISTENCE_JOURNAL_TAMPERED',
      };
    }
  }

  /**
   * إعادة القراءة من القرص بعد تغييرٍ خارجي مشروع (الضغط وحده — T-121).
   * تُغلق الواصف المفتوح لأن الملف قد استُبدل تحته، ثم تُعيد ضبط التسلسل والبصمة
   * الأخيرة من الملف الجديد. من دونها يكتب القيد التالي فوق سلسلةٍ لم تعد قائمة.
   */
  reload(): number {
    this.close();
    if (!existsSync(this.path)) {
      this.seq = 0;
      this.lastHash = GENESIS;
      return 0;
    }
    const entries = this.readInternal(this.policy.verifyOnBoot);
    this.seq = entries.length;
    this.lastHash = entries.length > 0 ? entries[entries.length - 1]!.hash : GENESIS;
    return this.seq;
  }

  /** إغلاق الواصف — الدولة القائمة لا تُغلقه، والاختبارات والمقاييس تُغلقه */
  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  private readInternal(verify: boolean): readonly DurableRecord[] {
    const text = readFileSync(this.path, 'utf8');
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const out: DurableRecord[] = [];
    let prev = GENESIS;
    for (let i = 0; i < lines.length; i++) {
      let entry: DurableRecord;
      try {
        entry = JSON.parse(lines[i]!) as DurableRecord;
      } catch {
        throw new SovereignViolation(`سطر يوميّة غير قابل للتحليل عند ${i + 1}`, 'PERSISTENCE_JOURNAL_CORRUPT');
      }
      if (verify) {
        const { hash, ...base } = entry;
        if (entry.seq !== i + 1 || entry.prevHash !== prev || hashRecord(base) !== hash) {
          const violation = new SovereignViolation(
            `يوميّة محرَّفة عند القيد ${i + 1}`, 'PERSISTENCE_JOURNAL_TAMPERED',
          ) as SovereignViolation & { brokenAt: number };
          violation.brokenAt = i + 1;
          throw violation;
        }
      }
      prev = entry.hash;
      out.push(entry);
    }
    return out;
  }

  /** بناء اليوميّة من التهيئة المعلنة، مع سماحٍ بمجلدٍ بديل للقياس والاختبار */
  static fromConfig(config: PersistenceConfig, directory?: string): StateJournal {
    const policy = config.policy;
    return new StateJournal({
      directory: directory ?? policy.journal_directory,
      file: policy.journal_file,
      fsync: policy.fsync_every_record,
      verifyOnBoot: policy.verify_chain_on_boot,
      maxRecords: policy.max_journal_records,
      scope: policy.scope,
    });
  }
}

/** وحدات الحالة التي يعيدها الإقلاع من اليوميّة */
export interface RehydrateTargets {
  readonly audit: AppendOnlyLog;
  readonly memory?: AgentMemory;
  readonly knowledge?: KnowledgeGraph;
  readonly terminationRoll?: TerminationRoll;
}

export interface RehydrateReport {
  readonly restored: boolean;
  readonly records: number;
  readonly auditEntries: number;
  readonly memoryRecords: number;
  readonly memoryShares: number;
  readonly facts: number;
  readonly terminations: number;
}

function seqOf(ids: readonly string[]): number {
  let max = 0;
  for (const id of ids) {
    const tail = id.slice(id.lastIndexOf(':') + 1);
    const value = Number(tail);
    if (Number.isSafeInteger(value) && value > max) max = value;
  }
  return max;
}

/**
 * الإقلاع من الصفر: يقرأ اليوميّة، يتحقق من سلسلتها، يختصرها إلى لقطةٍ واحدة لكل وحدة،
 * ثم يسلّمها لمسار `importAll` الذرّي القائم. لا يكتب هذا المسار قيدًا في اليوميّة لكل سجل
 * (وإلا تضاعفت اليوميّة كل إقلاع)، ويبقى قيد الاستعادة في السجل الأبدي كما هو مقرَّر.
 *
 * **ترتيب الربط مُلزم ومُعلن (RULE-008):** الوسيط يُربط بالسجل *بعد* استبدال السلسلة
 * المستعادة و*قبل* استيراد الذاكرة والمعرفة. لو رُبط قبل الاستبدال لدُوّنت قيود تأسيس هذه
 * العملية فوق سلسلةٍ ستُستبدل، ولو رُبط بعد الاستيراد لانقطع التسلسل بين ما في الذاكرة وما
 * في اليوميّة فتُرفض السلسلة في الإقلاع التالي. وفي اليوميّة الفارغة تُزرع السلسلة القائمة
 * كاملةً مرة واحدة، فلا يبدأ التسلسل المدوَّن من منتصفه.
 */
export function rehydrateFromJournal(
  journal: StateJournal,
  targets: RehydrateTargets,
  by: EntityId = 'ministry:data',
  options: { readonly rebuildTerminationRoll?: boolean } = {},
): RehydrateReport {
  const entries = journal.read();
  // الإعفاءُ «لا منتِج» دعوى تُقاسُ على المكتوبِ فعلًا لا على الشفرةِ وحدَها (الجولةُ السابعة)
  assertExemptionsHold(entries.map((e) => e.kind));
  const auditEntries: AuditEntry[] = [];
  const records = new Map<string, MemoryRecord>();
  const shares = new Map<string, Set<EntityId>>();
  const facts = new Map<string, Fact>();

  for (const entry of entries) {
    if (entry.kind === 'audit_entry') {
      auditEntries.push(entry.payload as AuditEntry);
    } else if (entry.kind === 'memory_record') {
      const record = entry.payload as MemoryRecord;
      records.set(record.recordId, record);
    } else if (entry.kind === 'memory_share') {
      const share = entry.payload as { recordId: string; reader: EntityId };
      const set = shares.get(share.recordId) ?? new Set<EntityId>();
      set.add(share.reader);
      shares.set(share.recordId, set);
    } else if (entry.kind === 'knowledge_fact') {
      const fact = entry.payload as Fact;
      facts.set(fact.factId, fact);
    }
  }

  if (entries.length === 0) {
    // زرع السلسلة القائمة كاملة: يوميّة تبدأ من منتصف السلسلة تُرفض في الإقلاع التالي.
    for (const entry of targets.audit.snapshot()) journal.record('audit_entry', entry, entry.at);
    targets.audit.attachSink(journal);
    targets.audit.append(by, 'state_rehydrate_empty', { journal: journal.file });
    return {
      restored: false, records: journal.length, auditEntries: 0,
      memoryRecords: 0, memoryShares: 0, facts: 0, terminations: 0,
    };
  }

  // السجل أولًا: كل استيراد بعده يكتب قيده في سلسلةٍ مستعادة لا في سلسلةٍ فارغة.
  if (auditEntries.length > 0) {
    targets.audit.replaceFrom(JSON.stringify(auditEntries));
    if (!targets.audit.verifyIntegrity().valid) {
      throw new SovereignViolation('سلسلة سجل مستعادة فاسدة', 'PERSISTENCE_AUDIT_INVALID');
    }
  }
  // الربط هنا بالضبط: بعد الاستبدال وقبل الاستيراد — ليكمل المدوَّن سلسلةً لا يقطعها.
  targets.audit.attachSink(journal);
  if (targets.memory) {
    targets.memory.importAll({
      records: [...records.values()],
      shares: [...shares.entries()].map(([id, readers]) => [id, [...readers]] as [string, readonly EntityId[]]),
      seq: seqOf([...records.keys()]),
    }, by);
  }
  if (targets.knowledge) {
    targets.knowledge.importAll({
      facts: [...facts.values()],
      seq: seqOf([...facts.keys()]),
    }, by);
  }
  let terminations = 0;
  if (targets.terminationRoll && options.rebuildTerminationRoll !== false) {
    terminations = targets.terminationRoll.rebuildFrom(targets.audit, by);
  }
  targets.audit.append(by, 'state_rehydrated', {
    journal: journal.file, records: entries.length, auditEntries: auditEntries.length,
    memoryRecords: records.size, facts: facts.size, terminations,
  });
  return {
    restored: true,
    records: entries.length,
    auditEntries: auditEntries.length,
    memoryRecords: records.size,
    memoryShares: [...shares.values()].reduce((sum, set) => sum + set.size, 0),
    facts: facts.size,
    terminations,
  };
}
