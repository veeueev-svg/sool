/**
 * src/external/contract_termination.ts — إنهاء العقود الخارجية وتسويتها (المرحلة 27)
 * المالك: التاج — والإنهاء يُنفَّذ بجهة معلنة، والتسوية بوزارة المالية
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عقد قائم في سجل العقود + أمر ملكي بفعل open_external_account هدفه معرّف العقد
 * المخرجات: إنهاء واقع في اللحظة نفسها، وقناة مال مقطوعة معه، ونافذة تسوية معلنة
 * التبعيات: بوابة التاج، صلاحية الإنهاء الممنوحة مرة واحدة، سجل الحسابات الخارجية
 * الصلاحيات: الإنهاء لجهة معلنة **بأمر ملكي**؛ والتسوية لوزارة المالية — **ومن أنهى
 *            لا يُسوّي** (RULE-004)
 * السجلات: contract_termination_executed / contract_termination_refused /
 *           contract_settlement_recorded / contract_settlement_overdue /
 *           contracts_terminated_all
 * ثوابت هذه الوحدة:
 *   1) **الإنهاء بأمر ملكي**: تعليقُ قناة المال فعل حماية رخيص يقع بلا أمر (المرحلة 26)،
 *      أمّا إسقاط التزام معلن فهو فعل قانوني لا يقع إلا من التاج (شرط قبول المرحلة)
 *   2) **الإنهاء فوري**: العقد غير قائم في **اللحظة نفسها** — لا مدة سماح ولا نفاذ مؤجَّل
 *   3) **الإنهاء يقطع قناة المال معه**: الحساب الخارجي يُعلَّق في اللحظة ذاتها، فلا يبقى
 *      عقدٌ مُنهًى وقناته مفتوحة تدفع
 *   4) **لا إنهاء مرتين ولا إنهاء لمنتهٍ**: العقد غير القائم لا يُنهى — ولا يُعاد فتحه
 *   5) **الإنهاء لا يُسقط التزامًا**: يفتح نافذة تسوية معلنة، والالتزام القائم يُسوَّى فيها
 *   6) **من أنهى لا يُسوّي** (RULE-004): التسوية بوزارة المالية وبمرجع إثبات
 *   7) **ما لم يُسوَّ يُرفع متأخرًا بلا عقوبة** (RULE-006): الرفع بيانٌ لا جزاء
 *   8) **باب واحد**: هذه الوحدة لا تملك السجل، بل صلاحيةً مُنحت مرة واحدة (ثابت 8 للسجل)
 * حالات الفشل (كلها مغلقة): عقد غير قائم ⇒ رفض؛ جهة غير مخوَّلة ⇒ رفض؛ بلا سبب ⇒ رفض؛
 *   أمر بغير الفعل أو بغير الهدف ⇒ رفض؛ أمر غير معتمد ⇒ رفض؛ تسوية من غير المالية ⇒ رفض؛
 *   تسوية بمرجع أقصر من ثمانية أحرف ⇒ رفض؛ تسوية على التزام غير مُثبَت ⇒ رفض
 * اختبار القبول: tests/external/external_contracts_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0011-external-contracts.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { FINANCE_MINISTRY } from '../economy/ledger';
import { ExternalAccountRegistry } from './account_registry';
import { ContractResult, ExternalContract, TerminationCapability } from './contract_registry';

/** هدف الأمر الملكي لإنهاء كل العقود دفعةً واحدة (المرحلة 34 — الانقطاع) */
export const ALL_CONTRACTS_TARGET = 'contract:all';

export interface SettlementRecord {
  readonly contractId: string;
  readonly counterparty: string;
  readonly terminatedBy: EntityId;
  readonly terminatedAt: number;
  /** آخر لحظة تُقبل فيها التسوية قبل رفعها متأخرة (ثابتا 5 و7) */
  readonly dueAt: number;
  /** عدد الالتزامات غير المُثبَتة لحظة الإنهاء — لا يُنسى بالإنهاء (ثابت 5) */
  readonly obligationsAtTermination: number;
  settledAt: number | null;
  settledBy: EntityId | null;
  evidence: string | null;
  overdueRaisedAt: number | null;
}

export type SettlementResult =
  | { readonly ok: true; readonly record: SettlementRecord; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** عدد الالتزامات غير المُثبَتة لحساب — يُربط من ضوابط الدفع (المرحلة 26) */
export type ObligationProbe = (accountId: string) => number;

export interface ContractTerminationDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly accounts: ExternalAccountRegistry;
  /** الصلاحية الممنوحة مرة واحدة من سجل العقود (ثابت 8) */
  readonly capability: TerminationCapability;
  /** من يملك تنفيذ الإنهاء — معلنون في التهيئة، وبأمر ملكي معهم (ثابت 1) */
  readonly terminationAuthorities: readonly EntityId[];
  /** نافذة التسوية المعلنة في config/contracts.yaml (ثابت 5) */
  readonly settlementWindowMs: number;
  /** هل يُعلَّق الحساب الخارجي مع الإنهاء؟ قيمتها الملزمة: نعم (ثابت 3) */
  readonly suspendsAccount: boolean;
  readonly settlerId?: EntityId;
}

export class ContractTermination {
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly settlerId: EntityId;
  private obligationProbe: ObligationProbe | null = null;

  constructor(private readonly deps: ContractTerminationDeps) {
    this.settlerId = deps.settlerId ?? FINANCE_MINISTRY;
  }

  /** ربط مصدر التحقق من الالتزامات غير المُثبَتة (ثابت 5) */
  bindObligationProbe(probe: ObligationProbe): void {
    this.obligationProbe = probe;
  }

  /**
   * 1) إنهاء عقد خارجي: **فوري وبأمر ملكي** (شرط قبول المرحلة 27).
   * ترتيب الفحوص مقصود: العقد قائم ← الجهة مخوَّلة ← السبب ← الفعل ← الهدف ← الاعتماد،
   * ثم الإنهاء، ثم **تعليق قناة المال في اللحظة نفسها**، ثم فتح نافذة التسوية.
   */
  terminate(
    command: SignedRoyalCommand, contractId: string, by: EntityId,
    reason: string, now = Date.now(),
  ): ContractResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): ContractResult => {
      const entry = this.deps.audit.append(by, 'contract_termination_refused', {
        contractId, reason: why, ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };

    const contract = this.deps.capability.contract(contractId);
    if (!contract) return refuse('عقد غير قائم');
    // ثابت 4: لا إنهاء مرتين، ولا إنهاء لعقد انتهت مدته أصلًا
    if (contract.terminatedAt !== null) return refuse('عقد مُنهًى سابقًا — لا إنهاء مرتين');
    if (contract.endsAt <= now) return refuse('عقد انتهت مدته — لا إنهاء لغير قائم');
    if (!this.deps.terminationAuthorities.includes(by)) {
      return refuse('الإنهاء لجهة معلنة في التهيئة وحدها');
    }
    if (reason.trim().length < 3) return refuse('لا إنهاء بلا سبب معلن (RULE-006)');
    // ثابت 1: الأمر الملكي شرطٌ — والفرق عن التعليق مقصود ومُعلن في ADR-0011
    if (command.payload.action !== 'open_external_account') {
      return refuse('الإنهاء بفعل open_external_account وحده');
    }
    if (command.payload.target !== contractId) {
      return refuse('هدف الأمر لا يطابق معرّف العقد');
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    // ثابت 2: يقع الأثر عند `now` نفسه — لا نفاذ مؤجَّل
    const applied = this.deps.capability.apply(contractId, by, reason.trim(), now);
    if (!applied.ok) return applied;

    // ثابت 3: قناة المال تُقطع مع العقد في اللحظة ذاتها
    let accountSuspended = false;
    if (this.deps.suspendsAccount) {
      const suspension = this.deps.accounts.suspend(
        by, contract.counterparty, `إنهاء عقد ${contractId}: ${reason.trim()}`, now,
      );
      accountSuspended = suspension.ok
        || !this.deps.accounts.isActive(contract.counterparty, now);
    }

    // ثابت 5: الإنهاء لا يُسقط التزامًا — يفتح له نافذة تسوية معلنة
    const obligations = this.obligationProbe
      ? this.obligationProbe(contract.counterparty) : 0;
    const record: SettlementRecord = {
      contractId, counterparty: contract.counterparty, terminatedBy: by, terminatedAt: now,
      dueAt: now + this.deps.settlementWindowMs,
      obligationsAtTermination: obligations,
      settledAt: null, settledBy: null, evidence: null, overdueRaisedAt: null,
    };
    this.settlements.set(contractId, record);
    const entry = this.deps.audit.append(by, 'contract_termination_executed', {
      contractId, counterparty: contract.counterparty, reason: reason.trim(),
      at: now, immediate: true, accountSuspended,
      obligations, settlementDueAt: record.dueAt,
      commandId: command.payload.commandId,
    });
    return { ok: true, contract: applied.contract, auditId: entry.hash };
  }

  /**
   * 2) إنهاء كل العقود القائمة بأمر ملكي واحد — لحالات الانقطاع (المرحلة 34).
   * ويُعلَّق معه الخارج كلّه بنداء واحد، فلا تبقى قناة مفتوحة على عقد ساقط.
   */
  terminateAll(
    command: SignedRoyalCommand, by: EntityId, reason: string, now = Date.now(),
  ): Decision {
    const refuse = (why: string): Decision => {
      const entry = this.deps.audit.append(by, 'contract_termination_refused', {
        mode: 'terminate_all', reason: why,
      });
      return { allowed: false, reason: why, auditId: entry.hash };
    };
    if (!this.deps.terminationAuthorities.includes(by)) {
      return refuse('الإنهاء لجهة معلنة في التهيئة وحدها');
    }
    if (reason.trim().length < 3) return refuse('لا إنهاء بلا سبب معلن');
    if (command.payload.action !== 'open_external_account') {
      return refuse('الإنهاء بفعل open_external_account وحده');
    }
    if (command.payload.target !== ALL_CONTRACTS_TARGET) {
      return refuse(`هدف أمر الإنهاء الشامل يجب أن يكون ${ALL_CONTRACTS_TARGET}`);
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const affected: string[] = [];
    for (const contract of this.deps.capability.activeContracts(now)) {
      const applied = this.deps.capability.apply(contract.contractId, by, reason.trim(), now);
      if (!applied.ok) continue;
      affected.push(contract.contractId);
      const obligations = this.obligationProbe
        ? this.obligationProbe(contract.counterparty) : 0;
      this.settlements.set(contract.contractId, {
        contractId: contract.contractId, counterparty: contract.counterparty,
        terminatedBy: by, terminatedAt: now, dueAt: now + this.deps.settlementWindowMs,
        obligationsAtTermination: obligations,
        settledAt: null, settledBy: null, evidence: null, overdueRaisedAt: null,
      });
    }
    if (this.deps.suspendsAccount) {
      this.deps.accounts.suspendAll(by, `إنهاء شامل للعقود: ${reason.trim()}`, now);
    }
    const entry = this.deps.audit.append(by, 'contracts_terminated_all', {
      reason: reason.trim(), affected, count: affected.length, at: now, immediate: true,
    });
    return {
      allowed: true, reason: `أُنهي ${affected.length} عقدًا فورًا`, auditId: entry.hash,
    };
  }

  /**
   * 3) تسوية التزامات عقد مُنهًى (ثوابت 5 و6): بوزارة المالية، **وبغير من أنهى**،
   * وبمرجع إثبات، ولا تقع وللحساب دفعة لم يُقرّ استلامها.
   */
  settle(contractId: string, by: EntityId, evidence: string, now = Date.now()): SettlementResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): SettlementResult => {
      const entry = this.deps.audit.append(by, 'contract_termination_refused', {
        mode: 'settle', contractId, reason: why, ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const record = this.settlements.get(contractId);
    if (!record) return refuse('لا نافذة تسوية لهذا العقد — لم يُنهَ');
    if (record.settledAt !== null) return refuse('تسوية مسجَّلة سابقًا — لا تسوية مرتين');
    // ثابت 6: من أنهى لا يُسوّي، والتسوية اختصاص معلن لا اجتهاد
    if (by === record.terminatedBy) return refuse('لا يسوّي الالتزامَ من أنهى العقد (RULE-004)');
    if (by !== this.settlerId) return refuse('التسوية لوزارة المالية وحدها');
    if (evidence.trim().length < 8) return refuse('لا تسوية بلا مرجع إثبات معلن');
    const pending = this.obligationProbe ? this.obligationProbe(record.counterparty) : 0;
    if (pending > 0) {
      return refuse('لا تسوية على التزام لم يُثبَت استلامه (ثابت 5)', { pending });
    }

    record.settledAt = now;
    record.settledBy = by;
    record.evidence = evidence.trim();
    const entry = this.deps.audit.append(by, 'contract_settlement_recorded', {
      contractId, counterparty: record.counterparty, evidence: record.evidence,
      at: now, dueAt: record.dueAt, onTime: now <= record.dueAt,
      obligationsAtTermination: record.obligationsAtTermination,
    });
    return { ok: true, record, auditId: entry.hash };
  }

  /** 4) رفع التسويات المتأخرة (ثابت 7): بيانٌ لا عقوبة، ومرة واحدة لكل عقد */
  raiseUnsettled(now = Date.now()): readonly SettlementRecord[] {
    const raised: SettlementRecord[] = [];
    for (const record of this.settlements.values()) {
      if (record.settledAt !== null || record.overdueRaisedAt !== null) continue;
      if (record.dueAt > now) continue;
      record.overdueRaisedAt = now;
      this.deps.audit.append(this.settlerId, 'contract_settlement_overdue', {
        contractId: record.contractId, counterparty: record.counterparty,
        dueAt: record.dueAt, at: now, lateBy: now - record.dueAt, penalty: 'لا عقوبة — بيان',
      });
      raised.push(record);
    }
    return raised;
  }

  settlement(contractId: string): SettlementRecord | null {
    return this.settlements.get(contractId) ?? null;
  }

  allSettlements(): readonly SettlementRecord[] { return [...this.settlements.values()]; }

  /** العقد المُنهى الذي لم تُسوَّ التزاماته بعد — يُقرأ ولا يُصحَّح تلقائيًّا */
  unsettled(now = Date.now()): readonly SettlementRecord[] {
    return [...this.settlements.values()].filter(
      (r) => r.settledAt === null && r.dueAt <= now,
    );
  }

  report(now = Date.now()): {
    terminated: number; settled: number; pending: number; overdue: number;
    settlementWindowMs: number; suspendsAccount: boolean;
  } {
    let settled = 0;
    let overdue = 0;
    for (const record of this.settlements.values()) {
      if (record.settledAt !== null) settled += 1;
      else if (record.dueAt <= now) overdue += 1;
    }
    return {
      terminated: this.settlements.size, settled,
      pending: this.settlements.size - settled - overdue, overdue,
      settlementWindowMs: this.deps.settlementWindowMs,
      suspendsAccount: this.deps.suspendsAccount,
    };
  }
}

/** يُعاد تصديره تسهيلًا للقراءة: العقد كما يراه من يُنهيه */
export type { ExternalContract };
