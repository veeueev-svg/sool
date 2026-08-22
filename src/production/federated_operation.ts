/**
 * src/production/federated_operation.ts — التشغيل الاتحادي: الفتح والقياس والحكم (المرحلة 37)
 * المالك: الديوان الملكي يُشغّل، وديوان التدقيق يحكم — والوحدة لا تجمع الدورين (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: سياسة config/production.yaml وبيان deploy/production/manifest.yaml ووحدات
 *           الدولة القائمة (الأقاليم، الحكّام، بوابة التاج، المراقبة المستمرة)
 * المخرجات: تشغيلٌ مُعلن، ثم شهادةٌ من دفتر التشغيل الاتحادي مبنيّة على قياس
 * التبعيات: RegionalPassage, ContinuousSupervisor, RunbookRunner, ProductionLedger,
 *           RegionRegistry, GovernorRegistry, RegionMonitor
 * الصلاحيات: الفتح لجهة مشغّلة معلنة وحدها؛ والحكم بسلطة المراقب المعلن في السياسة
 * السجلات: federated_operation_started / _refused / _judged
 * ثوابت هذه الوحدة:
 *   1) **الوحدة تقيس ولا تُنشئ**: لا تُقيم إقليمًا ولا تُجلس حاكمًا ولا تُصلح نقصًا.
 *      إقليمٌ ناقص يظهر خرقًا في الشهادة — لا يُسدّ صامتًا (RULE-001)
 *   2) **الفتح إعلانٌ قبل الفعل**: يُقيَّد الإعلان في الدفتر أولًا، فلا تُروى تشغيلة
 *      بعد انقضائها بما يوافق نتيجتها (RULE-006)
 *   3) **الدليل من الوحدات لا من الدعوى**: أفعال الأقاليم تُعدّ من سجل التدقيق،
 *      والكتب المنفَّذة تُقرأ من المنفّذ، والمسحات من تقرير المراقبة
 *   4) **جهة الفتح جهة مشغّلة معلنة وليست المراقب**: وإلا رُفض الفتح ولم يُقيَّد نجاح
 *   5) **الحكم مرة واحدة**: التشغيل يُحكم عليه حكمًا واحدًا؛ وإعادة الحكم لا تُبدّل
 *      الشهادة الأولى — دفتر التشغيل هو من يمنع، لا هذه الوحدة
 * حالات الفشل (كلها مغلقة): فاتحٌ غير مشغّل ⇒ رفض؛ فاتحٌ هو المراقب ⇒ رفض؛ فتحٌ مرتين
 *   ⇒ رفض؛ كتاب لم يُنفَّذ ⇒ خرق في الشهادة؛ حكمٌ قبل الفتح ⇒ رفض
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ProductionConfig, PRODUCTION_OPERATORS } from '../kernel/config';
import { RegionRegistry } from '../federation/region_registry';
import { GovernorRegistry } from '../federation/governor';
import { RegionMonitor } from '../federation/region_monitor';
import { Runbook, RunbookRunner, RunbookResult } from '../staging/runbook_runner';
import { RegionalPassage } from './regional_passage';
import { ContinuousSupervisor } from './continuous_supervisor';
import {
  ProductionLedger, ProductionVerdict, OperationClaim, RegionEvidence, PassageEvidence,
} from './production_ledger';
import { FEDERATED_ACTION } from './production_runbook_steps';

export interface FederatedOperationDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: ProductionConfig['policy'];
  readonly passage: RegionalPassage;
  readonly supervisor: ContinuousSupervisor;
  readonly runner: RunbookRunner;
  readonly ledger: ProductionLedger;
  readonly regions: RegionRegistry;
  readonly governors: GovernorRegistry;
  readonly regionMonitor: RegionMonitor;
  /** زمن إقلاع الدولة — يُقاس به تأخّر أول مسحة عن المهلة المعلنة */
  readonly bootAt: number;
}

export interface OperationStartResult {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly runbooks: readonly RunbookResult[];
  readonly auditId: string;
}

export interface OperationReport {
  readonly started: boolean;
  readonly operator: EntityId | null;
  readonly startedAt: number | null;
  readonly runbooksExecuted: readonly string[];
  readonly runbooksFailed: readonly string[];
  readonly regions: readonly RegionEvidence[];
  readonly passage: PassageEvidence;
  readonly verdict: ProductionVerdict | null;
}

export class FederatedOperation {
  private operator: EntityId | null = null;
  private startedAt: number | null = null;
  private results: RunbookResult[] = [];
  private verdict_: ProductionVerdict | null = null;

  constructor(private readonly deps: FederatedOperationDeps) {}

  get started(): boolean { return this.startedAt !== null; }

  /**
   * فتح التشغيل الاتحادي: إعلانٌ ثم فتح مرور التاج ثم بدء المراقبة ثم تنفيذ الكتب.
   * ثابت 1: لا تُنشئ الوحدة إقليمًا ولا حاكمًا — النقص يظهر في الشهادة لا يُسدّ هنا.
   */
  begin(
    operator: EntityId, books: readonly Runbook[], reason: string, now = Date.now(),
  ): OperationStartResult {
    const refuse = (why: string): OperationStartResult => {
      const entry = this.deps.audit.append(operator, 'federated_operation_refused', {
        reason: why, at: now,
      });
      return { ok: false, reason: why, runbooks: [], auditId: entry.hash };
    };
    // ثابت 4
    if (!PRODUCTION_OPERATORS.includes(operator)) {
      return refuse('فتح التشغيل الاتحادي لجهة مشغّلة معلنة وحدها (RULE-004)');
    }
    if (operator === this.deps.policy.observer_authority) {
      return refuse('من يُشغّل لا يراقب — والمراقب لا يفتح (RULE-004)');
    }
    if (reason.trim().length < 3) {
      return refuse('لا تشغيل بلا سبب معلن (RULE-006)');
    }
    if (this.startedAt !== null) {
      return refuse('التشغيل الاتحادي مفتوح سابقًا — لا فتح مرتين');
    }

    // ثابت 2: الإعلان قبل الفعل
    this.deps.ledger.declareOperation({
      operator,
      observer: this.deps.policy.observer_authority,
      startedAt: now,
      runbooksClaimed: books.map((b) => b.name),
    });

    const opened = this.deps.passage.open(operator, reason.trim(), now);
    if (!opened.ok) {
      return refuse(`مرور التاج لم يُفتح: ${opened.reason}`);
    }
    this.deps.supervisor.start(now);

    this.operator = operator;
    this.startedAt = now;
    const entry = this.deps.audit.append(operator, 'federated_operation_started', {
      at: now, reason: reason.trim(), runbooks: books.map((b) => b.name),
      requiredRegions: [...this.deps.policy.regions.required],
    });

    this.results = books.map((book) => this.deps.runner.execute(operator, book, now));
    return {
      ok: this.results.every((r) => r.passed),
      reason: null,
      runbooks: this.results,
      auditId: entry.hash,
    };
  }

  /** دليل الأقاليم — يُعدّ من سجل التدقيق وسجلّي الأقاليم والحكّام (ثابت 3) */
  regionEvidence(): readonly RegionEvidence[] {
    const executed = this.deps.audit.find('region_action_executed');
    const passed = this.deps.audit.find('region_action_passed');
    const contained = new Set(
      this.deps.regionMonitor.history().filter((f) => f.containedAt !== null).map((f) => f.regionId),
    );
    const countFor = (
      entries: ReturnType<AppendOnlyLog['find']>, regionId: EntityId,
    ): number => entries.filter((e) => {
      const detail = e.detail as { regionId?: string; action?: string };
      return detail.regionId === regionId && detail.action === FEDERATED_ACTION;
    }).length;

    return this.deps.policy.regions.required.map((regionId) => ({
      regionId,
      active: this.deps.regions.isActive(regionId),
      suspended: contained.has(regionId),
      governor: this.deps.governors.governorOf(regionId)?.governor ?? null,
      actionsExecuted: countFor(executed, regionId),
      actionsPassed: countFor(passed, regionId),
    }));
  }

  /** دليل مرور التاج — يُقرأ من البوابة الإقليمية ومن السجل (ثابت 3) */
  passageEvidence(): PassageEvidence {
    const report = this.deps.passage.report();
    const withoutPassage = this.deps.audit.find('region_action_without_passage').length;
    return {
      enforced: this.deps.policy.regions.require_crown_passage,
      granted: report.granted,
      passed: report.passed,
      blockedAttempts: report.blocked,
      executedWithoutPassage: withoutPassage,
    };
  }

  /** الحكم: يُبنى من القياس ثم يُسلَّم للدفتر — والوحدة لا تُصدره بنفسها (ثابت 3) */
  judge(now = Date.now()): ProductionVerdict {
    const claim: OperationClaim = {
      operator: this.operator ?? this.deps.policy.observer_authority,
      observer: this.deps.policy.observer_authority,
      startedAt: this.startedAt ?? now,
      runbooksClaimed: this.results.map((r) => r.name),
    };
    const supervision = this.startedAt === null ? null : this.deps.supervisor.report();
    const verdict = this.deps.ledger.judge(
      claim,
      supervision,
      this.regionEvidence(),
      this.passageEvidence(),
      {
        passed: this.deps.runner.passed(),
        failed: this.results.filter((r) => !r.passed).map((r) => r.name),
      },
    );
    this.verdict_ = verdict;
    this.deps.audit.append(this.deps.policy.observer_authority, 'federated_operation_judged', {
      at: now, passed: verdict.passed, breaches: [...verdict.breaches],
      regionsOperating: verdict.regionsOperating, sweeps: verdict.sweeps,
    });
    return verdict;
  }

  report(): OperationReport {
    return {
      started: this.started,
      operator: this.operator,
      startedAt: this.startedAt,
      runbooksExecuted: this.deps.runner.passed(),
      runbooksFailed: this.results.filter((r) => !r.passed).map((r) => r.name),
      regions: this.regionEvidence(),
      passage: this.passageEvidence(),
      verdict: this.verdict_,
    };
  }
}
