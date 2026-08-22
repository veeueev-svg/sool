/**
 * src/data/royal_archive.ts — الأرشيف الملكي: نسخ موثّقة واستعادة كاملة (المرحلة 21)
 * المالك: وزارة البيانات (والاستعادة أمر ملكي)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: طلب أخذ نسخة، وأمر ملكي (archive_restore) للاستعادة
 * المخرجات: نسخة ببصمة محتواها ورأس سلسلة التدقيق، أو استعادة كاملة موثّقة
 * التبعيات: بوابة التاج، السجل، الذاكرة، المعرفة، مفتاح الإيقاف، تجميد التوالد
 * الصلاحيات: النسخ لوزارة البيانات؛ والاستعادة لا تجري إلا بأمر ملكي معتمد
 * السجلات: archive_snapshot / archive_restore_refused / archive_restored / archive_verify
 * ثوابت هذه الوحدة:
 *   1) لكل نسخة بصمة محتواها — والاستعادة ترفض نسخة لا تطابق بصمتها (كشف تحريف)
 *   2) لا استعادة إلا بأمر ملكي فعله `archive_restore` — لا استعادة إدارية
 *   3) الاستعادة كل شيء أو لا شيء: تُحضَّر ثم تُبدَّل، والفشل يعيد الحالة السابقة
 *   4) التوالد يُجمَّد قبل الاستعادة ولا يُفَكّ تلقائيًا — الفكّ قرار معلن بعد الفحص
 *   5) بعد الاستعادة يجري تحقّق إلزامي، وفشله يُعَدّ استعادة فاشلة لا ناقصة
 *   6) النسخ لا تُحذف من هذه الوحدة — الأرشيف يُضاف إليه ولا يُقلَّم
 * حالات الفشل (كلها مغلقة): بصمة غير مطابقة، أمر مرفوض، فعل غير مطابق، نسخة مجهولة
 * اختبار القبول: tests/data/royal_archive.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0005-memory-and-knowledge.md
 */
import { createHash } from 'node:crypto';
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { AgentMemory } from './agent_memory';
import { KnowledgeGraph } from './knowledge_graph';

export interface ArchiveSnapshot {
  readonly snapshotId: string;
  readonly takenAt: number;
  readonly takenBy: EntityId;
  /** بصمة المحتوى المؤرشف — أي تحريف يُكشف عند الاستعادة */
  readonly contentHash: string;
  /** رأس سلسلة التدقيق لحظة النسخ — يربط النسخة بزمن مُبرهَن */
  readonly auditHead: string;
  readonly counts: { readonly memory: number; readonly facts: number };
  readonly payload: {
    readonly memory: ReturnType<AgentMemory['exportAll']>;
    readonly knowledge: ReturnType<KnowledgeGraph['exportAll']>;
    /** حالة التشغيل المتغيرة الملحقة بالاستعادة الملكية الوحيدة (المرحلة 32). */
    readonly recovery?: unknown;
  };
}

/**
 * ملحق الاستعادة التشغيلية. لا يملك أمرًا ولا يقرأ قرصًا: الأرشيف الملكي هو الذي
 * يستدعيه بعد تحقق البصمة والتاج والتجميد، فيبقى مسار الاستعادة واحدًا.
 */
export interface ArchiveRecoveryParticipant {
  exportAll(): unknown;
  importAll(snapshot: unknown, by: EntityId): boolean;
  verify(): boolean;
  prepareRestore(): void;
}

export interface ArchiveDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly memory: AgentMemory;
  readonly knowledge: KnowledgeGraph;
  /** تجميد التوالد قبل الاستعادة — دولة تُستعاد لا تُنجب في أثناء ذلك */
  readonly freeze?: { freeze(by: EntityId, reason: string): unknown };
  readonly ministryId?: EntityId;
  readonly recovery?: ArchiveRecoveryParticipant;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export class RoyalArchive {
  private readonly snapshots = new Map<string, ArchiveSnapshot>();
  private readonly ministryId: EntityId;
  private seq = 0;

  constructor(private readonly deps: ArchiveDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:data';
  }

  snapshot(by: EntityId = this.ministryId, now = Date.now()): ArchiveSnapshot {
    const payload = {
      memory: this.deps.memory.exportAll(),
      knowledge: this.deps.knowledge.exportAll(),
      ...(this.deps.recovery ? { recovery: this.deps.recovery.exportAll() } : {}),
    };
    this.seq += 1;
    const entries = this.deps.audit.snapshot();
    const snapshot: ArchiveSnapshot = {
      snapshotId: `snap:${String(this.seq).padStart(4, '0')}`,
      takenAt: now,
      takenBy: by,
      contentHash: stableHash(payload),
      auditHead: entries.length > 0 ? entries[entries.length - 1]!.hash : 'genesis',
      counts: { memory: payload.memory.records.length, facts: payload.knowledge.facts.length },
      payload,
    };
    this.snapshots.set(snapshot.snapshotId, snapshot);
    this.deps.audit.append(by, 'archive_snapshot', {
      snapshotId: snapshot.snapshotId, hash: snapshot.contentHash,
      auditHead: snapshot.auditHead, ...snapshot.counts,
    });
    return snapshot;
  }

  /** التحقق المستقل من سلامة نسخة — يُنادى قبل الاستعادة وبعدها */
  verify(snapshotId: string, by: EntityId = this.ministryId): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;
    const intact = stableHash(snapshot.payload) === snapshot.contentHash;
    this.deps.audit.append(by, 'archive_verify', { snapshotId, intact });
    return intact;
  }

  get(snapshotId: string): ArchiveSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * يسجّل نسخة جرى التحقق منها في مخزن القرص، من غير أن يستعيدها. فلا تكون قراءة
   * القرص طريق تبديل موازيا؛ التبديل اللاحق يستدعي `restore()` أدناه فقط.
   */
  install(snapshot: ArchiveSnapshot): boolean {
    if (!snapshot || !snapshot.snapshotId || stableHash(snapshot.payload) !== snapshot.contentHash) return false;
    this.snapshots.set(snapshot.snapshotId, snapshot);
    return true;
  }

  list(): readonly ArchiveSnapshot[] {
    return [...this.snapshots.values()];
  }

  /**
   * استعادة كاملة بأمر ملكي: تحقّق البصمة ← تجميد التوالد ← نسخة أمان للحالة
   * الحالية ← تبديل الذاكرة والمعرفة ← تحقّق بعدي إلزامي (وفشله يُرجِع الحالة).
   */
  restore(command: SignedRoyalCommand, snapshotId: string, now = Date.now()): Decision {
    const refuse = (reason: string): Decision => {
      const entry = this.deps.audit.append(this.ministryId, 'archive_restore_refused', { snapshotId, reason });
      return { allowed: false, reason, auditId: entry.hash };
    };

    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return refuse('نسخة مجهولة — لا استعادة لما لم يُؤرشف');

    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر الاستعادة مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'archive_restore') return refuse('الفعل لا يخصّ استعادة الأرشيف');
    if (!this.verify(snapshotId, this.ministryId)) {
      return refuse('بصمة النسخة لا تطابق محتواها — نسخة محرّفة لا تُستعاد');
    }

    // تجميد التوالد أولًا: لا وكيل جديد يظهر في أثناء تبديل الذاكرة
    this.deps.freeze?.freeze('authority:king', `استعادة أرشيف ${snapshotId}`);

    // نسخة أمان للحالة الحالية قبل التبديل — الرجوع ممكن دائمًا
    const before = {
      memory: this.deps.memory.exportAll(),
      knowledge: this.deps.knowledge.exportAll(),
      recovery: this.deps.recovery?.exportAll(),
    };

    try {
      this.deps.recovery?.prepareRestore();
      this.deps.memory.importAll(snapshot.payload.memory, this.ministryId);
      this.deps.knowledge.importAll(snapshot.payload.knowledge, this.ministryId);
      if (this.deps.recovery) {
        if (snapshot.payload.recovery === undefined) throw new Error('حمولة التعافي ناقصة');
        if (!this.deps.recovery.importAll(snapshot.payload.recovery, this.ministryId)) {
          throw new Error('استيراد حالة التعافي مرفوض');
        }
      }

      const okMemory = this.deps.memory.all().length === snapshot.counts.memory;
      const okFacts = this.deps.knowledge.all().length === snapshot.counts.facts;
      const okRecovery = !this.deps.recovery || this.deps.recovery.verify();
      const okAudit = this.deps.audit.verifyIntegrity().valid;
      if (!okMemory || !okFacts || !okRecovery || !okAudit) {
        this.deps.memory.importAll(before.memory, this.ministryId);
        this.deps.knowledge.importAll(before.knowledge, this.ministryId);
        if (this.deps.recovery && before.recovery !== undefined) {
          this.deps.recovery.importAll(before.recovery, this.ministryId);
        }
        return refuse('التحقّق البعدي فشل — أُرجعت الحالة السابقة ولا استعادة جزئية');
      }
    } catch (err) {
      this.deps.memory.importAll(before.memory, this.ministryId);
      this.deps.knowledge.importAll(before.knowledge, this.ministryId);
      if (this.deps.recovery && before.recovery !== undefined) {
        try { this.deps.recovery.importAll(before.recovery, this.ministryId); } catch { /* الحالة تبقى مجمّدة */ }
      }
      const reason = err instanceof Error ? err.message : 'فشل غير معروف';
      return refuse(`فشل التبديل: ${reason} — أُرجعت الحالة السابقة`);
    }

    // ملحق التعافي يعيد السجل في آخر التبديل، فيستبدل سجلات الاستيراد المؤقتة.
    // نعيد تسجيل النتيجة بعد ذلك كي يبقى أثر القراءة والكتابة في السلسلة المستعادة.
    if (this.deps.recovery) {
      this.deps.audit.append(this.ministryId, 'memory_restored', { records: snapshot.counts.memory });
      this.deps.audit.append(this.ministryId, 'knowledge_restored', { facts: snapshot.counts.facts });
      this.deps.audit.append(this.ministryId, 'recovery_state_restored', { snapshotId });
    }
    const entry = this.deps.audit.append(this.ministryId, 'archive_restored', {
      snapshotId, commandId: command.payload.commandId,
      ...snapshot.counts, auditHeadAtSnapshot: snapshot.auditHead,
      note: 'التوالد مُجمَّد — فكّه قرار معلن بعد الفحص',
    });
    return { allowed: true, reason: 'استُعيدت النسخة كاملة وتحقّقت', auditId: entry.hash };
  }
}
