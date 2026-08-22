/**
 * src/staging/staging_ledger.ts — دفتر الحكم على نافذة التشغيل المحدود (المرحلة 36)
 * المالك: ديوان التدقيق وحده يحكم — والمشغّل لا يحكم على نافذته (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: دعوى المشغّل (مدة النافذة والكتب المنفَّذة) + تقرير المراقب المستقل
 * المخرجات: حكمٌ واحد لا يُجزَّأ: مرّت النافذة أو لم تمرّ، وكل خرق باسمه ورمزه
 * التبعيات: السجل غير القابل للمحو، سياسة `loadStaging()`، تقرير `IncidentMonitor`
 * الصلاحيات: الحكم والتقييد والتصعيد؛ **ولا يُصلح ما يجده ولا يُشغّل نافذة**
 * السجلات: staging_window_declared / staging_breach / staging_verdict
 * ثوابت هذه الوحدة:
 *   1) **الدعوى تُقابل بالقياس**: ما يقوله المشغّل عن نافذته لا يُقبل إلا من تقرير
 *      مراقبٍ مستقل — وهذا هو درس المرحلة 35 منقولًا: لا يُصدَّق أثرٌ من مُنتِجه
 *   2) **نافذة لم تكتمل مدّتها لا تمرّ**: القبول «لمدة مراقبة **كاملة**»، فالقطع قبل
 *      المدة ليس نجاحًا مختصرًا بل شرطًا لم يُستوفَ
 *   3) **نافذة بلا مسح ليست نافذة مراقبة**: عدد المسحات دون `min_ticks` خرقٌ باسمه.
 *      هذا الفرق بين «لم يقع حادث» و«لم ينظر أحد» — وهو ثقب المرحلة المُقاس
 *   4) **حرس معلن لم يمسح قطّ خرقٌ**: نظير `CHAOS_CUT_NOT_OBSERVED` في المرحلة 34
 *   5) **الحكم على ما أعلنته التهيئة لا على ما قِيس**: كتابٌ معلن لم يُنفَّذ خرقٌ ولو
 *      مرّت النافذة بلا حادث، وحرسٌ معلن لم يمسح خرقٌ ولو لم يجد غيره شيئًا
 *   6) **لا يُرمى عند أول خرق**: تُجمع الخروق كلها ويُرى التقرير كاملًا (نظير ADR-0018
 *      قرار 3 وADR-0019 قرار 4) — والأصدق أنفع من الأقصر
 *   7) **خرقٌ واحد يُسقط الحكم كلّه**: لا حكم جزئي ولا «مرّت مع ملاحظات»
 *   8) **كل خرق يُصعَّد ويُقيَّد**: بما فيه خروق مستوى النافذة التي لا تُنسب إلى حرس
 * حالات الفشل (كلها مغلقة): مراقب هو المشغّل ⇒ خرق؛ مدة ناقصة ⇒ خرق؛ مسحات دون الحد
 *   ⇒ خرق؛ حرس بلا مسح ⇒ خرق؛ مسحة انهارت ⇒ خرق؛ حادث حرج ⇒ خرق؛ كتاب معلن لم يُنفَّذ
 *   أو فشل ⇒ خرق؛ سلسلة تدقيق مكسورة ⇒ خرق
 * اختبار القبول: tests/staging/staging_ledger.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0020-limited-operation.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { StagingConfig, STAGING_OPERATORS } from '../kernel/config';
import { MonitorReport } from './incident_monitor';

/** رموز الخرق. كل رمز يُسقطه اختبارٌ وحده — فلا رمزٌ معلن لا يقع (درس الجلسة 13). */
export const STAGE_OBSERVER_IS_OPERATOR = 'STAGE_OBSERVER_IS_OPERATOR';
export const STAGE_OBSERVER_UNDECLARED = 'STAGE_OBSERVER_UNDECLARED';
export const STAGE_WINDOW_INCOMPLETE = 'STAGE_WINDOW_INCOMPLETE';
export const STAGE_TICKS_UNDER_MIN = 'STAGE_TICKS_UNDER_MIN';
export const STAGE_WATCH_NOT_OBSERVED = 'STAGE_WATCH_NOT_OBSERVED';
export const STAGE_WATCH_FAILED = 'STAGE_WATCH_FAILED';
export const STAGE_CRITICAL_INCIDENT = 'STAGE_CRITICAL_INCIDENT';
export const STAGE_RUNBOOK_NOT_EXECUTED = 'STAGE_RUNBOOK_NOT_EXECUTED';
export const STAGE_RUNBOOK_FAILED = 'STAGE_RUNBOOK_FAILED';
export const STAGE_AUDIT_CHAIN_BROKEN = 'STAGE_AUDIT_CHAIN_BROKEN';
export const STAGE_STATE_HALTED = 'STAGE_STATE_HALTED';
export const STAGE_SCOPE_NOT_OPENED = 'STAGE_SCOPE_NOT_OPENED';
export const STAGE_NO_MONITOR_REPORT = 'STAGE_NO_MONITOR_REPORT';

export const STAGING_BREACH_CODES: readonly string[] = [
  STAGE_OBSERVER_IS_OPERATOR, STAGE_OBSERVER_UNDECLARED, STAGE_WINDOW_INCOMPLETE,
  STAGE_TICKS_UNDER_MIN, STAGE_WATCH_NOT_OBSERVED, STAGE_WATCH_FAILED,
  STAGE_CRITICAL_INCIDENT, STAGE_RUNBOOK_NOT_EXECUTED, STAGE_RUNBOOK_FAILED,
  STAGE_AUDIT_CHAIN_BROKEN, STAGE_STATE_HALTED, STAGE_SCOPE_NOT_OPENED,
  STAGE_NO_MONITOR_REPORT,
];

/** دعوى المشغّل عن نافذته — تُقابل بالقياس ولا تُقبل وحدها (ثابت 1) */
export interface WindowClaim {
  readonly operator: EntityId;
  readonly observer: EntityId;
  readonly startedAt: number;
  readonly endedAt: number;
  /** الكتب التي يدّعي المشغّل تنفيذها — تُقابل بما نفّذه المنفّذ فعلًا */
  readonly runbooksClaimed: readonly string[];
  readonly scopeWasOpened: boolean;
}

/** ما يقرأه الدفتر من المنفّذ لا من الدعوى */
export interface RunbookEvidence {
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

export interface StagingVerdict {
  readonly passed: boolean;
  readonly durationMs: number;
  readonly requiredMs: number;
  readonly ticks: number;
  readonly criticalIncidents: number;
  readonly highIncidents: number;
  readonly runbooksExecuted: readonly string[];
  readonly breaches: readonly string[];
  readonly escalated: boolean;
  readonly auditId: string;
}

export interface StagingLedgerDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: StagingConfig['policy'];
  /** قارئ سلامة السلسلة — مصدرٌ مستقل عن دعوى المشغّل (RULE-006) */
  readonly chainValid: () => boolean;
  /** وضع الدولة عند الحكم — نافذةٌ حُكم عليها ودولتها موقوفة لم تمرّ */
  readonly stateHalted: () => boolean;
}

export class StagingLedger {
  private readonly breaches: string[] = [];
  private verdict_: StagingVerdict | null = null;

  constructor(private readonly deps: StagingLedgerDeps) {}

  /** إعلان النافذة قبل الحكم — كي يُقاس ما أُعلن لا ما رُوي بعده (RULE-006) */
  declareWindow(claim: WindowClaim): string {
    const entry = this.deps.audit.append(claim.operator, 'staging_window_declared', {
      operator: claim.operator, observer: claim.observer,
      startedAt: claim.startedAt, endedAt: claim.endedAt,
      runbooksClaimed: [...claim.runbooksClaimed],
      requiredMs: this.deps.policy.window.duration_ms,
      minTicks: this.deps.policy.window.min_ticks,
    });
    return entry.hash;
  }

  /**
   * الحكم. لا يرمي عند أول خرق (ثابت 6)، ويُسقط الحكم كلّه بواحد (ثابت 7).
   */
  judge(claim: WindowClaim, monitor: MonitorReport | null, runbooks: RunbookEvidence): StagingVerdict {
    const policy = this.deps.policy;
    const breach = (code: string, detail: Record<string, unknown>): void => {
      this.breaches.push(code);
      this.deps.audit.append(policy.observer_authority, 'staging_breach', { code, ...detail });
    };

    // (1) المراقب مستقل عن المشغّل — الشرط الأول لأن كل قياس بعده يستند إليه
    if (claim.observer === claim.operator) {
      breach(STAGE_OBSERVER_IS_OPERATOR, { operator: claim.operator });
    }
    if (STAGING_OPERATORS.includes(claim.observer) || claim.observer !== policy.observer_authority) {
      breach(STAGE_OBSERVER_UNDECLARED, { observer: claim.observer, declared: policy.observer_authority });
    }

    // (2) النافذة كاملة (ثابت 2)
    const durationMs = claim.endedAt - claim.startedAt;
    if (durationMs < policy.window.duration_ms) {
      breach(STAGE_WINDOW_INCOMPLETE, { durationMs, requiredMs: policy.window.duration_ms });
    }

    // (3) تقرير المراقب شرط: نافذةٌ بلا مراقب لا تُحكم بسلامة
    if (monitor === null) {
      breach(STAGE_NO_MONITOR_REPORT, { note: 'لا تقرير مراقب — الدعوى وحدها لا تُحكم' });
    } else {
      // (4) نافذة بلا مسح ليست مراقبة (ثابت 3)
      if (monitor.ticks < policy.window.min_ticks) {
        breach(STAGE_TICKS_UNDER_MIN, { ticks: monitor.ticks, minTicks: policy.window.min_ticks });
      }
      // (5) حرس معلن لم يمسح قطّ (ثوابت 4 و5)
      for (const watch of policy.watches) {
        const count = monitor.watchTicks[watch] ?? 0;
        if (count <= policy.tolerance.max_unwatched) {
          breach(STAGE_WATCH_NOT_OBSERVED, { watch, ticks: count });
        }
      }
      // (6) مسحة انهارت
      if (monitor.failedTicks > policy.tolerance.max_failed_ticks) {
        breach(STAGE_WATCH_FAILED, {
          failedTicks: monitor.failedTicks, tolerated: policy.tolerance.max_failed_ticks,
        });
      }
      // (7) الحادث الحرج — شرط القبول المعلن حرفيًّا
      if (monitor.critical > policy.tolerance.max_critical) {
        breach(STAGE_CRITICAL_INCIDENT, {
          critical: monitor.critical, tolerated: policy.tolerance.max_critical,
          kinds: monitor.incidents.filter((i) => i.severity === 'critical').map((i) => i.kind),
        });
      }
    }

    // (8) الكتب المعلنة نُفّذت فعلًا — من المنفّذ لا من الدعوى (ثوابت 1 و5)
    if (policy.require_runbook_execution) {
      for (const book of policy.runbooks) {
        if (runbooks.failed.includes(book)) {
          breach(STAGE_RUNBOOK_FAILED, { runbook: book });
          continue;
        }
        if (!runbooks.passed.includes(book)) {
          breach(STAGE_RUNBOOK_NOT_EXECUTED, {
            runbook: book, claimed: claim.runbooksClaimed.includes(book),
          });
        }
      }
    }

    // (9) النطاق فُتح فعلًا — تشغيلٌ «مقيَّد» بلا قيد مفتوح ليس مقيَّدًا
    if (!claim.scopeWasOpened) {
      breach(STAGE_SCOPE_NOT_OPENED, { note: 'نافذة بلا نطاق مفتوح ليست تشغيلًا مقيَّدًا' });
    }

    // (10) سلامة السلسلة ووضع الدولة — مصدران مستقلان عن الدعوى
    if (!this.deps.chainValid()) {
      breach(STAGE_AUDIT_CHAIN_BROKEN, { note: 'سلسلة التدقيق مكسورة — كل شهادة تُبنى عليها باطلة' });
    }
    if (this.deps.stateHalted()) {
      breach(STAGE_STATE_HALTED, { note: 'الدولة موقوفة عند الحكم — النافذة لم تمرّ بسلام' });
    }

    const passed = this.breaches.length === 0;
    const escalated = !passed && policy.escalate_on_breach;
    const entry = this.deps.audit.append(policy.observer_authority, 'staging_verdict', {
      passed, durationMs, requiredMs: policy.window.duration_ms,
      ticks: monitor?.ticks ?? 0, critical: monitor?.critical ?? 0, high: monitor?.high ?? 0,
      breaches: [...this.breaches], escalated,
      runbooks: [...runbooks.passed],
    });
    const verdict: StagingVerdict = {
      passed,
      durationMs,
      requiredMs: policy.window.duration_ms,
      ticks: monitor?.ticks ?? 0,
      criticalIncidents: monitor?.critical ?? 0,
      highIncidents: monitor?.high ?? 0,
      runbooksExecuted: [...runbooks.passed],
      breaches: [...this.breaches],
      escalated,
      auditId: entry.hash,
    };
    this.verdict_ = verdict;
    return verdict;
  }

  verdict(): StagingVerdict | null { return this.verdict_; }
}
