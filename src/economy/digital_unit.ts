/**
 * src/economy/digital_unit.ts — إصدار وحدة الحساب السيادية (المرحلة 25)
 * المالك: التاج وحده — والمالية تحفظ لا تُصدر
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بفعل amend_policy هدفه economy:unit، ومبلغ صحيح موجب
 * المخرجات: إصدار مقيَّد في الدفتر بطرفين، أو رفض بسبب موثّق
 * التبعيات: بوابة التاج، الدفتر المزدوج، config/economy.yaml (سقف الإصدار)
 * الصلاحيات: الإصدار والإحراق بأمر ملكي فقط — ولا جهة داخل الاقتصاد تُصدر لنفسها
 * السجلات: unit_issued / unit_burned / issuance_refused / external_convertibility_refused
 * ثوابت هذه الوحدة:
 *   1) **لا إصدار إلا بأمر ملكي**: الاقتصاد لا يخلق قيمة من نفسه (RULE-003)
 *   2) **سقف الإصدار مُعلن في التهيئة ولا يُتجاوز** — ولا يرفعه أمر، بل يُعدَّل الإعلان
 *   3) كل إصدار قيدٌ مزدوج: الخزانة مدينة وحقّ التاج دائن — فلا قيمة بلا مقابل مقيَّد
 *   4) المُصدِر ليس المستفيد: من أصدر الأمر لا يكون حساب الوجهة
 *   5) **الإحراق لا يزيد على المتداول**: لا عرض سالب بحال
 *   6) **لا تحويل خارجي بحال**: الوحدة محاسبية داخلية، ولا تدّعي قيمة نقدية —
 *      كل محاولة تحويل مرفوضة ومسجَّلة (تنبيه النطاق في README مُلزم في الكود)
 *   7) العرض المعلن = رصيد حقّ التاج في الدفتر — ولا عدّاد موازٍ يُصدّق دونه
 * حالات الفشل (كلها مغلقة): أمر غير معتمد ⇒ رفض؛ تجاوز السقف ⇒ رفض؛
 *   قيد الدفتر يفشل ⇒ لا إصدار (لا إصدار نصفه واقع)؛ تحويل خارجي ⇒ رفض دائم
 * اختبار القبول: tests/economy/economy_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0009-economy-and-treasury.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { Ledger, isValidAmount } from './ledger';

/** هدف الأمر الملكي لكل فعل إصدار أو إحراق */
export const UNIT_TARGET: EntityId = 'economy:unit';

export interface UnitDeclaration {
  readonly code: string;
  readonly name: string;
  readonly minorUnits: number;
  readonly supplyMax: number;
  readonly convertible: boolean;
}

export interface DigitalUnitDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly ledger: Ledger;
  readonly declaration: UnitDeclaration;
  readonly treasuryAccount: string;
  readonly equityAccount: string;
  readonly actorId?: EntityId;
}

export type UnitResult =
  | { readonly ok: true; readonly amount: number; readonly supply: number; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export class DigitalUnit {
  private issued = 0;
  private burned = 0;
  private readonly actorId: EntityId;

  constructor(private readonly deps: DigitalUnitDeps) {
    this.actorId = deps.actorId ?? 'authority:crown_guard';
  }

  /** 1) الإصدار: بأمر ملكي، تحت السقف المعلن، وبقيد مزدوج (ثوابت 1–4) */
  issue(command: SignedRoyalCommand, amount: number, reason: string, now = Date.now()): UnitResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): UnitResult => {
      const entry = this.deps.audit.append(this.actorId, 'issuance_refused', {
        amount, reason: why, mode: 'issue', ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };

    if (!isValidAmount(amount)) return refuse('مبلغ غير سليم: عدد صحيح موجب بالوحدات الصغرى');
    if (reason.trim().length < 3) return refuse('لا إصدار بلا سبب معلن (RULE-006)');
    if (command.payload.issuedBy === this.deps.treasuryAccount) {
      return refuse('المُصدِر ليس المستفيد (ثابت 4)');
    }
    const after = this.circulating() + amount;
    if (after > this.deps.declaration.supplyMax) {
      return refuse('تجاوز سقف الإصدار المعلن — السقف يُعدَّل في التهيئة لا بأمر (ثابت 2)', {
        supplyMax: this.deps.declaration.supplyMax, requested: after,
      });
    }

    const authorized = this.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const posted = this.deps.ledger.post({
      entryId: `issue:${command.payload.commandId}`,
      memo: `إصدار ${amount} ${this.deps.declaration.code}: ${reason.trim()}`,
      lines: [
        { account: this.deps.treasuryAccount, debit: amount },
        { account: this.deps.equityAccount, credit: amount },
      ],
      by: command.payload.issuedBy,
    }, now);
    if (!posted.ok) return refuse(`قيد الإصدار مرفوض: ${posted.reason}`);

    this.issued += amount;
    const entry = this.deps.audit.append(this.actorId, 'unit_issued', {
      amount, reason: reason.trim(), commandId: command.payload.commandId,
      entryId: posted.entry.entryId, circulating: this.circulating(),
      supplyMax: this.deps.declaration.supplyMax,
    });
    return { ok: true, amount, supply: this.circulating(), auditId: entry.hash };
  }

  /** 2) الإحراق: سحب قيمة من التداول — بأمر ملكي، ولا يزيد على المتداول (ثابت 5) */
  burn(command: SignedRoyalCommand, amount: number, reason: string, now = Date.now()): UnitResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): UnitResult => {
      const entry = this.deps.audit.append(this.actorId, 'issuance_refused', {
        amount, reason: why, mode: 'burn', ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (!isValidAmount(amount)) return refuse('مبلغ غير سليم: عدد صحيح موجب بالوحدات الصغرى');
    if (reason.trim().length < 3) return refuse('لا إحراق بلا سبب معلن (RULE-006)');
    if (amount > this.circulating()) {
      return refuse('لا إحراق يزيد على المتداول — لا عرض سالب (ثابت 5)', {
        circulating: this.circulating(),
      });
    }
    const held = this.deps.ledger.balance(this.deps.treasuryAccount);
    if (amount > held) {
      return refuse('لا إحراق يزيد على ما تحمله الخزانة فعلًا', { held });
    }

    const authorized = this.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const posted = this.deps.ledger.post({
      entryId: `burn:${command.payload.commandId}`,
      memo: `إحراق ${amount} ${this.deps.declaration.code}: ${reason.trim()}`,
      lines: [
        { account: this.deps.equityAccount, debit: amount },
        { account: this.deps.treasuryAccount, credit: amount },
      ],
      by: command.payload.issuedBy,
    }, now);
    if (!posted.ok) return refuse(`قيد الإحراق مرفوض: ${posted.reason}`);

    this.burned += amount;
    const entry = this.deps.audit.append(this.actorId, 'unit_burned', {
      amount, reason: reason.trim(), commandId: command.payload.commandId,
      entryId: posted.entry.entryId, circulating: this.circulating(),
    });
    return { ok: true, amount, supply: this.circulating(), auditId: entry.hash };
  }

  /**
   * 3) التحويل الخارجي: مرفوض دائمًا وبلا استثناء (ثابت 6).
   * نظير `RegionalAssembly.override` في المرحلة 24: فعلٌ نعلن رفضه بالكود لا بالتعليق،
   * ونسجّل كل محاولة — لأن تنبيه النطاق في README لا يحمي إن لم يكن في المسار التنفيذي.
   */
  convertExternal(requester: EntityId, amount: number, venue: string): UnitResult {
    const entry = this.deps.audit.append(this.actorId, 'external_convertibility_refused', {
      requester, amount, venue,
      reason: 'وحدة محاسبية داخلية: لا تحويل ولا قيمة خارج المستودع (ثابت 6)',
      declared: 'config/economy.yaml → unit.external_convertibility = forbidden',
    });
    return {
      ok: false,
      reason: 'التحويل الخارجي ممنوع بإعلان التهيئة ولا يُستثنى منه أحد',
      auditId: entry.hash,
    };
  }

  /** المتداول = المُصدَر − المُحرَق */
  circulating(): number { return this.issued - this.burned; }
  totalIssued(): number { return this.issued; }
  totalBurned(): number { return this.burned; }
  headroom(): number { return this.deps.declaration.supplyMax - this.circulating(); }

  /**
   * الثابت 7: العرض المعلن يجب أن يطابق رصيد حقّ التاج في الدفتر.
   * أي فرق يعني عدّادًا يكذب على الدفتر — والدفتر هو الحجّة.
   */
  reconcile(): { readonly consistent: boolean; readonly counter: number; readonly ledger: number } {
    const ledgerSide = this.deps.ledger.balance(this.deps.equityAccount);
    return { consistent: ledgerSide === this.circulating(), counter: this.circulating(), ledger: ledgerSide };
  }

  report(): {
    code: string; circulating: number; issued: number; burned: number;
    supplyMax: number; headroom: number; convertible: boolean; consistent: boolean;
  } {
    return {
      code: this.deps.declaration.code, circulating: this.circulating(),
      issued: this.issued, burned: this.burned, supplyMax: this.deps.declaration.supplyMax,
      headroom: this.headroom(), convertible: this.deps.declaration.convertible,
      consistent: this.reconcile().consistent,
    };
  }

  private authorize(command: SignedRoyalCommand, now: number): Decision {
    if (command.payload.action !== 'amend_policy') {
      return { allowed: false, reason: 'الإصدار فعل سيادي بأمر amend_policy وحده', auditId: '' };
    }
    if (command.payload.target !== UNIT_TARGET) {
      return { allowed: false, reason: `هدف الأمر يجب أن يكون ${UNIT_TARGET}`, auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }
}
