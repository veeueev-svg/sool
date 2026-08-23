/**
 * src/external/contract_registry.ts — سجل العقود الخارجية (المرحلة 27)
 * المالك: وزارة الخارجية — تقترح، ولا تقدّر مخاطرها، ولا تُنهي عقدها بيدها
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: نوع عقد معلن في config/contracts.yaml + حساب خارجي قائم (المرحلة 26)
 *           + تقدير مخاطر قائم من ديوان التدقيق + أمر ملكي بفعل open_external_account
 * المخرجات: عقد معلن، مؤقَّت بتاريخ انتهاء إلزامي، محدود القيمة — أو رفض بسبب موثّق
 * التبعيات: بوابة التاج، سجل الحسابات الخارجية، تقدير مخاطر الشريك، سجل التدقيق
 * الصلاحيات: التوقيع ملكي باقتراح وزارة الخارجية؛ **الإنهاء ليس في هذه الوحدة** بل في
 *            `contract_termination.ts` بصلاحية تُمنح مرة واحدة (ثابت 8)
 * السجلات: external_contract_signed / external_contract_refused /
 *           external_contract_terminated / contract_termination_channel_bound
 * ثوابت هذه الوحدة:
 *   1) **لا عقد بلا تاريخ انتهاء**: غائبٌ أو ماضٍ أو غير صالح ⇒ رفض (شرط قبول المرحلة)
 *   2) **لا عقد يتجاوز قناته**: انتهاء العقد ≤ انتهاء الحساب الخارجي — لا التزام بلا
 *      قناة تنفّذه، ولا تمديد للقناة بحجّة عقدٍ وُقّع عليها
 *   3) **لا عقد لنوع غير معلن ولا لنظير بلا حساب قائم** (RULE-005): التوقيع لا يُنشئ نوعًا
 *   4) **لا عقد بلا تقدير مخاطر قائم من غير مقترحه**، ودرجة فوق السقف المعلن تمنعه
 *   5) **لا تجديد ضمني ولا تمديد**: المنتهي غير قائم، والجديد عقدٌ جديد بأمرٍ وتقديرٍ جديدين
 *   6) **لا عقود قائمة لنظير واحد فوق الحدّ المعلن**: التفتيت بلا حدّ يُخفي المجموع
 *   7) **لا تعهّد يتجاوز سقف القناة**: مجموع قيم العقود القائمة ≤ السقف الكلي للحساب
 *   8) **باب واحد للإنهاء**: صلاحية الإنهاء تُمنح مرة واحدة لوحدة الإنهاء، ولا تُمنح ثانيةً
 *   9) **العقدُ يُدوّن لحطةَ توقيعه ولحطةَ إنهائه** (المرحلة 39 — T-122): إن رُبط
 *      وسيطٌ دائم، دُوّنت حالةُ العقد كاملةً مع تسلسلِ السجل — فالإقلاعُ التالي لا
 *      يُعيد إصدار معرّفٍ ممنوحٍ سابقًا (تسلسلٌ يُصفَّر يولّد عقدًا بمعرّف عقدٍ مُنهَى).
 * حالات الفشل (كلها مغلقة): نوع غير معلن ⇒ رفض؛ بلا تاريخ انتهاء ⇒ رفض؛ مدة تفوق الحدّ
 *   ⇒ رفض؛ انتهاء بعد انتهاء الحساب ⇒ رفض؛ حساب معلَّق أو منتهٍ أو مغلق ⇒ رفض؛
 *   قيمة تفوق سقف النوع ⇒ رفض؛ تقدير بالٍ أو مفقود أو فوق السقف ⇒ رفض؛
 *   عقد ثانٍ لنظير له عقد قائم ⇒ رفض؛ تجاوز سقف القناة ⇒ رفض؛ أمر غير معتمد ⇒ رفض
 * اختبار القبول: tests/external/external_contracts_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0011-external-contracts.md
 */
import { EntityId, SignedRoyalCommand, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import type { DurableSink } from '../data/persistence';
import { CrownGateway } from '../crown/crown_gateway';
import { ExternalAccountRegistry, FOREIGN_MINISTRY } from './account_registry';
import { PartnerRisk } from './partner_risk';

export interface ExternalContract {
  readonly contractId: string;
  readonly kindId: string;
  readonly name: string;
  readonly counterparty: string;
  readonly purpose: string;
  readonly value: number;
  readonly proposedBy: EntityId;
  readonly signedAt: number;
  /** تاريخ الانتهاء الإلزامي (ثابت 1) — لا عقد بلا هذا الحقل */
  readonly endsAt: number;
  readonly commandId: string;
  readonly assessmentId: string;
  readonly riskScore: number;
  terminatedAt: number | null;
  terminatedBy: EntityId | null;
  terminationReason: string | null;
}

export interface SignContractInput {
  readonly kindId: string;
  readonly value: number;
  /** تاريخ الانتهاء — إلزامي: غيابه رفضٌ لا افتراضَ مدةٍ (ثابت 1) */
  readonly endsAt: number;
  readonly proposedBy: EntityId;
  readonly purpose: string;
}

export type ContractResult =
  | { readonly ok: true; readonly contract: ExternalContract; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };
export interface ContractRegistrySnapshot {
  readonly contracts: readonly ExternalContract[];
  readonly sequence: number;
}

/**
 * صلاحية الإنهاء: الباب الوحيد الذي يُغيّر حالة عقدٍ قائم (ثابت 8).
 * تُمنح مرة واحدة لوحدة الإنهاء، فلا يقدر مستدعٍ آخر على إسقاط عقد من خارج مسارها.
 */
export interface TerminationCapability {
  apply(contractId: string, by: EntityId, reason: string, at: number): ContractResult;
  contract(contractId: string): ExternalContract | null;
  activeContracts(now: number): readonly ExternalContract[];
}

export interface ContractRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly accounts: ExternalAccountRegistry;
  readonly risk: PartnerRisk;
  /** أقصى مدة لأي عقد — معلنة في config/contracts.yaml (ثابت 5) */
  readonly maxTermMs: number;
  /** أقصى عدد عقود قائمة لنظير واحد (ثابت 6) */
  readonly maxOpenPerCounterparty: number;
  readonly proposerId?: EntityId;
}

export class ExternalContractRegistry {
  private readonly contracts = new Map<string, ExternalContract>();
  private readonly proposerId: EntityId;
  private terminationGranted = false;
  private sequence = 0;
  /** وسيطُ الثبات (T-122) — يُربط بعد الإرجاع، وغيابُه لا يمنع التوقيع */
  private sink: DurableSink | null = null;

  constructor(private readonly deps: ContractRegistryDeps) {
    this.proposerId = deps.proposerId ?? FOREIGN_MINISTRY;
  }

  /**
   * 1) توقيع عقد خارجي. ترتيب الفحوص مقصود ومُلزم:
   * النوع ← المقترح ← الغرض ← **تاريخ الانتهاء** ← المدة ← الحساب قائم ← مدة القناة ←
   * القيمة ← تقدير المخاطر ← عدد العقود ← سقف القناة ← الأمر الملكي ← الاعتماد.
   * وتاريخ الانتهاء يُفحص **قبل** كل ما يتعلق بالمال والقناة عن قصد: عقد بلا نهاية
   * لا يُناقَش تمويله، لأنه ليس عقدًا يُقاس بل التزام بلا حدّ (شرط القبول).
   */
  sign(command: SignedRoyalCommand, input: SignContractInput, now = Date.now()): ContractResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): ContractResult => {
      const entry = this.deps.audit.append(this.proposerId, 'external_contract_refused', {
        kindId: input.kindId, value: input.value, proposedBy: input.proposedBy, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    const kind = this.deps.risk.kind(input.kindId);
    if (!kind) {
      return refuse('نوع عقد غير معلن في التهيئة — التوقيع لا يُنشئ نوعًا (ثابت 3)');
    }
    if (input.proposedBy !== this.proposerId) {
      return refuse('اقتراح العقود الخارجية لوزارة الخارجية وحدها (RULE-004)');
    }
    if (input.purpose.trim().length < 3) {
      return refuse('لا عقد بلا غرض معلن (RULE-006)');
    }
    // ثابت 1 — شرط قبول المرحلة 27: عقد بلا تاريخ انتهاء صالح يُرفض
    if (!Number.isSafeInteger(input.endsAt) || input.endsAt <= now) {
      return refuse('عقد بلا تاريخ انتهاء صالح مرفوض — لا عقد دائم (ثابت 1)', {
        endsAt: input.endsAt,
      });
    }
    if (input.endsAt - now > this.deps.maxTermMs) {
      return refuse('مدة العقد تتجاوز الحدّ المعلن للعقود الخارجية (ثابت 5)', {
        maxTermMs: this.deps.maxTermMs, requested: input.endsAt - now,
      });
    }
    // ثابت 3: لا عقد على قناة غير قائمة — والتعليق والانتهاء والإغلاق كلها عدم قيام
    const inactive = this.deps.accounts.inactiveReason(kind.counterparty, now);
    if (inactive) return refuse(`لا عقد على قناة غير قائمة: ${inactive}`);
    const account = this.deps.accounts.get(kind.counterparty);
    if (!account) return refuse('حساب النظير غير قائم');
    // ثابت 2: العقد لا يعيش بعد قناته، ولا تُمَدّ القناة لأجل عقد وُقّع عليها
    if (input.endsAt > account.expiresAt) {
      return refuse('انتهاء العقد بعد انتهاء الحساب الخارجي — لا التزام بلا قناة (ثابت 2)', {
        accountExpiresAt: account.expiresAt, contractEndsAt: input.endsAt,
      });
    }
    if (!Number.isSafeInteger(input.value) || input.value <= 0) {
      return refuse('قيمة العقد غير صالحة — لا عقد بقيمة كسرية أو غير موجبة');
    }
    if (input.value > kind.maxValue) {
      return refuse('قيمة العقد تتجاوز سقف نوعه المعلن (ثابت 3)', { maxValue: kind.maxValue });
    }
    // ثابت 4: لا افتراض سلامة — «لا تقدير» ليست «مخاطرة صفرًا»
    const riskReason = this.deps.risk.unacceptableReason(input.kindId, now);
    if (riskReason) return refuse(`لا عقد بمخاطر غير مقبولة: ${riskReason}`);
    const assessment = this.deps.risk.latest(input.kindId, now);
    if (!assessment) return refuse('تقدير المخاطر غير قائم');

    const open = this.activeFor(kind.counterparty, now);
    if (open.length >= this.deps.maxOpenPerCounterparty) {
      return refuse('عدد العقود القائمة لهذا النظير بلغ الحدّ المعلن (ثابت 6)', {
        open: open.length, max: this.deps.maxOpenPerCounterparty,
      });
    }
    // ثابت 7: مجموع ما تعهّدت به الدولة لهذا النظير لا يتجاوز سقف قناته الكلي
    const committed = this.committedValue(kind.counterparty, now) + input.value;
    if (committed > account.totalCap) {
      return refuse('مجموع قيم العقود يتجاوز السقف الكلي للحساب (ثابت 7)', {
        committed, totalCap: account.totalCap,
      });
    }
    if (command.payload.action !== 'open_external_account') {
      return refuse('التوقيع بفعل open_external_account وحده');
    }
    if (command.payload.target !== kind.id) {
      return refuse('هدف الأمر لا يطابق معرّف نوع العقد المعلن');
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    this.sequence += 1;
    const contract: ExternalContract = {
      contractId: `extc:${this.sequence}`,
      kindId: kind.id, name: kind.name, counterparty: kind.counterparty,
      purpose: input.purpose.trim(), value: input.value,
      proposedBy: input.proposedBy, signedAt: now, endsAt: input.endsAt,
      commandId: command.payload.commandId,
      assessmentId: assessment.assessmentId,
      riskScore: this.deps.risk.effectiveScore(input.kindId, now) ?? assessment.score,
      terminatedAt: null, terminatedBy: null, terminationReason: null,
    };
    this.contracts.set(contract.contractId, contract);
    // ثابت 9: التسلسلُ يُدوّن مع العقد فلا يُعاد منحُ معرّفٍ بعد إقلاع.
    this.recordDurably(contract, now);
    const entry = this.deps.audit.append(this.proposerId, 'external_contract_signed', {
      contractId: contract.contractId, kindId: kind.id, counterparty: kind.counterparty,
      value: contract.value, endsAt: contract.endsAt, termMs: contract.endsAt - now,
      assessmentId: contract.assessmentId, riskScore: contract.riskScore,
      committedTotal: committed, accountTotalCap: account.totalCap,
      commandId: contract.commandId,
    });
    return { ok: true, contract, auditId: entry.hash };
  }

  /**
   * 2) منح صلاحية الإنهاء لوحدة الإنهاء — مرة واحدة لا تتكرر (ثابت 8).
   * سببه: لو كان الإنهاء دالةً عامّة في هذا السجل لصار للعقد بابان: بابٌ بأمر ملكي
   * وبابٌ بنداء مباشر. والباب الثاني لا يُغلق بالنيّة الحسنة، بل بألّا يُخلق.
   */
  grantTerminationCapability(holder: EntityId): TerminationCapability {
    if (this.terminationGranted) {
      throw new SovereignViolation(
        'صلاحية إنهاء العقود مُنحت سابقًا — لا باب ثانٍ للإنهاء (ثابت 8)',
        'CONTRACT_TERMINATION_ALREADY_GRANTED',
      );
    }
    this.terminationGranted = true;
    this.deps.audit.append(holder, 'contract_termination_channel_bound', {
      note: 'باب واحد للإنهاء: بأمر ملكي عبر وحدة الإنهاء وحدها',
    });
    return {
      apply: (contractId, by, reason, at) => this.applyTermination(contractId, by, reason, at),
      contract: (contractId) => this.get(contractId),
      activeContracts: (now) => this.active(now),
    };
  }

  /** لا يُستدعى إلا من داخل الصلاحية الممنوحة — والفحوص السيادية سبقته في وحدة الإنهاء */
  private applyTermination(
    contractId: string, by: EntityId, reason: string, at: number,
  ): ContractResult {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      const entry = this.deps.audit.append(by, 'external_contract_refused', {
        mode: 'terminate', contractId, reason: 'عقد غير قائم',
      });
      return { ok: false, reason: 'عقد غير قائم', auditId: entry.hash };
    }
    contract.terminatedAt = at;
    contract.terminatedBy = by;
    contract.terminationReason = reason;
    // ثابت 9: الإنهاءُ تغييرُ حالةٍ لا حذفُ عقد — فيُدوّن العقدُ بحالته الجديدة،
    // وإقلاعٌ ينسى الإنهاء يُحيي التزامًا أنهاه التاج.
    this.recordDurably(contract, at);
    const entry = this.deps.audit.append(by, 'external_contract_terminated', {
      contractId, kindId: contract.kindId, counterparty: contract.counterparty,
      reason, at, immediate: true, value: contract.value,
    });
    return { ok: true, contract, auditId: entry.hash };
  }

  /** العقد القائم فعلًا: موجود، غير مُنهًى، وغير منتهي المدة (ثوابت 1 و5) */
  isActive(contractId: string, now = Date.now()): boolean {
    const contract = this.contracts.get(contractId);
    if (!contract) return false;
    return contract.terminatedAt === null && contract.endsAt > now;
  }

  /** سبب عدم القيام — حتى لا يكون الرفض بلا بيان (RULE-006) */
  inactiveReason(contractId: string, now = Date.now()): string | null {
    const contract = this.contracts.get(contractId);
    if (!contract) return 'عقد غير معلن ولا موقَّع';
    if (contract.terminatedAt !== null) {
      return `عقد مُنهًى: ${contract.terminationReason ?? 'بلا بيان'}`;
    }
    if (contract.endsAt <= now) return 'انتهت مدة العقد — لا تجديد ضمني (ثابت 5)';
    return null;
  }

  get(contractId: string): ExternalContract | null {
    return this.contracts.get(contractId) ?? null;
  }

  list(): readonly ExternalContract[] { return [...this.contracts.values()]; }

  active(now = Date.now()): readonly ExternalContract[] {
    return [...this.contracts.values()].filter((c) => this.isActive(c.contractId, now));
  }

  activeFor(counterparty: string, now = Date.now()): readonly ExternalContract[] {
    return this.active(now).filter((c) => c.counterparty === counterparty);
  }

  /** مجموع قيم العقود القائمة لنظير (ثابت 7) — المنتهي والمُنهَى لا يشغلان سقفًا */
  committedValue(counterparty: string, now = Date.now()): number {
    return this.activeFor(counterparty, now).reduce((sum, c) => sum + c.value, 0);
  }

  report(now = Date.now()): {
    signed: number; active: number; terminated: number; expired: number;
    committedValue: number; maxTermMs: number; maxOpenPerCounterparty: number;
  } {
    let terminated = 0;
    let expired = 0;
    let committed = 0;
    for (const contract of this.contracts.values()) {
      if (contract.terminatedAt !== null) terminated += 1;
      else if (contract.endsAt <= now) expired += 1;
      else committed += contract.value;
    }
    return {
      signed: this.contracts.size, active: this.active(now).length, terminated, expired,
      committedValue: committed, maxTermMs: this.deps.maxTermMs,
      maxOpenPerCounterparty: this.deps.maxOpenPerCounterparty,
    };
  }

  /** ربطُ وسيط الثبات بعد الإرجاع (T-122) — لا قبله، فلا تُدوّن الاستعادةُ نفسها */
  attachJournal(sink: DurableSink): void {
    this.sink = sink;
  }

  /** موضعٌ واحد للتدوين: حالةُ العقد كاملةً مع تسلسلِ السجل لحطةَ التغيير */
  private recordDurably(contract: ExternalContract, at: number): void {
    this.sink?.record('contract_record', {
      contractId: contract.contractId, contract: { ...contract }, sequence: this.sequence,
    }, at);
  }

  /** لقطة العقود الموقعة فقط؛ الأنواع والسياسة تبقى مقروءة من التهيئة. */
  exportAll(): ContractRegistrySnapshot {
    return {
      contracts: [...this.contracts.values()].map((contract) => ({ ...contract })),
      sequence: this.sequence,
    };
  }

  /** يستعيد الأرشيف الملكي عقودًا متحققة البنية؛ لا يمنح صلاحية إنهاء جديدة. */
  importAll(snapshot: ContractRegistrySnapshot, by: EntityId): boolean {
    if (!Array.isArray(snapshot.contracts) || !Number.isSafeInteger(snapshot.sequence)
      || snapshot.sequence < 0
      || new Set(snapshot.contracts.map((contract) => contract.contractId)).size !== snapshot.contracts.length
      || snapshot.contracts.some((contract) => !contract.contractId.startsWith('extc:')
        || !this.deps.risk.kind(contract.kindId) || !Number.isSafeInteger(contract.value)
        || contract.value <= 0 || !Number.isSafeInteger(contract.endsAt))) {
      throw new Error('RECOVERY_CONTRACT_INVALID');
    }
    this.contracts.clear();
    for (const contract of snapshot.contracts) this.contracts.set(contract.contractId, { ...contract });
    this.sequence = snapshot.sequence;
    this.deps.audit.append(by, 'external_contracts_restored', { signed: this.contracts.size });
    return true;
  }
}
