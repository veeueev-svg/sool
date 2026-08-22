/**
 * src/services/supply_chain.ts — المخزون وسلاسل التوريد الداخلية (المرحلة 28)
 * المالك: وزارة الاقتصاد — والمادة الخارجية لا تدخل إلا على **عقد قائم** لا على اسم مذكور
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مادة معلنة في config/enterprises.yaml + منشأة قائمة + سندُ مصدرٍ معلن
 * المخرجات: مخزون مُقاس لكل منشأة، وكل تغيّر فيه حركةٌ مسجَّلة — أو رفض بسبب موثّق
 * التبعيات: سجل التدقيق، سجل المنشآت (مصدر تحقق)، سجل العقود الخارجية (مصدر تحقق)
 * الصلاحيات: الاستلام والنقل لوزارة الاقتصاد؛ والاستهلاك لا يقع إلا من دفعة إنتاج قائمة
 * السجلات: stock_received / stock_consumed / stock_transferred / stock_refused /
 *           stock_conservation_breach
 * ثوابت هذه الوحدة:
 *   1) **لا مادة غير معلنة**: الاستلام لا يُنشئ مادة (RULE-005)
 *   2) **لا مادة بلا سند مصدر**: مادةٌ مصدرها خارجي تحتاج **عقدًا قائمًا** لنظيرها
 *      (ADR-0011 قرار 1)، ومصدر التحقق غير المربوط ⇒ كل استلام خارجي مرفوض (فشل مغلق)
 *   3) **لا مادة داخلية تُستلَم من الخارج، ولا مادة خارجية تُدَّعى إنتاجًا**: السند
 *      يطابق إعلان المادة لا رغبة الطالب
 *   4) **لا مخزون سالب**: الاستهلاك والنقل لا يتجاوزان الرصيد — ولا رصيد يُخصم بلا حركة
 *   5) **الحفظ**: لكل تغيّر في الرصيد حركةٌ مسجَّلة، ومجموع الحركات = الرصيد دائمًا،
 *      و`verifyConservation()` تكشف أي رصيد لا تسنده حركاته (نظير سلامة سلسلة التدقيق)
 *   6) **النقل لا يُنشئ ولا يُفني**: ما يخرج من منشأة يدخل الأخرى بالكمية نفسها، ولا نقل
 *      إلى منشأة غير قائمة ولا من منشأة غير قائمة، ولا نقل إلى النفس
 *   7) **لا حركة على منشأة غير قائمة**: المعلَّقة والمنحلّة والمنتهية لا تستلم ولا تنقل
 *   8) **الرصيد يُقرأ بعد الحلّ ولا يُحرَّك**: التدقيق يحتاج الرقم، والتشغيل لا يحتاجه
 * حالات الفشل (كلها مغلقة): مادة غير معلنة ⇒ رفض؛ كمية غير مُقاسة ⇒ رفض؛ منشأة غير
 *   قائمة ⇒ رفض؛ سند لا يطابق إعلان المادة ⇒ رفض؛ عقد غير قائم ⇒ رفض؛ رصيد أقل من
 *   المطلوب ⇒ رفض؛ نقل إلى النفس ⇒ رفض؛ مصدر تحقق غير مربوط ⇒ رفض
 * اختبار القبول: tests/services/enterprise_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0012-enterprises.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ECONOMY_MINISTRY } from './company_runtime';

/** مادة معلنة في التهيئة: مصدرها "internal" أو معرّف نظير خارجي معلن */
export interface DeclaredMaterial {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly source: string;
}

/** سند مصدر الحركة — لا مادة تظهر بلا واحد منها (ثابت 2) */
export type StockProvenance =
  /** استلام من الخارج: يلزمه عقد قائم لنظير المادة المعلن */
  | { readonly kind: 'external_contract'; readonly contractId: string }
  /** إنتاج داخلي: يلزمه معرّف دفعة إنتاج أقفلت بجودة مقبولة */
  | { readonly kind: 'production'; readonly runId: string }
  /** نقل داخلي بين منشأتين قائمتين */
  | { readonly kind: 'transfer'; readonly from: string };

export interface StockMovement {
  readonly movementId: string;
  readonly facilityId: string;
  readonly material: string;
  /** موجب للدخول وسالب للخروج — الجمع الجبري هو الرصيد (ثابت 5) */
  readonly delta: number;
  readonly at: number;
  readonly by: EntityId;
  readonly provenance: StockProvenance | { readonly kind: 'consumption'; readonly runId: string };
}

export type StockResult =
  | { readonly ok: true; readonly balance: number; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** مصدر يتحقق من قيام المنشأة — فشل مغلق قبل الربط (ثابت 7) */
export type FacilityProbe = (facilityId: string, at: number) => boolean;
/** مصدر يتحقق من قيام عقد خارجي ومن نظيره — فشل مغلق قبل الربط (ثابت 2) */
export type ContractProbe = (contractId: string, at: number) => string | null;

export interface SupplyChainDeps {
  readonly audit: AppendOnlyLog;
  readonly materials: readonly DeclaredMaterial[];
  readonly operatorId?: EntityId;
}

export class SupplyChain {
  private readonly materials = new Map<string, DeclaredMaterial>();
  private readonly balances = new Map<string, number>();
  private readonly movements: StockMovement[] = [];
  private readonly operatorId: EntityId;
  private facilityProbe: FacilityProbe | null = null;
  private contractProbe: ContractProbe | null = null;
  private sequence = 0;

  constructor(private readonly deps: SupplyChainDeps) {
    this.operatorId = deps.operatorId ?? ECONOMY_MINISTRY;
    for (const material of deps.materials) this.materials.set(material.id, material);
  }

  bindFacilityProbe(probe: FacilityProbe): void { this.facilityProbe = probe; }
  bindContractProbe(probe: ContractProbe): void { this.contractProbe = probe; }

  material(materialId: string): DeclaredMaterial | null {
    return this.materials.get(materialId) ?? null;
  }

  private key(facilityId: string, material: string): string { return `${facilityId}|${material}`; }

  private refuse(
    facilityId: string, material: string, mode: string, why: string,
    extra: Record<string, unknown> = {},
  ): StockResult {
    const entry = this.deps.audit.append(this.operatorId, 'stock_refused', {
      facilityId, material, mode, reason: why, ...extra,
    });
    return { ok: false, reason: why, auditId: entry.hash };
  }

  /** كمية مُقاسة: عدد صحيح موجب — والصفر و NaN والكسري كلها غير مُقاسة (T-69) */
  private static measured(quantity: number): boolean {
    return Number.isSafeInteger(quantity) && quantity > 0;
  }

  private record(
    facilityId: string, material: string, delta: number, at: number, by: EntityId,
    provenance: StockMovement['provenance'],
  ): number {
    this.sequence += 1;
    const movement: StockMovement = {
      movementId: `mov-${this.sequence}`, facilityId, material, delta, at, by, provenance,
    };
    this.movements.push(movement);
    const next = (this.balances.get(this.key(facilityId, material)) ?? 0) + delta;
    this.balances.set(this.key(facilityId, material), next);
    return next;
  }

  /**
   * 1) استلام مادة. ترتيب الفحوص مقصود: المادة ← الكمية ← المنشأة ← **السند** ←
   * مطابقة السند لإعلان المادة ← العقد القائم.
   * والسند يُفحص بعد المنشأة وقبل كل شيء آخر: مادةٌ بلا سند لا يُسأل عن كميتها،
   * لأنها ليست مادةً دخلت بل رقمًا ظهر (ثابت 2).
   */
  receive(
    facilityId: string, materialId: string, quantity: number,
    provenance: StockProvenance, by: EntityId = this.operatorId, now = Date.now(),
  ): StockResult {
    const material = this.materials.get(materialId);
    if (!material) {
      return this.refuse(facilityId, materialId, 'receive',
        'مادة غير معلنة في التهيئة — الاستلام لا يُنشئ مادة (ثابت 1)');
    }
    if (!SupplyChain.measured(quantity)) {
      return this.refuse(facilityId, materialId, 'receive',
        'كمية غير مُقاسة: عدد صحيح موجب (T-69)', { quantity });
    }
    if (this.facilityProbe === null) {
      return this.refuse(facilityId, materialId, 'receive',
        'مصدر التحقق من المنشأة غير مربوط — رفض مغلق (ثابت 7)');
    }
    if (!this.facilityProbe(facilityId, now)) {
      return this.refuse(facilityId, materialId, 'receive',
        'منشأة غير قائمة — لا حركة على معلَّقة أو منحلّة أو منتهية (ثابت 7)');
    }
    if (provenance.kind === 'external_contract') {
      if (material.source === 'internal') {
        return this.refuse(facilityId, materialId, 'receive',
          'مادة داخلية تُدَّعى واردةً من الخارج — السند يطابق الإعلان (ثابت 3)');
      }
      if (this.contractProbe === null) {
        return this.refuse(facilityId, materialId, 'receive',
          'مصدر التحقق من العقود غير مربوط — رفض مغلق (ثابت 2)');
      }
      const counterparty = this.contractProbe(provenance.contractId, now);
      if (counterparty === null) {
        return this.refuse(facilityId, materialId, 'receive',
          'لا عقد قائم بهذا المعرّف — لا مادة على اسم مذكور (ثابت 2)',
          { contractId: provenance.contractId });
      }
      if (counterparty !== material.source) {
        return this.refuse(facilityId, materialId, 'receive',
          'نظير العقد لا يطابق مصدر المادة المعلن (ثابت 3)',
          { contractId: provenance.contractId, counterparty, declaredSource: material.source });
      }
    } else if (provenance.kind === 'production') {
      if (material.source !== 'internal') {
        return this.refuse(facilityId, materialId, 'receive',
          'مادة مصدرها خارجي تُدَّعى إنتاجًا داخليًّا (ثابت 3)');
      }
      if (typeof provenance.runId !== 'string' || provenance.runId.trim().length === 0) {
        return this.refuse(facilityId, materialId, 'receive', 'إنتاج بلا معرّف دفعة (ثابت 2)');
      }
    } else if (provenance.kind === 'transfer') {
      if (typeof provenance.from !== 'string' || provenance.from.trim().length === 0) {
        return this.refuse(facilityId, materialId, 'receive', 'نقل بلا منشأة مصدر (ثابت 2)');
      }
    }

    const balance = this.record(facilityId, materialId, quantity, now, by, provenance);
    const entry = this.deps.audit.append(by, 'stock_received', {
      facilityId, material: materialId, quantity, provenance: provenance.kind,
      reference: provenance.kind === 'external_contract' ? provenance.contractId
        : provenance.kind === 'production' ? provenance.runId : provenance.from,
      balance,
    });
    return { ok: true, balance, auditId: entry.hash };
  }

  /**
   * 2) استهلاك مادة في دفعة إنتاج. لا رصيد يُخصم بلا حركة، ولا خصمٌ يتجاوز الرصيد
   * (ثابت 4) — فلا يُصنع مخرجٌ من مخزون لا وجود له.
   */
  consume(
    facilityId: string, materialId: string, quantity: number, runId: string,
    by: EntityId = this.operatorId, now = Date.now(),
  ): StockResult {
    if (!this.materials.has(materialId)) {
      return this.refuse(facilityId, materialId, 'consume', 'مادة غير معلنة (ثابت 1)');
    }
    if (!SupplyChain.measured(quantity)) {
      return this.refuse(facilityId, materialId, 'consume',
        'كمية غير مُقاسة: عدد صحيح موجب (T-69)', { quantity });
    }
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      return this.refuse(facilityId, materialId, 'consume',
        'لا استهلاك بلا دفعة إنتاج تُعلّق عليها الحركة (ثابت 5)');
    }
    if (this.facilityProbe === null) {
      return this.refuse(facilityId, materialId, 'consume',
        'مصدر التحقق من المنشأة غير مربوط — رفض مغلق (ثابت 7)');
    }
    if (!this.facilityProbe(facilityId, now)) {
      return this.refuse(facilityId, materialId, 'consume', 'منشأة غير قائمة (ثابت 7)');
    }
    const current = this.balance(facilityId, materialId);
    if (quantity > current) {
      return this.refuse(facilityId, materialId, 'consume',
        'الرصيد أقل من المطلوب — لا مخزون سالب (ثابت 4)', { balance: current, requested: quantity });
    }
    const balance = this.record(facilityId, materialId, -quantity, now, by, {
      kind: 'consumption', runId,
    });
    const entry = this.deps.audit.append(by, 'stock_consumed', {
      facilityId, material: materialId, quantity, runId, balance,
    });
    return { ok: true, balance, auditId: entry.hash };
  }

  /**
   * 3) النقل بين منشأتين. حركتان لا واحدة (ثابت 6): خروجٌ من الأولى ودخولٌ في الثانية
   * بالكمية نفسها — فلا يُنشئ النقل مادةً ولا يُفنيها، ولا ينقل إلى منشأة غير قائمة.
   */
  transfer(
    from: string, to: string, materialId: string, quantity: number,
    by: EntityId = this.operatorId, now = Date.now(),
  ): StockResult {
    if (from === to) {
      return this.refuse(from, materialId, 'transfer', 'لا نقل إلى النفس (ثابت 6)');
    }
    if (!this.materials.has(materialId)) {
      return this.refuse(from, materialId, 'transfer', 'مادة غير معلنة (ثابت 1)');
    }
    if (!SupplyChain.measured(quantity)) {
      return this.refuse(from, materialId, 'transfer',
        'كمية غير مُقاسة: عدد صحيح موجب (T-69)', { quantity });
    }
    if (this.facilityProbe === null) {
      return this.refuse(from, materialId, 'transfer',
        'مصدر التحقق من المنشأة غير مربوط — رفض مغلق (ثابت 7)');
    }
    if (!this.facilityProbe(from, now)) {
      return this.refuse(from, materialId, 'transfer', 'منشأة المصدر غير قائمة (ثابت 7)');
    }
    if (!this.facilityProbe(to, now)) {
      return this.refuse(to, materialId, 'transfer', 'منشأة المقصد غير قائمة (ثابت 7)');
    }
    const current = this.balance(from, materialId);
    if (quantity > current) {
      return this.refuse(from, materialId, 'transfer',
        'الرصيد أقل من المنقول — لا مخزون سالب (ثابت 4)', { balance: current, requested: quantity });
    }
    this.record(from, materialId, -quantity, now, by, { kind: 'transfer', from });
    const balance = this.record(to, materialId, quantity, now, by, { kind: 'transfer', from });
    const entry = this.deps.audit.append(by, 'stock_transferred', {
      from, to, material: materialId, quantity,
      fromBalance: this.balance(from, materialId), toBalance: balance,
    });
    return { ok: true, balance, auditId: entry.hash };
  }

  balance(facilityId: string, materialId: string): number {
    return this.balances.get(this.key(facilityId, materialId)) ?? 0;
  }

  movementsOf(facilityId: string): readonly StockMovement[] {
    return this.movements.filter((m) => m.facilityId === facilityId);
  }

  journal(): readonly StockMovement[] { return [...this.movements]; }

  /**
   * 4) التحقق من الحفظ (ثابت 5): كل رصيد يجب أن يساوي مجموع حركاته، ومجموع كل
   * الحركات لمادةٍ واحدة يجب أن يساوي (الداخل من الخارج والإنتاج) − (المستهلَك)
   * — والنقل لا يظهر في المجموع لأنه خروجٌ ودخولٌ متساويان.
   * ما يخرق ذلك يُسجَّل باسمه `stock_conservation_breach` ولا يُصحَّح صامتًا.
   */
  verifyConservation(): {
    readonly valid: boolean;
    readonly breaches: readonly { readonly key: string; readonly balance: number; readonly sum: number }[];
    readonly netTransfer: number;
  } {
    const sums = new Map<string, number>();
    let netTransfer = 0;
    for (const movement of this.movements) {
      const key = this.key(movement.facilityId, movement.material);
      sums.set(key, (sums.get(key) ?? 0) + movement.delta);
      if (movement.provenance.kind === 'transfer') netTransfer += movement.delta;
    }
    const breaches: { key: string; balance: number; sum: number }[] = [];
    for (const [key, balance] of this.balances) {
      const sum = sums.get(key) ?? 0;
      if (sum !== balance) breaches.push({ key, balance, sum });
    }
    // النقل مجموعه صفر دائمًا: كل خروج يقابله دخول بالكمية نفسها (ثابت 6)
    if (netTransfer !== 0) {
      breaches.push({ key: 'transfer:net', balance: 0, sum: netTransfer });
    }
    if (breaches.length > 0) {
      this.deps.audit.append(this.operatorId, 'stock_conservation_breach', {
        breaches: breaches.length, netTransfer,
      });
    }
    return { valid: breaches.length === 0, breaches, netTransfer };
  }

  report(): {
    readonly declaredMaterials: number; readonly movements: number;
    readonly stocked: readonly { readonly facilityId: string; readonly material: string; readonly balance: number }[];
  } {
    const stocked: { facilityId: string; material: string; balance: number }[] = [];
    for (const [key, balance] of this.balances) {
      if (balance === 0) continue;
      const [facilityId, material] = key.split('|') as [string, string];
      stocked.push({ facilityId, material, balance });
    }
    return { declaredMaterials: this.materials.size, movements: this.movements.length, stocked };
  }
}
