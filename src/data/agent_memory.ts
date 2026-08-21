/**
 * src/data/agent_memory.ts — ذاكرة الوكلاء بنسب معلن (المرحلة 21)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: طلب كتابة من وكيل يحمل نسبًا معلنًا (أداة/استيراد/أمر/استنتاج) وصنف احتفاظ
 * المخرجات: سجل ذاكرة ثابت لا يُعدَّل، له بصمة ونسب وسلسلة إصدارات
 * التبعيات: السجل غير القابل للتعديل، أصناف الاحتفاظ، مفتاح الإيقاف
 * الصلاحيات: الوكيل يكتب في ذاكرته وحدها؛ ولا يقرأ ذاكرة غيره إلا بمشاركة معلنة
 * السجلات: memory_written / memory_write_refused / memory_read_denied /
 *           memory_revised / memory_shared / memory_tombstoned
 * ثوابت هذه الوحدة:
 *   1) لا ذاكرة بلا نسب: مصدر معلن ومرجع غير فارغ — وإلا رفض
 *   2) لا كتابة بصنف احتفاظ مجهول — التصنيف شرط كتابة لا مهمة تنظيف لاحقة
 *   3الذاكرة تُقرأ ولا تُعدَّل: التصحيح إصدار جديد يشير إلى سابقه ويبقيه
 *   4) عزل: وكيل لا يقرأ ذاكرة وكيل آخر إلا بمشاركة معلنة من مالكها
 *   5) ما جاء من مصدر غير موثوق يبقى موسومًا `untrusted` ولا يترقّى ضمنًا
 *   6) الشطب يزيل المحتوى ويبقي البصمة والنسب — الحذف يزيل المحتوى لا الأثر
 *   7) الإيقاف يمنع الكتابة ولا يمنع القراءة ولا الشطب
 *   8) سقف سجلات لكل وكيل — الذاكرة مورد محدود لا نافذة تضخّم
 * حالات الفشل (كلها مغلقة): نسب ناقص، صنف مجهول، تجاوز سقف، قراءة غير مخوَّلة
 * اختبار القبول: tests/data/agent_memory.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0005-memory-and-knowledge.md
 */
import { createHash } from 'node:crypto';
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { retentionClassIds } from './retention';

export type MemorySourceKind = 'tool_call' | 'import' | 'royal_order' | 'inference' | 'agent_message';
export type MemoryTrust = 'trusted' | 'untrusted';
export type MemoryClassification = 'public' | 'internal' | 'secret';

/** النسب: من أين جاءت هذه المعلومة، وبأي مرجع يمكن التحقق منها */
export interface MemoryProvenance {
  readonly kind: MemorySourceKind;
  /** مرجع قابل للتحقق: معرّف تدقيق أو معرّف أمر أو بصمة أثر */
  readonly ref: string;
}

/** المصادر التي لا تُعَدّ موثوقة بذاتها — كل ما جاء من خارج الدولة أو من وكيل آخر */
export const UNTRUSTED_SOURCE_KINDS: readonly MemorySourceKind[] = ['import', 'agent_message'];

export interface MemoryRecord {
  readonly recordId: string;
  readonly owner: EntityId;
  readonly content: string;
  readonly contentHash: string;
  readonly provenance: MemoryProvenance;
  readonly trust: MemoryTrust;
  readonly classification: MemoryClassification;
  readonly retentionClass: string;
  readonly createdAt: number;
  readonly version: number;
  readonly supersedes: string | null;
  readonly tombstoned: boolean;
  readonly tombstoneReason: string | null;
}

export interface MemoryWriteInput {
  readonly content: string;
  readonly provenance: MemoryProvenance;
  readonly retentionClass: string;
  readonly classification?: MemoryClassification;
  /** وسم عدم الثقة يدويًا — الترقية ممنوعة، والتخفيض مسموح دائمًا */
  readonly untrusted?: boolean;
}

export type MemoryWriteResult =
  | { readonly ok: true; readonly record: MemoryRecord; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface AgentMemoryDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch?: KillSwitch;
  readonly knownRetentionClasses?: readonly string[];
  readonly maxRecordsPerAgent?: number;
  readonly ministryId?: EntityId;
}

function hashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export class AgentMemory {
  private readonly records = new Map<string, MemoryRecord>();
  private readonly byOwner = new Map<EntityId, string[]>();
  private readonly shares = new Map<string, Set<EntityId>>();
  private readonly known: readonly string[];
  private readonly maxPerAgent: number;
  private readonly ministryId: EntityId;
  private seq = 0;

  constructor(private readonly deps: AgentMemoryDeps) {
    this.known = deps.knownRetentionClasses ?? retentionClassIds();
    this.maxPerAgent = deps.maxRecordsPerAgent ?? 256;
    this.ministryId = deps.ministryId ?? 'ministry:data';
  }

  write(owner: EntityId, input: MemoryWriteInput, now = Date.now()): MemoryWriteResult {
    const refuse = (reason: string): MemoryWriteResult => {
      const entry = this.deps.audit.append(owner, 'memory_write_refused', { reason });
      return { ok: false, reason, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch?.status;
    if (halt?.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      return refuse('الإيقاف مُشتغل — لا كتابة في الذاكرة');
    }
    if (!input.content.trim()) return refuse('محتوى فارغ مرفوض');
    if (!input.provenance || !input.provenance.ref.trim()) {
      return refuse('لا ذاكرة بلا نسب — مرجع المصدر مطلوب');
    }
    if (!this.known.includes(input.retentionClass)) {
      return refuse(`صنف احتفاظ مجهول: ${input.retentionClass}`);
    }
    const owned = this.byOwner.get(owner) ?? [];
    const alive = owned.filter((id) => !this.records.get(id)?.tombstoned);
    if (alive.length >= this.maxPerAgent) {
      return refuse(`تجاوز سقف سجلات الذاكرة (${this.maxPerAgent})`);
    }

    const trust: MemoryTrust =
      input.untrusted === true || UNTRUSTED_SOURCE_KINDS.includes(input.provenance.kind)
        ? 'untrusted'
        : 'trusted';

    this.seq += 1;
    const recordId = `mem:${owner}:${String(this.seq).padStart(5, '0')}`;
    const record: MemoryRecord = {
      recordId,
      owner,
      content: input.content,
      contentHash: hashOf(input.content),
      provenance: input.provenance,
      trust,
      classification: input.classification ?? 'internal',
      retentionClass: input.retentionClass,
      createdAt: now,
      version: 1,
      supersedes: null,
      tombstoned: false,
      tombstoneReason: null,
    };
    this.records.set(recordId, record);
    this.byOwner.set(owner, [...owned, recordId]);
    const entry = this.deps.audit.append(owner, 'memory_written', {
      recordId, source: input.provenance.kind, ref: input.provenance.ref,
      trust, retentionClass: input.retentionClass, hash: record.contentHash,
    });
    return { ok: true, record, auditId: entry.hash };
  }

  /**
   * التصحيح إصدار جديد لا تعديل: السجل السابق يبقى كما هو، والجديد يشير إليه.
   * ولا ترقية ثقة عبر التصحيح — ما جاء غير موثوق يبقى كذلك.
   */
  revise(recordId: string, content: string, by: EntityId, now = Date.now()): MemoryWriteResult {
    const refuse = (reason: string): MemoryWriteResult => {
      const entry = this.deps.audit.append(by, 'memory_revise_refused', { recordId, reason });
      return { ok: false, reason, auditId: entry.hash };
    };
    const prev = this.records.get(recordId);
    if (!prev) return refuse('سجل غير موجود');
    if (prev.owner !== by) return refuse('لا تصحيح لذاكرة وكيل آخر');
    if (prev.tombstoned) return refuse('سجل مشطوب — لا تصحيح بعد الشطب');
    if (!content.trim()) return refuse('محتوى فارغ مرفوض');

    this.seq += 1;
    const next: MemoryRecord = {
      ...prev,
      recordId: `mem:${prev.owner}:${String(this.seq).padStart(5, '0')}`,
      content,
      contentHash: hashOf(content),
      createdAt: now,
      version: prev.version + 1,
      supersedes: prev.recordId,
      provenance: { kind: 'inference', ref: prev.recordId },
      trust: prev.trust, // لا ترقية ثقة بالتصحيح
    };
    this.records.set(next.recordId, next);
    this.byOwner.set(prev.owner, [...(this.byOwner.get(prev.owner) ?? []), next.recordId]);
    const entry = this.deps.audit.append(by, 'memory_revised', {
      from: prev.recordId, to: next.recordId, version: next.version, hash: next.contentHash,
    });
    return { ok: true, record: next, auditId: entry.hash };
  }

  /** المشاركة معلنة وفردية — لا مشاركة جماعية ضمنية */
  share(recordId: string, owner: EntityId, reader: EntityId): boolean {
    const record = this.records.get(recordId);
    if (!record || record.owner !== owner) {
      this.deps.audit.append(owner, 'memory_share_refused', { recordId, reader });
      return false;
    }
    const set = this.shares.get(recordId) ?? new Set<EntityId>();
    set.add(reader);
    this.shares.set(recordId, set);
    this.deps.audit.append(owner, 'memory_shared', { recordId, reader });
    return true;
  }

  read(reader: EntityId, recordId: string): MemoryRecord | null {
    const record = this.records.get(recordId);
    if (!record) return null;
    const allowed =
      record.owner === reader ||
      reader === this.ministryId ||
      reader === 'authority:king' ||
      (this.shares.get(recordId)?.has(reader) ?? false);
    if (!allowed) {
      this.deps.audit.append(reader, 'memory_read_denied', { recordId, owner: record.owner });
      return null;
    }
    return record;
  }

  /** سلسلة الأصل: من الإصدار الحالي إلى أول سجل ومصدره الخارجي */
  lineage(recordId: string): readonly MemoryRecord[] {
    const chain: MemoryRecord[] = [];
    let cursor = this.records.get(recordId);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.recordId)) {
      seen.add(cursor.recordId);
      chain.push(cursor);
      cursor = cursor.supersedes ? this.records.get(cursor.supersedes) : undefined;
    }
    return chain;
  }

  /** الشطب: يزيل المحتوى ويبقي البصمة والنسب والسبب */
  tombstone(recordId: string, by: EntityId, reason: string, now = Date.now()): boolean {
    const record = this.records.get(recordId);
    if (!record || record.tombstoned) return false;
    if (!reason.trim()) {
      this.deps.audit.append(by, 'memory_tombstone_refused', { recordId, reason: 'شطب بلا سبب' });
      return false;
    }
    this.records.set(recordId, {
      ...record, content: '', tombstoned: true, tombstoneReason: reason,
    });
    this.deps.audit.append(by, 'memory_tombstoned', {
      recordId, reason, hash: record.contentHash, at: now,
    });
    return true;
  }

  all(): readonly MemoryRecord[] {
    return [...this.records.values()];
  }

  listOf(owner: EntityId): readonly MemoryRecord[] {
    return (this.byOwner.get(owner) ?? []).map((id) => this.records.get(id)!).filter(Boolean);
  }

  report(): { readonly total: number; readonly tombstoned: number; readonly untrusted: number; readonly owners: number } {
    const all = this.all();
    return {
      total: all.length,
      tombstoned: all.filter((r) => r.tombstoned).length,
      untrusted: all.filter((r) => r.trust === 'untrusted').length,
      owners: this.byOwner.size,
    };
  }

  /** تصدير للأرشيف الملكي فقط — نسخة عميقة لا مراجع حيّة */
  exportAll(): { readonly records: readonly MemoryRecord[]; readonly shares: readonly [string, readonly EntityId[]][]; readonly seq: number } {
    return {
      records: this.all().map((r) => ({ ...r })),
      shares: [...this.shares.entries()].map(([k, v]) => [k, [...v]] as [string, readonly EntityId[]]),
      seq: this.seq,
    };
  }

  /** استعادة كاملة: استبدال كلي ذرّي — لا دمج ولا استعادة جزئية */
  importAll(snapshot: ReturnType<AgentMemory['exportAll']>, by: EntityId): boolean {
    this.records.clear();
    this.byOwner.clear();
    this.shares.clear();
    for (const record of snapshot.records) {
      this.records.set(record.recordId, { ...record });
      this.byOwner.set(record.owner, [...(this.byOwner.get(record.owner) ?? []), record.recordId]);
    }
    for (const [recordId, readers] of snapshot.shares) this.shares.set(recordId, new Set(readers));
    this.seq = snapshot.seq;
    this.deps.audit.append(by, 'memory_restored', { records: snapshot.records.length });
    return true;
  }
}
