/**
 * src/identity/certificate_authority.ts — سلطة الشهادات وجذر الثقة (المرحلة 3)
 * المالك: وزارة الهوية
 * المدخلات: طلب شهادة (كيان، دور، مفتاح عام) | المخرجات: شهادة موقّعة أو رفض
 * الصلاحيات: الإصدار والإبطال فقط. لا تنفيذ ولا تدقيق (RULE-004)
 * حالات الفشل: مفتاح غير صالح، دور غير معروف، شهادة مبطلة أو منتهية ⇒ رفض مسجَّل
 */
import { Certificate, EntityId, Role, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KeyPair, generateKeyPair, signPayload, verifyPayload, sha256 } from './keys';

const VALID_ROLES: readonly Role[] = ['king', 'crown_guard', 'minister', 'governor', 'auditor', 'agent'];
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export class CertificateAuthority {
  private readonly root: KeyPair;
  private readonly issued = new Map<string, Certificate>();
  private readonly revoked = new Map<string, { at: number; reason: string }>();
  private kingCertId: string | null = null;

  constructor(private readonly audit: AppendOnlyLog, root?: KeyPair) {
    this.root = root ?? generateKeyPair();
    this.audit.append('authority:ca', 'ca_bootstrap', { rootKeyId: this.root.keyId });
  }

  get rootPublicKey(): string {
    return this.root.publicKey;
  }

  /** إصدار شهادة. ثابت سيادي: شهادة ملك واحدة فقط طوال حياة الجذر */
  issue(subject: EntityId, role: Role, publicKey: string, ttlMs = DEFAULT_TTL_MS): Certificate {
    if (!VALID_ROLES.includes(role)) {
      this.audit.append('authority:ca', 'cert_rejected', { subject, role, reason: 'دور غير معروف' });
      throw new SovereignViolation(`دور غير معروف: ${role}`, 'CA_UNKNOWN_ROLE');
    }
    if (!publicKey || publicKey.length < 32) {
      this.audit.append('authority:ca', 'cert_rejected', { subject, role, reason: 'مفتاح غير صالح' });
      throw new SovereignViolation('مفتاح عام غير صالح', 'CA_BAD_KEY');
    }
    if (role === 'king' && this.kingCertId !== null) {
      this.audit.append('authority:ca', 'cert_rejected', { subject, role, reason: 'ملك ثانٍ' });
      throw new SovereignViolation('لا يجوز إصدار هوية ملك ثانية', 'CA_SECOND_KING');
    }

    const issuedAt = Date.now();
    const base = {
      certId: `cert:${sha256(subject + publicKey + issuedAt).slice(0, 20)}`,
      subject, role, publicKey, issuedAt, expiresAt: issuedAt + ttlMs,
    };
    const cert: Certificate = { ...base, issuerSignature: signPayload(this.root.privateKey, base) };
    this.issued.set(cert.certId, cert);
    if (role === 'king') this.kingCertId = cert.certId;
    this.audit.append('authority:ca', 'cert_issued', {
      certId: cert.certId, subject, role, expiresAt: cert.expiresAt,
    });
    return cert;
  }

  /** التحقق من شهادة: توقيع الجذر + عدم الإبطال + عدم الانتهاء */
  validate(cert: Certificate, now = Date.now()): { valid: boolean; reason: string } {
    const { issuerSignature, ...base } = cert;
    if (!verifyPayload(this.root.publicKey, base, issuerSignature)) {
      return { valid: false, reason: 'توقيع الجذر غير مطابق' };
    }
    if (this.revoked.has(cert.certId)) {
      return { valid: false, reason: `شهادة مبطلة: ${this.revoked.get(cert.certId)!.reason}` };
    }
    if (now > cert.expiresAt) return { valid: false, reason: 'شهادة منتهية' };
    if (!this.issued.has(cert.certId)) return { valid: false, reason: 'شهادة غير مسجلة في الجذر' };
    return { valid: true, reason: 'شهادة سليمة' };
  }

  revoke(certId: string, reason: string): void {
    if (!this.issued.has(certId)) {
      throw new SovereignViolation('لا يمكن إبطال شهادة غير مسجلة', 'CA_UNKNOWN_CERT');
    }
    this.revoked.set(certId, { at: Date.now(), reason });
    this.audit.append('authority:ca', 'cert_revoked', { certId, reason });
  }

  isRevoked(certId: string): boolean {
    return this.revoked.has(certId);
  }

  get issuedCount(): number {
    return this.issued.size;
  }
}
