/**
 * src/staging/incident_monitor.ts — مراقب الحوادث بمؤقّت حقيقي بلا يد بشرية (المرحلة 36)
 * المالك: ديوان التدقيق يراقب ويرفع — و**حرس التاج يوقف** عند الحرج (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: حرّاس معلنون في `config/staging.yaml`، كل واحد ماسحٌ حقيقي في وحدة قائمة
 * المخرجات: حوادث مصنَّفة بشدّتها ومقيَّدة في السجل، وتوقف آمن عند الحادث الحرج
 * التبعيات: السجل غير القابل للمحو، الإيقاف الفوري، سياسة `loadStaging()`
 * الصلاحيات: المسح والرفع والتصعيد؛ **ولا يُصلح ما يجده** — تمرينٌ يُصلح يقيس إصلاحه
 * السجلات: incident_monitor_started / incident_monitor_stopped / staging_tick /
 *           staging_incident / staging_watch_failed / staging_critical_halt
 * ثوابت هذه الوحدة:
 *   1) **المسح بمؤقّت لا بيد**: هذا هو سبب وجود الوحدة. القياس قبلها أثبت أن حادثين
 *      جسيمين بقيا قائمين خمسة أضعاف مهلتهما والسجل خالٍ، لأن كل ماسحات الدولة
 *      تنتظر نداءً. مؤقّتٌ حقيقي (`setInterval`) لا زمنٌ مُمرَّر في وسيط
 *   2) **الحرس المعلن الذي لم يمسح خرقٌ**: يُحصى لكل حرس عدد مسحاته، والصفر يُخرج
 *      خرقًا في الدفتر — فلا يُعلن حرسٌ زينةً كما كان يُعلن مِلفّ تهيئة لا يقرأه أحد
 *   3) **انهيار الماسح ليس سلامة**: الماسح الذي يرمي يُسجَّل `staging_watch_failed`
 *      ويُحصى في `failedTicks` — وصمته أخطر من فشله لأنه يمرّ
 *   4) **الشدّة من التهيئة لا من الكود**: تصنيف الحادث يُقرأ من `severity` المعلنة،
 *      فلا تُخفَّف شدّة حادث بتعديل شرط في وحدة
 *   5) **الحرج يوقف**: عند `halt_on_critical` يُوقع الحرس الإيقاف فورًا ولا يُواصَل
 *      تشغيلٌ على حادث حرج (RULE-007)
 *   6) **المراقب لا يُنهي ولا يمنح ولا يعتمد**: يقرأ ويرفع، ويكتب في السجل وحده
 * حالات الفشل (كلها مغلقة): حرس مجهول ⇒ رفض عند البناء؛ ماسح يرمي ⇒ خرق مقيَّد لا
 *   تجاوز صامت؛ بدء مرتين ⇒ لا أثر (idempotent)؛ حادث حرج ⇒ إيقاف وتصعيد
 * اختبار القبول: tests/staging/incident_monitor.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0020-limited-operation.md
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { IncidentKind, StagingConfig, WatchKind, STAGING_KNOWN_WATCHES } from '../kernel/config';

/** حرس التاج: من يوقع الإيقاف عند الحادث الحرج (RULE-004) */
export const STAGING_GUARD: EntityId = 'authority:crown_guard';

export type Severity = 'critical' | 'high' | 'low';

export interface Incident {
  readonly kind: IncidentKind;
  readonly watch: WatchKind;
  readonly severity: Severity;
  readonly detail: string;
  readonly at: number;
  readonly auditId: string;
}

/** ما يُرجعه الماسح: حوادث مقيسة لا حكمًا. الماسح لا يُصنّف شدّتها بنفسه (ثابت 4). */
export interface WatchFinding {
  readonly kind: IncidentKind;
  readonly detail: string;
}

/** ماسحٌ حقيقي في وحدة قائمة. يُبنى خارج المراقب كي لا يعرف المراقب تفصيل الوحدات. */
export type WatchProbe = (now: number) => readonly WatchFinding[];

export interface IncidentMonitorDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch: KillSwitch;
  readonly policy: StagingConfig['policy'];
  readonly observer: EntityId;
  readonly probes: ReadonlyMap<WatchKind, WatchProbe>;
}

export interface MonitorReport {
  readonly ticks: number;
  readonly failedTicks: number;
  readonly incidents: readonly Incident[];
  readonly critical: number;
  readonly high: number;
  /** عدد مسحات كل حرس معلن — الصفر خرقٌ يقرأه الدفتر (ثابت 2) */
  readonly watchTicks: Readonly<Record<string, number>>;
  readonly halted: boolean;
}

export class IncidentMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  private failedTicks = 0;
  private halted = false;
  private readonly incidents: Incident[] = [];
  private readonly watchTicks = new Map<WatchKind, number>();

  constructor(private readonly deps: IncidentMonitorDeps) {
    for (const watch of deps.policy.watches) {
      if (!STAGING_KNOWN_WATCHES.includes(watch)) {
        throw new SovereignViolation(`حرس غير معروف: ${watch}`, 'MONITOR_WATCH_UNKNOWN');
      }
      if (!deps.probes.has(watch)) {
        throw new SovereignViolation(
          `حرس معلن بلا ماسح: ${watch} — حرسٌ لا يمسح زينةٌ لا مراقبة`,
          'MONITOR_WATCH_UNPROBED',
        );
      }
      this.watchTicks.set(watch, 0);
    }
    if (deps.observer !== deps.policy.observer_authority) {
      throw new SovereignViolation(
        'المراقب ليس جهة المراقبة المعلنة في التهيئة (RULE-004)',
        'MONITOR_OBSERVER_UNDECLARED',
      );
    }
  }

  /** يبدأ المؤقّت الحقيقي — unref حتى لا يمنع خروج العملية (ثابت 1) */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.deps.policy.window.tick_ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.deps.audit.append(this.deps.observer, 'incident_monitor_started', {
      tickMs: this.deps.policy.window.tick_ms,
      watches: [...this.deps.policy.watches],
    });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.deps.audit.append(this.deps.observer, 'incident_monitor_stopped', {
      ticks: this.ticks, incidents: this.incidents.length, failedTicks: this.failedTicks,
    });
  }

  get running(): boolean { return this.timer !== null; }

  /**
   * مسحة واحدة. تُنادى من المؤقّت وحده في التشغيل؛ وتُنادى مباشرة في الاختبار
   * كي يُقاس سلوك المسحة بمعزل عن الزمن — والقبول يُقاس بالمؤقّت لا بها.
   */
  tick(now = Date.now()): void {
    this.ticks += 1;
    const found: Incident[] = [];
    for (const watch of this.deps.policy.watches) {
      const probe = this.deps.probes.get(watch);
      if (!probe) continue;
      let findings: readonly WatchFinding[];
      try {
        findings = probe(now);
      } catch (error) {
        // ثابت 3: انهيار الماسح خرقٌ مقيَّد لا تجاوز صامت
        this.failedTicks += 1;
        this.deps.audit.append(this.deps.observer, 'staging_watch_failed', {
          watch, reason: error instanceof Error ? error.message : String(error), at: now,
        });
        continue;
      }
      this.watchTicks.set(watch, (this.watchTicks.get(watch) ?? 0) + 1);
      for (const finding of findings) {
        found.push(this.raise(watch, finding, now));
      }
    }
    this.deps.audit.append(this.deps.observer, 'staging_tick', {
      at: now, tick: this.ticks, found: found.length,
      critical: found.filter((i) => i.severity === 'critical').length,
    });
    // ثابت 5: الحرج يوقف — بعد التقييد لا قبله، كي لا يُوقف حادثٌ غير مسجَّل
    if (found.some((i) => i.severity === 'critical')) this.haltOnCritical(found, now);
  }

  /** ثابت 4: الشدّة من التهيئة */
  private severityOf(kind: IncidentKind): Severity {
    if (this.deps.policy.severity.critical.includes(kind)) return 'critical';
    if ((this.deps.policy.severity.high ?? []).includes(kind)) return 'high';
    return 'low';
  }

  private raise(watch: WatchKind, finding: WatchFinding, now: number): Incident {
    const severity = this.severityOf(finding.kind);
    const entry = this.deps.audit.append(this.deps.observer, 'staging_incident', {
      kind: finding.kind, watch, severity, detail: finding.detail, at: now,
    });
    const incident: Incident = {
      kind: finding.kind, watch, severity, detail: finding.detail, at: now, auditId: entry.hash,
    };
    this.incidents.push(incident);
    return incident;
  }

  private haltOnCritical(found: readonly Incident[], now: number): void {
    if (!this.deps.policy.halt_on_critical || this.halted) return;
    const critical = found.filter((i) => i.severity === 'critical');
    this.halted = true;
    this.deps.audit.append(STAGING_GUARD, 'staging_critical_halt', {
      at: now, kinds: critical.map((i) => i.kind), count: critical.length,
    });
    this.deps.killSwitch.engage(
      STAGING_GUARD, 'all',
      `حادث حرج في التشغيل المحدود: ${critical.map((i) => i.kind).join(', ')}`,
    );
  }

  incidentsOf(severity: Severity): readonly Incident[] {
    return this.incidents.filter((i) => i.severity === severity);
  }

  report(): MonitorReport {
    const watchTicks: Record<string, number> = {};
    for (const [watch, count] of this.watchTicks) watchTicks[watch] = count;
    return {
      ticks: this.ticks,
      failedTicks: this.failedTicks,
      incidents: [...this.incidents],
      critical: this.incidents.filter((i) => i.severity === 'critical').length,
      high: this.incidents.filter((i) => i.severity === 'high').length,
      watchTicks,
      halted: this.halted,
    };
  }
}
