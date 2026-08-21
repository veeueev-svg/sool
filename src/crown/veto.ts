/**
 * src/crown/veto.ts — النقض الملكي (المرحلة 6)
 * المالك: حرس التاج
 * المدخلات: أمر نقض من الملك | المخرجات: منع نهائي غير قابل للتجاوز
 * ثابت: لا أحد — ولا كل الأقاليم مجتمعة — يستطيع رفع النقض. الملك وحده يرفعه.
 * حالات الفشل: محاولة رفع النقض من غير الملك ⇒ رفض مسجَّل + حادث
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';

export interface VetoRecord {
  readonly subject: string; // معرّف الفعل أو الكيان الممنوع
  readonly reason: string;
  readonly at: number;
}

export class VetoRegistry {
  private readonly vetoes = new Map<string, VetoRecord>();

  constructor(private readonly audit: AppendOnlyLog, private readonly kingId: EntityId) {}

  place(actor: EntityId, subject: string, reason: string): VetoRecord {
    this.assertKing(actor, 'place_veto');
    const record: VetoRecord = { subject, reason, at: Date.now() };
    this.vetoes.set(subject, record);
    this.audit.append(actor, 'veto_placed', { subject, reason });
    return record;
  }

  /** الرفع مقصور على الملك — أي محاولة أخرى تُسجَّل كمخالفة سيادية */
  lift(actor: EntityId, subject: string): void {
    this.assertKing(actor, 'lift_veto');
    this.vetoes.delete(subject);
    this.audit.append(actor, 'veto_lifted', { subject });
  }

  isVetoed(subject: string): boolean {
    return this.vetoes.has(subject);
  }

  reasonFor(subject: string): string | null {
    return this.vetoes.get(subject)?.reason ?? null;
  }

  list(): readonly VetoRecord[] {
    return [...this.vetoes.values()];
  }

  private assertKing(actor: EntityId, attempt: string): void {
    if (actor !== this.kingId) {
      this.audit.append(actor, 'sovereign_violation', { attempt, reason: 'النقض حق ملكي حصري' });
      throw new SovereignViolation('النقض حق ملكي حصري', 'VETO_NOT_KING');
    }
  }
}
