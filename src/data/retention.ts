/**
 * src/data/retention.ts — أصناف الاحتفاظ والشطب الدوري (المرحلة 21)
 * المالك: وزارة البيانات (والحجز القانوني لوزارة العدل)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: صنف احتفاظ معلن لكل سجل + طلب شطب دوري + حجوزات قانونية
 * المخرجات: قائمة ما شُطب وما احتُجز وما بقي — ولكل شطب سبب مسجَّل
 * التبعيات: السجل غير القابل للتعديل، ذاكرة الوكلاء
 * الصلاحيات: الشطب لوزارة البيانات؛ والحجز القانوني لوزارة العدل أو الملك
 * السجلات: legal_hold_placed / legal_hold_released / retention_sweep / retention_purged
 * ثوابت هذه الوحدة:
 *   1) لا احتفاظ أبدي بلا صنف معلن — سجل بلا صنف يُرفض عند الكتابة لا عند الشطب
 *   2) صنف «دائم» غير قابل للشطب — لا يُحذف بأمر دوري ولو تجاوز أي مدة
 *   3) الحجز القانوني يعلو على الشطب: لا شطب لسجل محتجز ولو انتهت مدته
 *   4) الشطب يزيل المحتوى ولا يزيل الأثر — البصمة والسبب يبقيان في السجل
 *   5) لا شطب قبل الحد الأدنى للمدة ولو طُلب — الحدّان يقيّدان معًا
 *   6) الشطب لا يمسّ سجل التدقيق بحال — سجل التدقيق ينمو ولا ينقص
 * حالات الفشل (كلها مغلقة): صنف مجهول ⇒ رفض؛ سلطة غير مخوَّلة ⇒ رفض
 * اختبار القبول: tests/data/retention.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0005-memory-and-knowledge.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import type { AgentMemory } from './agent_memory';

export interface RetentionClass {
  readonly id: string;
  readonly label: string;
  /** المدة القصوى قبل الشطب (ms) — Infinity تعني لا شطب دوري */
  readonly maxAgeMs: number;
  /** المدة الدنيا التي لا يُشطب السجل قبلها ولو طُلب */
  readonly minAgeMs: number;
  readonly purgeable: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** الأصناف المعلنة — تعديلها قرار سياسة يُوثَّق، لا إعداد تشغيلي */
export const DEFAULT_RETENTION_CLASSES: readonly RetentionClass[] = [
  { id: 'ephemeral', label: 'عابر', maxAgeMs: HOUR, minAgeMs: 0, purgeable: true },
  { id: 'operational', label: 'تشغيلي', maxAgeMs: 30 * DAY, minAgeMs: HOUR, purgeable: true },
  { id: 'official', label: 'رسمي', maxAgeMs: 365 * DAY, minAgeMs: 30 * DAY, purgeable: true },
  { id: 'permanent', label: 'دائم', maxAgeMs: Number.POSITIVE_INFINITY, minAgeMs: Number.POSITIVE_INFINITY, purgeable: false },
];

export const HOLD_AUTHORITIES: readonly string[] = ['authority:king', 'ministry:justice', 'authority:crown_guard'];

export function retentionClassIds(classes: readonly RetentionClass[] = DEFAULT_RETENTION_CLASSES): readonly string[] {
  return classes.map((c) => c.id);
}

export interface SweepReport {
  readonly purged: readonly string[];
  readonly held: readonly string[];
  readonly kept: readonly string[];
  readonly auditId: string;
}

export interface RetentionDeps {
  readonly audit: AppendOnlyLog;
  readonly memory: AgentMemory;
  readonly classes?: readonly RetentionClass[];
  readonly ministryId?: EntityId;
}

export class RetentionPolicy {
  private readonly classes: readonly RetentionClass[];
  private readonly holds = new Map<string, { by: EntityId; reason: string; at: number }>();
  private readonly ministryId: EntityId;

  constructor(private readonly deps: RetentionDeps) {
    this.classes = deps.classes ?? DEFAULT_RETENTION_CLASSES;
    this.ministryId = deps.ministryId ?? 'ministry:data';
  }

  classExists(id: string): boolean {
    return this.classes.some((c) => c.id === id);
  }

  classOf(id: string): RetentionClass | undefined {
    return this.classes.find((c) => c.id === id);
  }

  /** الحجز القانوني: يمنع الشطب مهما بلغ عمر السجل */
  legalHold(recordId: string, by: EntityId, reason: string, now = Date.now()): boolean {
    if (!HOLD_AUTHORITIES.includes(by)) {
      this.deps.audit.append(by, 'legal_hold_refused', { recordId, reason: 'سلطة غير مخوَّلة بالحجز' });
      return false;
    }
    if (!reason.trim()) {
      this.deps.audit.append(by, 'legal_hold_refused', { recordId, reason: 'حجز بلا سبب مرفوض' });
      return false;
    }
    this.holds.set(recordId, { by, reason, at: now });
    this.deps.audit.append(by, 'legal_hold_placed', { recordId, reason });
    return true;
  }

  releaseHold(recordId: string, by: EntityId, reason: string): boolean {
    if (!HOLD_AUTHORITIES.includes(by)) {
      this.deps.audit.append(by, 'legal_hold_release_refused', { recordId, reason: 'سلطة غير مخوَّلة' });
      return false;
    }
    if (!this.holds.has(recordId)) return false;
    this.holds.delete(recordId);
    this.deps.audit.append(by, 'legal_hold_released', { recordId, reason });
    return true;
  }

  isHeld(recordId: string): boolean {
    return this.holds.has(recordId);
  }

  holdsReport(): readonly { readonly recordId: string; readonly by: EntityId; readonly reason: string }[] {
    return [...this.holds.entries()].map(([recordId, h]) => ({ recordId, by: h.by, reason: h.reason }));
  }

  /**
   * الشطب الدوري: يزيل محتوى ما تجاوز مدته ويترك بصمته وسببه.
   * لا يمسّ سجل التدقيق، ولا يمسّ سجلًا محتجزًا، ولا صنفًا غير قابل للشطب.
   */
  sweep(by: EntityId = this.ministryId, now = Date.now()): SweepReport {
    const purged: string[] = [];
    const held: string[] = [];
    const kept: string[] = [];

    for (const record of this.deps.memory.all()) {
      if (record.tombstoned) continue;
      const cls = this.classOf(record.retentionClass);
      if (!cls) { kept.push(record.recordId); continue; }
      const age = now - record.createdAt;
      if (!cls.purgeable || age < cls.maxAgeMs || age < cls.minAgeMs) {
        kept.push(record.recordId);
        continue;
      }
      if (this.isHeld(record.recordId)) {
        held.push(record.recordId);
        this.deps.audit.append(by, 'retention_purge_blocked', {
          recordId: record.recordId, reason: 'حجز قانوني قائم',
        });
        continue;
      }
      const done = this.deps.memory.tombstone(record.recordId, by, `انتهاء مدة الاحتفاظ (${cls.id})`, now);
      if (done) { purged.push(record.recordId); } else { kept.push(record.recordId); }
    }

    const entry = this.deps.audit.append(by, 'retention_sweep', {
      purged: purged.length, held: held.length, kept: kept.length,
    });
    return { purged, held, kept, auditId: entry.hash };
  }
}
