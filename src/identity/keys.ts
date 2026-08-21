/**
 * src/identity/keys.ts — جذر الثقة التشفيري (المرحلة 3)
 * المالك: وزارة الهوية
 * المدخلات: لا شيء | المخرجات: أزواج مفاتيح Ed25519، توقيع، تحقق، بصمات
 * حالات الفشل: مفتاح تالف أو توقيع غير مطابق ⇒ رفض (false) بلا استثناء صامت
 */
import {
  generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify,
  createPublicKey, createPrivateKey, createHash, randomBytes,
} from 'node:crypto';

export interface KeyPair {
  readonly keyId: string;
  readonly publicKey: string;  // SPKI base64
  readonly privateKey: string; // PKCS8 base64 — لا يُسجَّل أبدًا في التدقيق
}

/** ترتيب معياري ثابت للحقول: شرط لتوقيع قابل لإعادة التحقق */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  return { keyId: `key:${sha256(pub).slice(0, 16)}`, publicKey: pub, privateKey: priv };
}

export function signPayload(privateKeyB64: string, payload: unknown): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8',
  });
  return cryptoSign(null, Buffer.from(canonicalize(payload), 'utf8'), key).toString('base64');
}

/** التحقق لا يرمي أبدًا: أي خلل يعني رفضًا */
export function verifyPayload(publicKeyB64: string, payload: unknown, signatureB64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki',
    });
    return cryptoVerify(
      null,
      Buffer.from(canonicalize(payload), 'utf8'),
      key,
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}
