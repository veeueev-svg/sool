/**
 * src/kernel/types.ts — العقود والأنواع الأساسية للدولة
 * المالك: القيّم على المستودع | المرحلة: 2
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md
 * المدخلات: لا شيء (تعريفات فقط) | المخرجات: أنواع مشتركة
 * حالات الفشل: لا شيء وقت التشغيل — الأخطاء تُلتقط وقت الترجمة
 */

/** معرّف كيان في الدولة: king:… agent:… region:… */
export type EntityId = string;

/** الأدوار السيادية والتنفيذية والرقابية */
export type Role = 'king' | 'crown_guard' | 'minister' | 'governor' | 'auditor' | 'agent';

/** الأفعال السيادية التي لا تُنفَّذ إلا بأمر ملكي موقّع */
export type SovereignAction =
  | 'create_agent'
  | 'grant_capability'
  | 'appoint_official'
  | 'amend_policy'
  | 'approve_phase'
  | 'terminate_agent'
  | 'declare_emergency'
  | 'open_external_account'
  | 'import_artifact'   // استيراد وكيل أو أوزان أو بيانات من الخارج (المرحلتان 16 و17)
  | 'train_model'       // تدريب أو تحديث نموذج (المرحلة 18)
  | 'archive_restore'   // استعادة حالة الدولة من نسخة أرشيف (المرحلة 21)
  | 'judicial_review';  // مراجعة ملكية لحكم قضائي: عفو أو تثبيت (المرحلة 22)

/** حالة الدولة التشغيلية */
export type StateMode =
  | 'bootstrap'   // قبل اكتمال جذر الثقة
  | 'normal'      // الملك حاضر والسياسات محمّلة
  | 'protective'  // غياب الملك أو فقد نبضه: لا قرارات سيادية
  | 'halted';     // إيقاف كامل بأمر أو بفشل حرج

/** نتيجة قرار: مسموح أو مرفوض بسبب موثّق */
export type Decision =
  | { allowed: true; reason: string; auditId: string }
  | { allowed: false; reason: string; auditId: string };

/** أمر ملكي بصورته المعيارية قبل التوقيع */
export interface RoyalCommandPayload {
  readonly commandId: string;
  readonly issuedBy: EntityId;
  readonly action: SovereignAction;
  readonly target: EntityId;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly issuedAt: number; // ms epoch
  readonly nonce: string;
}

/** أمر ملكي موقّع — الشكل الوحيد المقبول في بوابة التاج */
export interface SignedRoyalCommand {
  readonly payload: RoyalCommandPayload;
  readonly signature: string; // base64
  readonly keyId: string;
}

/** سجل تدقيق واحد داخل السلسلة غير القابلة للمحو */
export interface AuditEntry {
  readonly seq: number;
  readonly at: number;
  readonly actor: EntityId;
  readonly kind: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly hash: string;
}

/** شهادة هوية صادرة من جذر الثقة */
export interface Certificate {
  readonly certId: string;
  readonly subject: EntityId;
  readonly role: Role;
  readonly publicKey: string; // SPKI base64
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly issuerSignature: string;
}

/** خطأ سيادي: يُرفع عند محاولة تجاوز البوابة أو السياسة */
export class SovereignViolation extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SovereignViolation';
  }
}
