/**
 * src/identity/registry.ts — سجل الهويات (المرحلة 4)
 * المالك: وزارة الهوية
 * المدخلات: شهادات صادرة | المخرجات: بحث بالهوية، ثابت «ملك واحد»
 * حالات الفشل: تسجيل مكرر أو ملك ثانٍ ⇒ رفض مسجَّل
 */
import { Certificate, EntityId, Role, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';

export class IdentityRegistry {
  private readonly bySubject = new Map<EntityId, Certificate>();

  constructor(private readonly audit: AppendOnlyLog) {}

  register(cert: Certificate): void {
    if (this.bySubject.has(cert.subject)) {
      this.audit.append('registry:identity', 'register_rejected', {
        subject: cert.subject, reason: 'هوية مسجلة مسبقًا',
      });
      throw new SovereignViolation('الهوية مسجلة مسبقًا', 'REG_DUPLICATE');
    }
    if (cert.role === 'king' && this.kingId() !== null) {
      this.audit.append('registry:identity', 'register_rejected', {
        subject: cert.subject, reason: 'ملك ثانٍ',
      });
      throw new SovereignViolation('يوجد ملك مسجَّل بالفعل', 'REG_SECOND_KING');
    }
    this.bySubject.set(cert.subject, cert);
    this.audit.append('registry:identity', 'registered', { subject: cert.subject, role: cert.role });
  }

  get(subject: EntityId): Certificate | undefined {
    return this.bySubject.get(subject);
  }

  roleOf(subject: EntityId): Role | undefined {
    return this.bySubject.get(subject)?.role;
  }

  kingId(): EntityId | null {
    for (const [subject, cert] of this.bySubject) if (cert.role === 'king') return subject;
    return null;
  }

  list(role?: Role): readonly Certificate[] {
    const all = [...this.bySubject.values()];
    return role ? all.filter((c) => c.role === role) : all;
  }

  remove(subject: EntityId, reason: string): void {
    if (this.bySubject.get(subject)?.role === 'king') {
      throw new SovereignViolation('لا تُحذف هوية الملك من السجل', 'REG_KING_IMMUTABLE');
    }
    this.bySubject.delete(subject);
    this.audit.append('registry:identity', 'removed', { subject, reason });
  }
}
