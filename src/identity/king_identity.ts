/**
 * src/identity/king_identity.ts — هوية الملك (المرحلة 4)
 * المالك: وزارة الهوية | صاحب السيادة: الملك وحده
 * المدخلات: جذر الثقة + سجل الهويات | المخرجات: هوية ملك واحدة قادرة على توقيع الأوامر
 * حالات الفشل: محاولة إنشاء ملك ثانٍ، أو توقيع بمفتاح غير مفتاح الملك ⇒ رفض مسجَّل
 */
import { EntityId, RoyalCommandPayload, SignedRoyalCommand, SovereignAction } from '../kernel/types';
import { CertificateAuthority } from './certificate_authority';
import { IdentityRegistry } from './registry';
import { KeyPair, generateKeyPair, newNonce, signPayload, sha256 } from './keys';
import { Certificate } from '../kernel/types';

export class KingIdentity {
  readonly certificate: Certificate;
  private readonly keys: KeyPair;
  private counter = 0;

  constructor(
    readonly kingId: EntityId,
    ca: CertificateAuthority,
    registry: IdentityRegistry,
    keys?: KeyPair,
  ) {
    this.keys = keys ?? generateKeyPair();
    this.certificate = ca.issue(kingId, 'king', this.keys.publicKey);
    registry.register(this.certificate);
  }

  get publicKey(): string {
    return this.keys.publicKey;
  }

  get keyId(): string {
    return this.keys.keyId;
  }

  /** إصدار أمر ملكي موقّع — المسار الوحيد لأي فعل سيادي */
  issueCommand(
    action: SovereignAction,
    target: EntityId,
    params: Record<string, string | number | boolean> = {},
    at = Date.now(),
  ): SignedRoyalCommand {
    this.counter += 1;
    const payload: RoyalCommandPayload = {
      commandId: `cmd:${sha256(`${this.kingId}:${this.counter}:${at}`).slice(0, 20)}`,
      issuedBy: this.kingId,
      action,
      target,
      params,
      issuedAt: at,
      nonce: newNonce(),
    };
    return { payload, signature: signPayload(this.keys.privateKey, payload), keyId: this.keys.keyId };
  }
}
