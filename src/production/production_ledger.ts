/**
 * src/production/production_ledger.ts — دفتر حكم التشغيل الاتحادي (المرحلة 37)
 * المالك: ديوان التدقيق يحكم، والديوان الملكي يشغّل ولا يحكم لنفسه (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: دعوى المشغّل، تقرير المراقبة المستمرة، أدلة الأقاليم، أدلة المرور،
 *           أدلة كتب التشغيل، وقارئان مستقلان لسلامة السلسلة ووضع الدولة
 * المخرجات: حكمٌ مقيَّد بخروقه بأسمائها، وتصعيدٌ عند الخرق
 * التبعيات: AppendOnlyLog, ProductionConfig, SupervisionReport
 * الصلاحيات: الحكم والتقييد والتصعيد؛ ولا يُصلح ولا يُشغّل ولا يفتح مرورًا
 * السجلات: production_operation_declared / production_breach / production_verdict
 * ثوابت هذه الوحدة:
 *   1) **الدعوى تُقابل بالقياس**: ما يقوله المشغّل عن كتبه وأقاليمه يُقابل بما رآه
 *      المنفّذ والمراقب — ولا يُقبل ادعاءٌ وحده (درس المرحلة 36)
 *   2) **الخرق الواحد يُسقط الحكم كلّه**: لا حكم «مقبول جزئيًّا»
 *   3) **تُجمع كل الخروق ثم يُحكم**: لا يرمي عند أول خرق، كي يرى القارئ الصورة كلها
 *   4) **«كل الأقاليم تعمل» تُقاس فعلًا**: لكل إقليم مشترط: قائم، له حاكم، وله فعلٌ
 *      **نفُذ ومرّ** — إقليمٌ معلن لا يعمل ليس عاملًا وإن ورد في تهيئة
 *   5) **الإنفاذ يُثبت برفضٍ حقيقي**: عددُ محاولات التجاوز المرفوضة دون الحدّ المعلن
 *      خرقٌ — «مُنفَّذ» بلا محاولةٍ مرفوضة دعوى لا دليل
 *   6) **المراقبة المستمرة تُحكم بجريانها لا بماضيها**: مراقبةٌ توقّفت قبل الحكم
 *      ليست مستمرة، وفجوةٌ واحدة مُعلنة تُسقط الاستمرار
 *   7) **الشدّة والحدود من التهيئة** (RULE-005)
 * حالات الفشل (كلها مغلقة): لكل رمز خرق اختبارٌ يُسقطه وحده
 * اختبار القبول: tests/production/production_ledger.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ProductionConfig, PRODUCTION_OPERATORS } from '../kernel/config';
import { SupervisionReport } from './continuous_supervisor';

/** رموز الخرق. كل رمز يُسقطه اختبارٌ وحده — فلا رمزٌ معلن لا يقع. */
export const PROD_OBSERVER_IS_OPERATOR = 'PROD_OBSERVER_IS_OPERATOR';
export const PROD_OBSERVER_UNDECLARED = 'PROD_OBSERVER_UNDECLARED';
export const PROD_OPERATOR_UNDECLARED = 'PROD_OPERATOR_UNDECLARED';
export const PROD_NO_SUPERVISION_REPORT = 'PROD_NO_SUPERVISION_REPORT';
export const PROD_SUPERVISION_NOT_RUNNING = 'PROD_SUPERVISION_NOT_RUNNING';
export const PROD_SUPERVISION_LATE = 'PROD_SUPERVISION_LATE';
export const PROD_SUPERVISION_GAP = 'PROD_SUPERVISION_GAP';
export const PROD_SWEEPS_UNDER_MIN = 'PROD_SWEEPS_UNDER_MIN';
export const PROD_SCANNER_NOT_OBSERVED = 'PROD_SCANNER_NOT_OBSERVED';
export const PROD_SCANNER_FAILED = 'PROD_SCANNER_FAILED';
export const PROD_CRITICAL_INCIDENT = 'PROD_CRITICAL_INCIDENT';
export const PROD_REGION_MISSING = 'PROD_REGION_MISSING';
export const PROD_REGION_WITHOUT_GOVERNOR = 'PROD_REGION_WITHOUT_GOVERNOR';
export const PROD_REGION_NOT_ACTING = 'PROD_REGION_NOT_ACTING';
export const PROD_REGION_SUSPENDED = 'PROD_REGION_SUSPENDED';
export const PROD_PASSAGE_NOT_ENFORCED = 'PROD_PASSAGE_NOT_ENFORCED';
export const PROD_PASSAGE_UNPROVEN = 'PROD_PASSAGE_UNPROVEN';
export const PROD_ACTION_WITHOUT_PASSAGE = 'PROD_ACTION_WITHOUT_PASSAGE';
export const PROD_RUNBOOK_NOT_EXECUTED = 'PROD_RUNBOOK_NOT_EXECUTED';
export const PROD_RUNBOOK_FAILED = 'PROD_RUNBOOK_FAILED';
export const PROD_AUDIT_CHAIN_BROKEN = 'PROD_AUDIT_CHAIN_BROKEN';
export const PROD_STATE_HALTED = 'PROD_STATE_HALTED';

export const PRODUCTION_BREACH_CODES: readonly string[] = [
  PROD_OBSERVER_IS_OPERATOR, PROD_OBSERVER_UNDECLARED, PROD_OPERATOR_UNDECLARED,
  PROD_NO_SUPERVISION_REPORT, PROD_SUPERVISION_NOT_RUNNING, PROD_SUPERVISION_LATE,
  PROD_SUPERVISION_GAP, PROD_SWEEPS_UNDER_MIN, PROD_SCANNER_NOT_OBSERVED,
  PROD_SCANNER_FAILED, PROD_CRITICAL_INCIDENT, PROD_REGION_MISSING,
  PROD_REGION_WITHOUT_GOVERNOR, PROD_REGION_NOT_ACTING, PROD_REGION_SUSPENDED,
  PROD_PASSAGE_NOT_ENFORCED, PROD_PASSAGE_UNPROVEN, PROD_ACTION_WITHOUT_PASSAGE,
  PROD_RUNBOOK_NOT_EXECUTED, PROD_RUNBOOK_FAILED, PROD_AUDIT_CHAIN_BROKEN,
  PROD_STATE_HALTED,
];

/** دعوى المشغّل عن تشغيله — تُقابل بالقياس ولا تُقبل وحدها (ثابت 1) */
export interface OperationClaim {
  readonly operator: EntityId;
  readonly observer: EntityId;
  readonly startedAt: number;
  readonly runbooksClaimed: readonly string[];
}

/** ما يُقاس عن كل إقليم مشترط (ثابت 4) — يُبنى من الوحدات لا من الدعوى */
export interface RegionEvidence {
  readonly regionId: EntityId;
  readonly active: boolean;
  readonly suspended: boolean;
  readonly governor: EntityId | null;
  /** أفعال نفَذت فعلًا لهذا الإقليم داخل التشغيل */
  readonly actionsExecuted: number;
  /** أفعال استوفت إذن مرور التاج */
  readonly actionsPassed: number;
}

/** ما يُقاس عن مرور التاج (ثابت 5) */
export interface PassageEvidence {
  readonly enforced: boolean;
  readonly granted: number;
  readonly passed: number;
  readonly blockedAttempts: number;
  readonly executedWithoutPassage: number;
}

export interface RunbookEvidence {
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

export interface ProductionVerdict {
  readonly passed: boolean;
  readonly sweeps: number;
  readonly minSweeps: number;
  readonly criticalIncidents: number;
  readonly highIncidents: number;
  readonly regionsOperating: number;
  readonly regionsRequired: number;
  readonly blockedBypasses: number;
  readonly runbooksExecuted: readonly string[];
  readonly breaches: readonly string[];
  readonly escalated: boolean;
  readonly auditId: string;
}

export interface ProductionLedgerDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: ProductionConfig['policy'];
  /** قارئ سلامة السلسلة — مصدرٌ مستقل عن دعوى المشغّل (RULE-006) */
  readonly chainValid: () => boolean;
  readonly stateHalted: () => boolean;
}

export class ProductionLedger {
  private readonly breaches: string[] = [];
  private verdict_: ProductionVerdict | null = null;

  constructor(private readonly deps: ProductionLedgerDeps) {}

  /** إعلان التشغيل قبل الحكم — كي يُقاس ما أُعلن لا ما رُوي بعده (RULE-006) */
  declareOperation(claim: OperationClaim): string {
    const entry = this.deps.audit.append(claim.operator, 'production_operation_declared', {
      operator: claim.operator, observer: claim.observer, startedAt: claim.startedAt,
      runbooksClaimed: [...claim.runbooksClaimed],
      requiredRegions: [...this.deps.policy.regions.required],
      minSweeps: this.deps.policy.supervision.min_sweeps,
    });
    return entry.hash;
  }

  /** الحكم. يجمع كل الخروق ثم يحكم (ثابت 3)، وواحدٌ منها يُسقط الكل (ثابت 2). */
  judge(
    claim: OperationClaim,
    supervision: SupervisionReport | null,
    regions: readonly RegionEvidence[],
    passage: PassageEvidence,
    runbooks: RunbookEvidence,
  ): ProductionVerdict {
    const policy = this.deps.policy;
    const breach = (code: string, detail: Record<string, unknown>): void => {
      this.breaches.push(code);
      this.deps.audit.append(policy.observer_authority, 'production_breach', { code, ...detail });
    };

    // (1) المراقب مستقل عن المشغّل — كل قياس بعده يستند إلى استقلاله
    if (claim.observer === claim.operator) {
      breach(PROD_OBSERVER_IS_OPERATOR, { operator: claim.operator });
    }
    if (PRODUCTION_OPERATORS.includes(claim.observer) || claim.observer !== policy.observer_authority) {
      breach(PROD_OBSERVER_UNDECLARED, { observer: claim.observer, declared: policy.observer_authority });
    }
    if (!PRODUCTION_OPERATORS.includes(claim.operator)) {
      breach(PROD_OPERATOR_UNDECLARED, { operator: claim.operator });
    }

    // (2) المراقبة المستمرة (ثابت 6)
    if (supervision === null) {
      breach(PROD_NO_SUPERVISION_REPORT, { note: 'لا تقرير مراقبة — الدعوى وحدها لا تُحكم' });
    } else {
      if (!supervision.running) {
        breach(PROD_SUPERVISION_NOT_RUNNING, {
          note: 'المراقبة متوقفة عند الحكم — «مستمرة» تُحكم بجريانها',
          sweeps: supervision.sweeps,
        });
      }
      const late = supervision.firstSweepAt === null
        ? Infinity
        : supervision.firstSweepAt - supervision.bootAt;
      if (late > policy.supervision.start_grace_ms) {
        breach(PROD_SUPERVISION_LATE, {
          lateMs: Number.isFinite(late) ? late : null,
          graceMs: policy.supervision.start_grace_ms,
          note: 'زمنٌ بين الإقلاع وأول مسحة بقي غير مراقَب',
        });
      }
      if (supervision.gaps.length > 0) {
        breach(PROD_SUPERVISION_GAP, {
          gaps: supervision.gaps.map((g) => ({ kind: g.kind, ms: g.ms })),
        });
      }
      if (supervision.sweeps < policy.supervision.min_sweeps) {
        breach(PROD_SWEEPS_UNDER_MIN, {
          sweeps: supervision.sweeps, minSweeps: policy.supervision.min_sweeps,
        });
      }
      for (const scanner of policy.scanners) {
        const count = supervision.scannerSweeps[scanner] ?? 0;
        if (count <= policy.tolerance.max_unwatched) {
          breach(PROD_SCANNER_NOT_OBSERVED, { scanner, sweeps: count });
        }
      }
      if (supervision.failedSweeps > policy.tolerance.max_failed_sweeps) {
        breach(PROD_SCANNER_FAILED, {
          failedSweeps: supervision.failedSweeps, tolerated: policy.tolerance.max_failed_sweeps,
        });
      }
      if (supervision.critical > policy.tolerance.max_critical) {
        breach(PROD_CRITICAL_INCIDENT, {
          critical: supervision.critical, tolerated: policy.tolerance.max_critical,
          kinds: supervision.incidents.filter((i) => i.severity === 'critical').map((i) => i.kind),
        });
      }
    }

    // (3) كل الأقاليم تعمل فعلًا (ثابت 4)
    let operating = 0;
    for (const regionId of policy.regions.required) {
      const evidence = regions.find((r) => r.regionId === regionId);
      if (!evidence || !evidence.active) {
        breach(PROD_REGION_MISSING, { regionId, note: 'إقليم مشترط غير قائم' });
        continue;
      }
      if (evidence.suspended) {
        breach(PROD_REGION_SUSPENDED, { regionId });
      }
      if (policy.regions.require_governor && !evidence.governor) {
        breach(PROD_REGION_WITHOUT_GOVERNOR, { regionId });
      }
      if (evidence.actionsExecuted === 0) {
        breach(PROD_REGION_NOT_ACTING, {
          regionId, note: 'إقليم قائم بلا فعل مُقاس — الإعلان ليس عملًا (RULE-001)',
        });
        continue;
      }
      if (policy.regions.require_crown_passage && evidence.actionsPassed === 0) {
        breach(PROD_ACTION_WITHOUT_PASSAGE, {
          regionId, executed: evidence.actionsExecuted, passed: evidence.actionsPassed,
        });
        continue;
      }
      operating += 1;
    }

    // (4) مرور التاج مُنفَّذ ومُثبت (ثابت 5)
    if (policy.regions.require_crown_passage) {
      if (!passage.enforced) {
        breach(PROD_PASSAGE_NOT_ENFORCED, { note: 'مرور التاج غير مربوط أو غير مفتوح' });
      }
      if (passage.blockedAttempts < policy.tolerance.min_bypass_proof) {
        breach(PROD_PASSAGE_UNPROVEN, {
          blocked: passage.blockedAttempts, required: policy.tolerance.min_bypass_proof,
          note: '«مُنفَّذ» بلا محاولة تجاوزٍ مرفوضة دعوى لا دليل',
        });
      }
      if (passage.executedWithoutPassage > policy.tolerance.max_unpassed_action) {
        breach(PROD_ACTION_WITHOUT_PASSAGE, {
          count: passage.executedWithoutPassage, tolerated: policy.tolerance.max_unpassed_action,
        });
      }
    }

    // (5) كتب التشغيل نُفّذت فعلًا — من المنفّذ لا من الدعوى (ثابت 1)
    if (policy.require_runbook_execution) {
      for (const book of policy.runbooks) {
        if (runbooks.failed.includes(book)) {
          breach(PROD_RUNBOOK_FAILED, { runbook: book });
          continue;
        }
        if (!runbooks.passed.includes(book)) {
          breach(PROD_RUNBOOK_NOT_EXECUTED, {
            runbook: book, claimed: claim.runbooksClaimed.includes(book),
          });
        }
      }
    }

    // (6) مصدران مستقلان عن الدعوى
    if (!this.deps.chainValid()) {
      breach(PROD_AUDIT_CHAIN_BROKEN, { note: 'سلسلة التدقيق مكسورة — كل شهادة تُبنى عليها باطلة' });
    }
    if (this.deps.stateHalted()) {
      breach(PROD_STATE_HALTED, { note: 'الدولة موقوفة عند الحكم — التشغيل لم يمرّ بسلام' });
    }

    const passed = this.breaches.length === 0;
    const escalated = !passed && policy.escalate_on_breach;
    const entry = this.deps.audit.append(policy.observer_authority, 'production_verdict', {
      passed, sweeps: supervision?.sweeps ?? 0, minSweeps: policy.supervision.min_sweeps,
      critical: supervision?.critical ?? 0, high: supervision?.high ?? 0,
      regionsOperating: operating, regionsRequired: policy.regions.required.length,
      blockedBypasses: passage.blockedAttempts,
      breaches: [...this.breaches], escalated, runbooks: [...runbooks.passed],
    });
    const verdict: ProductionVerdict = {
      passed,
      sweeps: supervision?.sweeps ?? 0,
      minSweeps: policy.supervision.min_sweeps,
      criticalIncidents: supervision?.critical ?? 0,
      highIncidents: supervision?.high ?? 0,
      regionsOperating: operating,
      regionsRequired: policy.regions.required.length,
      blockedBypasses: passage.blockedAttempts,
      runbooksExecuted: [...runbooks.passed],
      breaches: [...this.breaches],
      escalated,
      auditId: entry.hash,
    };
    this.verdict_ = verdict;
    return verdict;
  }

  verdict(): ProductionVerdict | null { return this.verdict_; }
}
