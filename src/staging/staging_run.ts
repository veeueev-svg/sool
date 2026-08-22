/**
 * src/staging/staging_run.ts — تشغيلة محدودة واحدة من الإعلان إلى الحكم (المرحلة 36)
 * المالك: الديوان الملكي يُشغّل — وديوان التدقيق يراقب ويحكم (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مشغّل معلن، بيان `deploy/staging/manifest.yaml`، كتب تشغيل قابلة للتنفيذ
 * المخرجات: حكمٌ واحد على النافذة، وسلسلة سجلّ تُقرأ من خارج الوحدة
 * التبعيات: OperationScope, RunbookRunner, IncidentMonitor, StagingLedger, KillSwitch
 * الصلاحيات: الترتيب وحده؛ **ولا يحكم على نافذته** — الحكم للدفتر بتقرير المراقب
 * السجلات: staging_run_refused / staging_run_started / staging_run_finished
 * ثوابت هذه الوحدة:
 *   1) **الرفض قبل أي أثر**: كل شروط الأهلية تُقاس قبل فتح نطاق أو تشغيل مؤقّت، فلا
 *      تُترك دولةٌ في نصف نافذة لأن الشرط اكتُشف متأخرًا
 *   2) **الترتيب مُلزِم**: إعلان ⇒ نطاق مفتوح ⇒ كتب مُنفَّذة ⇒ نافذة مراقَبة ⇒ إغلاق ⇒ حكم.
 *      الكتب قبل النافذة كي تُقاس آثارها داخل المراقبة لا بعدها
 *   3) **النافذة زمنٌ حقيقي**: تنتظر `duration_ms` فعليًّا ولا تُختصر — ولو اختصرت لكان
 *      شرط «مدة مراقبة كاملة» دعوى لا قياسًا (وهذا ثقب هذه المرحلة المُقاس)
 *   4) **المؤقّت يُوقَف في كل مسار**: نجحت أو انهارت، لا يُترك مؤقّت يعمل بعد النافذة
 *   5) **المشغّل لا يشهد**: المراقب من التهيئة لا من وسيط يُمرّره المشغّل
 *   6) **النافذة تُحكم ولو فشلت**: الفشل يُنتج حكمًا مقيَّدًا لا استثناءً يُبتلع
 * حالات الفشل (كلها مغلقة): مشغّل غير معلن ⇒ رفض؛ المشغّل هو المراقب ⇒ رفض؛ الدولة
 *   موقوفة ⇒ رفض؛ الوضع غير طبيعي ⇒ رفض؛ العدد فوق `max_agents` ⇒ رفض؛ كتاب معلن
 *   غير مُمرَّر ⇒ رفض؛ تشغيلة ثانية على نفس الكائن ⇒ رفض
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/runbooks/limited-operation.md
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { StagingConfig, STAGING_OPERATORS } from '../kernel/config';
import { OperationScope } from './operation_scope';
import { IncidentMonitor } from './incident_monitor';
import { RunbookRunner, Runbook } from './runbook_runner';
import { StagingLedger, StagingVerdict } from './staging_ledger';

export interface StagingRunDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: StagingConfig['policy'];
  readonly scope: OperationScope;
  readonly monitor: IncidentMonitor;
  readonly runner: RunbookRunner;
  readonly ledger: StagingLedger;
  readonly mode: () => string;
  readonly halted: () => boolean;
  readonly livingAgents: () => number;
}

export class StagingRun {
  private used = false;

  constructor(private readonly deps: StagingRunDeps) {}

  /** ثابت 1: تُقاس الأهلية كلها قبل أي أثر */
  private refuse(by: EntityId, code: string, reason: string): never {
    this.deps.audit.append(by, 'staging_run_refused', { code, reason });
    throw new SovereignViolation(reason, code);
  }

  private preflight(operator: EntityId, books: readonly Runbook[]): void {
    if (this.used) {
      this.refuse(operator, 'STAGERUN_ALREADY_USED', 'تشغيلة مستهلكة — لا نافذتان على كائن واحد');
    }
    if (!STAGING_OPERATORS.includes(operator)) {
      this.refuse(operator, 'STAGERUN_OPERATOR_UNDECLARED', 'التشغيل المحدود لجهة مشغّلة معلنة وحدها (RULE-004)');
    }
    if (operator === this.deps.policy.observer_authority) {
      this.refuse(operator, 'STAGERUN_OPERATOR_IS_OBSERVER', 'المشغّل لا يكون مراقبًا على نافذته (ثابت 5)');
    }
    if (this.deps.halted()) {
      this.refuse(operator, 'STAGERUN_STATE_HALTED', 'الدولة موقوفة — لا تُفتح نافذة تشغيل على إيقاف قائم');
    }
    const mode = this.deps.mode();
    if (mode !== 'normal') {
      this.refuse(operator, 'STAGERUN_MODE_ABNORMAL', `وضع الدولة غير طبيعي: ${mode} — لا تشغيل محدود عليه`);
    }
    const living = this.deps.livingAgents();
    if (living > this.deps.policy.scope.max_agents) {
      this.refuse(operator, 'STAGERUN_OVER_MAX_AGENTS',
        `عدد الوكلاء ${living} فوق سقف التشغيل المحدود ${this.deps.policy.scope.max_agents}`);
    }
    for (const declared of this.deps.policy.runbooks) {
      if (!books.some((b) => b.name === declared)) {
        this.refuse(operator, 'STAGERUN_RUNBOOK_MISSING',
          `كتاب معلن في التهيئة ولم يُمرَّر للتنفيذ: ${declared} — إعلانٌ بلا تنفيذ`);
      }
    }
  }

  /**
   * النافذة كاملة بزمن حقيقي (ثابت 3). تُرجع حكم الدفتر لا حكمها.
   */
  async run(operator: EntityId, books: readonly Runbook[], reason: string): Promise<StagingVerdict> {
    this.preflight(operator, books);
    this.used = true;
    const policy = this.deps.policy;
    const observer = policy.observer_authority;
    const startedAt = Date.now();
    this.deps.audit.append(operator, 'staging_run_started', {
      at: startedAt, reason, durationMs: policy.window.duration_ms,
      tickMs: policy.window.tick_ms, observer, books: books.map((b) => b.name),
    });

    const opened = this.deps.scope.open(operator, reason, startedAt);
    const runbookFailures: string[] = [];
    try {
      // ثابت 2: الكتب تُنفَّذ قبل النافذة كي تُراقَب آثارها
      for (const book of books) {
        const result = this.deps.runner.execute(operator, book, Date.now());
        if (!result.passed) runbookFailures.push(book.name);
      }
      this.deps.monitor.start();
      // مؤقّت النافذة **لا يُنزَع مرجعه**: انتظارٌ بلا مرجع يُخرج العملية قبل تمام المدة،
      // فتصير «المدة الكاملة» دعوى. المرجع هو ما يجعل الزمن مقيسًا (ثابت 1).
      await new Promise<void>((resolve) => { setTimeout(resolve, policy.window.duration_ms); });
    } finally {
      // ثابت 4: لا يُترك مؤقّت يعمل
      this.deps.monitor.stop();
      if (this.deps.scope.active) this.deps.scope.close(operator, 'انتهت نافذة التشغيل المحدود', Date.now());
    }

    const endedAt = Date.now();
    const claim = {
      operator, observer, startedAt, endedAt,
      runbooksClaimed: books.map((b) => b.name),
      scopeWasOpened: opened.ok,
    };
    this.deps.ledger.declareWindow(claim);
    const verdict = this.deps.ledger.judge(claim, this.deps.monitor.report(), {
      passed: this.deps.runner.passed(),
      failed: runbookFailures,
    });
    this.deps.audit.append(operator, 'staging_run_finished', {
      at: endedAt, passed: verdict.passed, breaches: [...verdict.breaches],
      durationMs: verdict.durationMs, ticks: verdict.ticks,
    });
    return verdict;
  }
}
