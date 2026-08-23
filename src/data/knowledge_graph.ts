/**
 * src/data/knowledge_graph.ts — معرفة الدولة: حقائق بأسانيد وسلاسل أصل (المرحلة 21)
 * المالك: وزارة البيانات (والتصديق لسلطة مخوَّلة)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: دعوى (موضوع/محمول/قيمة) مسندة إلى سجل ذاكرة قائم
 * المخرجات: حقيقة بحالة معلنة: معلَّقة ← رسمية، أو متناقضة، أو مسحوبة
 * التبعيات: السجل غير القابل للتعديل، ذاكرة الوكلاء (السند)
 * الصلاحيات: الإسناد لأي كيان؛ والتصديق والفصل لسلطة مخوَّلة فقط
 * السجلات: fact_asserted / fact_refused / fact_contradiction / fact_attested /
 *           fact_resolved / facts_invalidated
 * ثوابت هذه الوحدة:
 *   1) لا حقيقة بلا سند: سجل ذاكرة قائم غير مشطوب — ولا سند شفهي
 *   2) ما بُني على مصدر غير موثوق يبقى **معلَّقًا** حتى تصديق سلطة مخوَّلة
 *   3) التناقض يُعلن ولا يُستبدل صامتًا: الحقيقتان تُوسمان ويُرفع الأمر للفصل
 *   4) الفصل قرار سلطة مخوَّلة مسجَّل بسببه — لا ترجيح تلقائي بالأحدث
 *   5) سحب السند يسحب كل ما بُني عليه تعاقبيًا — لا حقيقة يتيمة تبقى رسمية
 *   6) الحقائق تُوسم ولا تُمحى — السحب حالة لا حذف
 * حالات الفشل (كلها مغلقة): سند مفقود/مشطوب ⇒ رفض؛ تصديق من غير مخوَّل ⇒ رفض
 * اختبار القبول: tests/data/knowledge_graph.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0005-memory-and-knowledge.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { AgentMemory } from './agent_memory';
import type { DurableSink } from './persistence';

export type FactStatus = 'pending' | 'official' | 'contradicted' | 'withdrawn';

export interface Fact {
  readonly factId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  /** السند: سجل ذاكرة قائم */
  readonly sourceRecordId: string;
  /** حقائق بُنيت عليها هذه الحقيقة — للسحب التعاقبي */
  readonly derivedFrom: readonly string[];
  readonly assertedBy: EntityId;
  readonly assertedAt: number;
  readonly status: FactStatus;
  readonly attestedBy: EntityId | null;
  readonly note: string | null;
}

export interface FactInput {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly sourceRecordId: string;
  readonly derivedFrom?: readonly string[];
}

export type AssertResult =
  | { readonly ok: true; readonly fact: Fact; readonly contradicts: readonly string[]; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** التصديق والفصل: سلطات معلنة لا تُوسَّع بإعداد */
export const KNOWLEDGE_AUTHORITIES: readonly string[] = [
  'authority:king', 'ministry:data', 'ministry:justice', 'authority:crown_guard',
];

export interface KnowledgeDeps {
  readonly audit: AppendOnlyLog;
  readonly memory: AgentMemory;
  readonly ministryId?: EntityId;
  /**
   * وسيط دائم اختياري (المرحلة 39، البند T-27): تُدوَّن فيه الحقائق المتغيرة وحدها —
   * لا لقطة كاملة لكل دعوى، فلا يدفع أمرٌ واحد كلفة الرسم الكامل (درس البند T-92).
   */
  readonly journal?: DurableSink;
}

export class KnowledgeGraph {
  private readonly facts = new Map<string, Fact>();
  private readonly ministryId: EntityId;
  private seq = 0;

  constructor(private readonly deps: KnowledgeDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:data';
  }

  /** يُدوّن الحقائق التي تغيرت فقط — بحالتها بعد التغيير */
  private persist(ids: readonly string[], at?: number): void {
    const journal = this.deps.journal;
    if (!journal) return;
    for (const id of ids) {
      const fact = this.facts.get(id);
      if (fact) journal.record('knowledge_fact', fact, at);
    }
  }

  assert(by: EntityId, input: FactInput, now = Date.now()): AssertResult {
    const refuse = (reason: string): AssertResult => {
      const entry = this.deps.audit.append(by, 'fact_refused', {
        subject: input.subject, predicate: input.predicate, reason,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (!input.subject.trim() || !input.predicate.trim() || !input.object.trim()) {
      return refuse('دعوى ناقصة الأركان');
    }
    const source = this.deps.memory.read(this.ministryId, input.sourceRecordId);
    if (!source) return refuse('لا حقيقة بلا سند — سجل السند غير موجود أو غير مقروء');
    if (source.tombstoned) return refuse('سند مشطوب — لا حقيقة تُبنى على محتوى مزال');

    for (const parent of input.derivedFrom ?? []) {
      const p = this.facts.get(parent);
      if (!p) return refuse(`حقيقة أصل غير موجودة: ${parent}`);
      if (p.status === 'withdrawn') return refuse(`حقيقة أصل مسحوبة: ${parent}`);
    }

    // التناقض: نفس الموضوع والمحمول بقيمة مختلفة في حقيقة رسمية قائمة
    const clashing = [...this.facts.values()].filter(
      (f) => f.subject === input.subject && f.predicate === input.predicate
        && f.object !== input.object && (f.status === 'official' || f.status === 'pending'),
    );

    this.seq += 1;
    const factId = `fact:${String(this.seq).padStart(5, '0')}`;
    const baseStatus: FactStatus = source.trust === 'untrusted' ? 'pending' : 'official';
    const status: FactStatus = clashing.length > 0 ? 'contradicted' : baseStatus;

    const fact: Fact = {
      factId,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      sourceRecordId: input.sourceRecordId,
      derivedFrom: [...(input.derivedFrom ?? [])],
      assertedBy: by,
      assertedAt: now,
      status,
      attestedBy: null,
      note: source.trust === 'untrusted' ? 'سند غير موثوق — ينتظر تصديقًا' : null,
    };
    this.facts.set(factId, fact);

    for (const other of clashing) {
      this.facts.set(other.factId, { ...other, status: 'contradicted', note: `تناقض مع ${factId}` });
    }
    if (clashing.length > 0) {
      this.deps.audit.append(this.ministryId, 'fact_contradiction', {
        factId, subject: input.subject, predicate: input.predicate,
        with: clashing.map((f) => f.factId), escalation: 'يُرفع للفصل — لا استبدال صامت',
      });
    }

    this.persist([factId, ...clashing.map((f) => f.factId)], now);
    const entry = this.deps.audit.append(by, 'fact_asserted', {
      factId, subject: input.subject, predicate: input.predicate,
      source: input.sourceRecordId, trust: source.trust, status,
    });
    return { ok: true, fact, contradicts: clashing.map((f) => f.factId), auditId: entry.hash };
  }

  /** التصديق: يرفع حقيقة معلَّقة إلى رسمية — بسلطة مخوَّلة فقط */
  attest(factId: string, by: EntityId, now = Date.now()): boolean {
    const fact = this.facts.get(factId);
    if (!fact) return false;
    if (!KNOWLEDGE_AUTHORITIES.includes(by)) {
      this.deps.audit.append(by, 'fact_attest_refused', { factId, reason: 'سلطة غير مخوَّلة بالتصديق' });
      return false;
    }
    if (fact.status !== 'pending') {
      this.deps.audit.append(by, 'fact_attest_refused', { factId, reason: `حالة ${fact.status} لا تُصدَّق` });
      return false;
    }
    this.facts.set(factId, { ...fact, status: 'official', attestedBy: by, note: null });
    this.persist([factId], now);
    this.deps.audit.append(by, 'fact_attested', { factId, at: now });
    return true;
  }

  /** الفصل في تناقض: ترجيح حقيقة وسحب منافساتها بسبب مسجَّل */
  resolve(factId: string, by: EntityId, reason: string, now = Date.now()): boolean {
    const chosen = this.facts.get(factId);
    if (!chosen) return false;
    if (!KNOWLEDGE_AUTHORITIES.includes(by)) {
      this.deps.audit.append(by, 'fact_resolve_refused', { factId, reason: 'سلطة غير مخوَّلة بالفصل' });
      return false;
    }
    if (!reason.trim()) {
      this.deps.audit.append(by, 'fact_resolve_refused', { factId, reason: 'فصل بلا سبب مرفوض' });
      return false;
    }
    const rivals = [...this.facts.values()].filter(
      (f) => f.factId !== factId && f.subject === chosen.subject && f.predicate === chosen.predicate,
    );
    this.facts.set(factId, { ...chosen, status: 'official', attestedBy: by, note: `فصل: ${reason}` });
    for (const rival of rivals) {
      this.facts.set(rival.factId, { ...rival, status: 'withdrawn', note: `سُحبت بالفصل لصالح ${factId}` });
    }
    this.persist([factId, ...rivals.map((f) => f.factId)], now);
    this.deps.audit.append(by, 'fact_resolved', {
      factId, withdrawn: rivals.map((f) => f.factId), reason, at: now,
    });
    return true;
  }

  /**
   * سحب سند: كل حقيقة بُنيت عليه تُسحب، وكل ما بُني على المسحوب يُسحب تعاقبيًا.
   * هذا هو معنى تتبّع الأثر: لا حقيقة رسمية تبقى معلّقة في الهواء.
   */
  withdrawSource(recordId: string, by: EntityId, reason: string): readonly string[] {
    if (!KNOWLEDGE_AUTHORITIES.includes(by)) {
      this.deps.audit.append(by, 'source_withdraw_refused', { recordId, reason: 'سلطة غير مخوَّلة' });
      return [];
    }
    const withdrawn: string[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const fact of this.facts.values()) {
        if (fact.status === 'withdrawn') continue;
        const bySource = fact.sourceRecordId === recordId;
        const byParent = fact.derivedFrom.some((p) => this.facts.get(p)?.status === 'withdrawn');
        if (bySource || byParent) {
          this.facts.set(fact.factId, {
            ...fact, status: 'withdrawn',
            note: bySource ? `سُحب السند: ${reason}` : 'سُحبت حقيقة الأصل — سحب تعاقبي',
          });
          withdrawn.push(fact.factId);
          changed = true;
        }
      }
    }
    this.persist(withdrawn);
    this.deps.audit.append(by, 'facts_invalidated', { recordId, reason, count: withdrawn.length, facts: withdrawn });
    return withdrawn;
  }

  /** سلسلة الأصل الكاملة: الحقيقة ← حقائق أصلها ← سجل الذاكرة ← مصدره الخارجي */
  lineage(factId: string): {
    readonly facts: readonly Fact[];
    readonly memory: readonly string[];
    readonly origins: readonly string[];
  } {
    const facts: Fact[] = [];
    const memory: string[] = [];
    const origins: string[] = [];
    const queue = [factId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const fact = this.facts.get(id);
      if (!fact) continue;
      facts.push(fact);
      for (const record of this.deps.memory.lineage(fact.sourceRecordId)) {
        if (!memory.includes(record.recordId)) memory.push(record.recordId);
        const origin = `${record.provenance.kind}:${record.provenance.ref}`;
        if (record.supersedes === null && !origins.includes(origin)) origins.push(origin);
      }
      queue.push(...fact.derivedFrom);
    }
    return { facts, memory, origins };
  }

  official(subject: string, predicate: string): readonly Fact[] {
    return [...this.facts.values()].filter(
      (f) => f.subject === subject && f.predicate === predicate && f.status === 'official',
    );
  }

  get(factId: string): Fact | undefined {
    return this.facts.get(factId);
  }

  all(): readonly Fact[] {
    return [...this.facts.values()];
  }

  report(): Readonly<Record<FactStatus, number>> & { readonly total: number } {
    const all = this.all();
    const count = (s: FactStatus): number => all.filter((f) => f.status === s).length;
    return {
      total: all.length,
      pending: count('pending'),
      official: count('official'),
      contradicted: count('contradicted'),
      withdrawn: count('withdrawn'),
    };
  }

  exportAll(): { readonly facts: readonly Fact[]; readonly seq: number } {
    return { facts: this.all().map((f) => ({ ...f })), seq: this.seq };
  }

  importAll(snapshot: ReturnType<KnowledgeGraph['exportAll']>, by: EntityId): boolean {
    this.facts.clear();
    for (const fact of snapshot.facts) this.facts.set(fact.factId, { ...fact });
    this.seq = snapshot.seq;
    this.deps.audit.append(by, 'knowledge_restored', { facts: snapshot.facts.length });
    return true;
  }
}
