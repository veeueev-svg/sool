/**
 * src/production/continuous_supervisor.ts — مراقبة مستمرة بلا مدة ولا نهاية (المرحلة 37)
 * المالك: ديوان التدقيق يمسح ويرفع، و**حرس التاج يوقف** عند الحرج (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: ماسحات معلنة في `config/production.yaml`، ونقطة تفتيش على القرص
 * المخرجات: مسحات دورية مقيَّدة، حوادث مصنَّفة، فجوات صمت معلنة، توقف آمن عند الحرج
 * التبعيات: AppendOnlyLog, KillSwitch, ProductionConfig, CheckpointStore
 * الصلاحيات: المسح والرفع والتصعيد والكتابة في نقطة التفتيش؛ **ولا يُصلح ما يجده**
 * السجلات: continuous_supervision_started / production_sweep / production_incident /
 *           production_scanner_failed / supervision_gap / production_critical_halt /
 *           production_checkpoint_written / supervision_stopped / supervision_stop_refused /
 *           supervision_host_stall
 * ثوابت هذه الوحدة:
 *   1) **لا مدة ولا نهاية**: المرحلة 36 راقبت «نافذة» لها `duration_ms` تنتهي. هنا لا
 *      يوجد طول: المراقبة تبدأ ولا تُغلق نفسها، ووقفها قرارٌ مُعلَن من مشغّل بسبب
 *   2) **التأخّر عن الإقلاع خرقٌ يُقاس**: تُقاس الفجوة بين إقلاع الدولة وأول مسحة على
 *      `start_grace_ms` — مراقبةٌ بدأت متأخرة تركت زمنًا غير مراقَب، ولا يُقال «مستمرة»
 *   3) **الصمت لا يُحسب سلامة**: أي فجوة بين مسحتين تجاوز `max_silence_ms` تُقيَّد
 *      `supervision_gap` وتُحصى — المراقبة التي تتوقف ثم تعود ليست مستمرة
 *   4) **إعادة التشغيل لا تمسح الزمن**: تُقرأ نقطة التفتيش عند البدء، وتُعلن فجوة
 *      العبور صراحةً؛ وملفٌ عُدّل من الخارج يُرفض ولا يُقرأ كإقلاعٍ أول
 *   5) **الشدّة من التهيئة لا من الكود** (RULE-005)، و**الحرج يوقف** (RULE-007)
 *   6) **انهيار الماسح ليس سلامة**: يُقيَّد `production_scanner_failed` ويُحصى خرقًا
 *   7) **الوقف مقيَّد بالسبب والجهة**: وقفٌ من غير مشغّل معلن أو بلا سبب يُرفض ويُقيَّد
 *   8) **حجبُ المُشغّل يُسمّى ولا يُنسب إلى المراقبة** (T-155): المراقبة تلتزم ألّا تتوقف،
 *      وأن تُنادى في موعدها التزامُ مُشغّل النظام. فيُقاس الثاني بمِجَسٍّ مرجعيٍّ منفصل
 *      بنبضة `tick_ms` يسجّل تأخّرَه هو؛ وصمتٌ يفسّره تأخّرُ المِجَسِّ (silence − stall ≤
 *      2×tick_ms) يُقيَّد `supervision_host_stall` ويُحصى معلنًا ولا يُحسب فجوةَ مراقبة،
 *      وما زاد على ذلك فجوةٌ تُدان كما كانت. فلا حدَّ يُرخى، ولا سببٌ يُخلط بسبب.
 * ملاحظة على `unref`: المؤقّت غير مُثبَّت كي لا يمنع خروج العملية، وهذا لا يُخفي
 *   قياسًا — درس المرحلة 36 كان في `unref` على مؤقّت النافذة المنتظرة، أما هنا فالمسحات
 *   تجري فعلًا لأن الاختبار ينتظر نومًا حقيقيًّا يُبقي العملية حيّة.
 * حالات الفشل (كلها مغلقة): ماسح مجهول/بلا ماسح ⇒ رفض عند البناء؛ مراقب غير معلن ⇒
 *   رفض؛ بدءٌ مرتين ⇒ لا أثر؛ ماسح يرمي ⇒ خرق مقيَّد؛ حادث حرج ⇒ إيقاف وتصعيد
 * اختبار القبول: tests/production/continuous_supervisor.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import {
  IncidentKind, ProductionConfig, ScannerKind,
  PRODUCTION_KNOWN_SCANNERS, PRODUCTION_OPERATORS,
} from '../kernel/config';
import { Incident, Severity, WatchFinding, WatchProbe } from '../staging/incident_monitor';
import { CheckpointStore, SupervisionCheckpoint } from './supervision_checkpoint';

/** حرس التاج: من يوقع الإيقاف عند الحادث الحرج (RULE-004) */
export const PRODUCTION_GUARD: EntityId = 'authority:crown_guard';

export interface SupervisionGap {
  readonly kind: 'start' | 'silence' | 'restart';
  readonly ms: number;
  readonly at: number;
  readonly auditId: string;
}

/** ثابت 8: صمتٌ فسّره حجبُ المُشغّل — معلنٌ لا مطويٌّ، وليس فجوةَ مراقبة */
export interface HostStall {
  readonly silenceMs: number;
  readonly stallMs: number;
  readonly at: number;
  readonly auditId: string;
}

export interface SupervisionReport {
  readonly sweeps: number;
  readonly failedSweeps: number;
  readonly incidents: readonly Incident[];
  readonly critical: number;
  readonly high: number;
  /** عدد مسحات كل ماسح معلن — الصفر خرقٌ يقرأه الدفتر */
  readonly scannerSweeps: Readonly<Record<string, number>>;
  readonly halted: boolean;
  readonly running: boolean;
  readonly gaps: readonly SupervisionGap[];
  /** ثابت 8: حالاتُ حجبِ المُشغّلِ المرصودة — تُقرأ ولا تُسقط الحكم */
  readonly hostStalls: readonly HostStall[];
  readonly bootAt: number;
  readonly startedAt: number | null;
  readonly firstSweepAt: number | null;
  readonly lastSweepAt: number | null;
  /** فجوة العبور من آخر نقطة تفتيش إلى هذا الإقلاع — null عند الإقلاع الأول */
  readonly restartGapMs: number | null;
}

export interface ContinuousSupervisorDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch: KillSwitch;
  readonly policy: ProductionConfig['policy'];
  readonly observer: EntityId;
  readonly probes: ReadonlyMap<ScannerKind, WatchProbe>;
  /** لحظة إقلاع الدولة — تُقاس عليها مهلة البدء (ثابت 2) */
  readonly bootAt: number;
  readonly checkpoint: CheckpointStore;
}

export class ContinuousSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private lastProbeAt: number | null = null;
  private probeLateMs = 0;
  private sweeps = 0;
  private failedSweeps = 0;
  private halted = false;
  private startedAt: number | null = null;
  private firstSweepAt: number | null = null;
  private lastSweepAt: number | null = null;
  private restartGapMs: number | null = null;
  private priorCheckpoint: SupervisionCheckpoint | null = null;
  private readonly incidents: Incident[] = [];
  private readonly gaps: SupervisionGap[] = [];
  private readonly hostStalls: HostStall[] = [];
  private readonly scannerSweeps = new Map<ScannerKind, number>();

  constructor(private readonly deps: ContinuousSupervisorDeps) {
    for (const scanner of deps.policy.scanners) {
      if (!PRODUCTION_KNOWN_SCANNERS.includes(scanner)) {
        throw new SovereignViolation(`ماسح غير معروف: ${scanner}`, 'SUPERVISOR_SCANNER_UNKNOWN');
      }
      if (!deps.probes.has(scanner)) {
        throw new SovereignViolation(
          `ماسح معلن بلا ماسحة: ${scanner} — قدرةٌ لا يناديها أحد (T-105)`,
          'SUPERVISOR_SCANNER_UNPROBED',
        );
      }
      this.scannerSweeps.set(scanner, 0);
    }
    if (deps.observer !== deps.policy.observer_authority) {
      throw new SovereignViolation(
        'المراقب ليس جهة المراقبة المعلنة في التهيئة (RULE-004)',
        'SUPERVISOR_OBSERVER_UNDECLARED',
      );
    }
  }

  get running(): boolean { return this.timer !== null; }

  /**
   * يبدأ المراقبة الدائمة. لا وسيط مدة ولا نهاية (ثابت 1). يقرأ نقطة التفتيش أولًا
   * فتُعلن فجوة العبور (ثابت 4)، ثم يمسح مسحةً فورية كي لا يبدأ الاستمرار بصمت.
   */
  start(now = Date.now()): void {
    if (this.timer) return;
    this.startedAt = now;
    this.priorCheckpoint = this.deps.checkpoint.read();
    if (this.priorCheckpoint) {
      const gapMs = this.deps.bootAt - this.priorCheckpoint.at;
      this.restartGapMs = gapMs;
      const entry = this.deps.audit.append(this.deps.observer, 'supervision_gap', {
        kind: 'restart', ms: gapMs, at: now,
        lastCheckpointAt: this.priorCheckpoint.at, bootAt: this.deps.bootAt,
        limitMs: this.deps.policy.supervision.restart_gap_max_ms,
      });
      if (gapMs > this.deps.policy.supervision.restart_gap_max_ms) {
        this.gaps.push({ kind: 'restart', ms: gapMs, at: now, auditId: entry.hash });
      }
    }
    this.deps.audit.append(this.deps.observer, 'continuous_supervision_started', {
      at: now, tickMs: this.deps.policy.supervision.tick_ms,
      scanners: [...this.deps.policy.scanners],
      bootAt: this.deps.bootAt,
      resumedFrom: this.priorCheckpoint ? this.priorCheckpoint.at : null,
    });
    this.timer = setInterval(
      () => this.sweep(),
      this.deps.policy.supervision.tick_ms,
    );
    if (typeof this.timer.unref === 'function') this.timer.unref();
    // ثابت 8: مِجَسٌّ مرجعيٌّ يقيس قدرةَ المُشغّلِ على أن يُنادي في موعده
    this.lastProbeAt = now;
    this.probeLateMs = 0;
    this.probeTimer = setInterval(
      () => this.observeProbe(Date.now()),
      this.deps.policy.supervision.tick_ms,
    );
    if (typeof this.probeTimer.unref === 'function') this.probeTimer.unref();
    this.sweep(now);
  }

  /** ثابت 7: الوقف قرارٌ مُعلن من مشغّل بسبب — لا تُغلق المراقبة نفسها */
  stop(by: EntityId, reason: string, now = Date.now()): { ok: boolean; reason: string } {
    const refuse = (why: string): { ok: boolean; reason: string } => {
      this.deps.audit.append(by, 'supervision_stop_refused', { reason: why, at: now });
      return { ok: false, reason: why };
    };
    if (!PRODUCTION_OPERATORS.includes(by)) {
      return refuse('جهة غير مشغّلة لا توقف المراقبة المستمرة (RULE-004)');
    }
    if (reason.trim().length < 3) return refuse('لا وقف بلا سبب معلن (RULE-006)');
    if (!this.timer) return refuse('لا مراقبة جارية ليُوقفها أحد');
    clearInterval(this.timer);
    this.timer = null;
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
    this.lastProbeAt = null;
    this.deps.audit.append(by, 'supervision_stopped', {
      at: now, reason: reason.trim(), sweeps: this.sweeps,
      incidents: this.incidents.length, failedSweeps: this.failedSweeps,
    });
    return { ok: true, reason: 'المراقبة موقوفة بقرار معلن' };
  }

  /**
   * مسحة واحدة. تُنادى من المؤقّت وحده في التشغيل؛ ويُنادى مباشرة في الاختبار كي
   * يُقاس سلوك المسحة بمعزل عن الزمن — والقبول يُقاس بالمؤقّت لا بها.
   */
  sweep(now = Date.now()): void {
    this.measureSilence(now);
    this.sweeps += 1;
    if (this.firstSweepAt === null) {
      this.firstSweepAt = now;
      const lateMs = now - this.deps.bootAt;
      if (lateMs > this.deps.policy.supervision.start_grace_ms) {
        // ثابت 2: التأخّر عن الإقلاع خرقٌ يُقاس لا يُطوى
        const entry = this.deps.audit.append(this.deps.observer, 'supervision_gap', {
          kind: 'start', ms: lateMs, at: now, bootAt: this.deps.bootAt,
          limitMs: this.deps.policy.supervision.start_grace_ms,
        });
        this.gaps.push({ kind: 'start', ms: lateMs, at: now, auditId: entry.hash });
      }
    }
    const found: Incident[] = [];
    for (const scanner of this.deps.policy.scanners) {
      const probe = this.deps.probes.get(scanner);
      if (!probe) continue;
      let findings: readonly WatchFinding[];
      try {
        findings = probe(now);
      } catch (error) {
        // ثابت 6
        this.failedSweeps += 1;
        this.deps.audit.append(this.deps.observer, 'production_scanner_failed', {
          scanner, reason: error instanceof Error ? error.message : String(error), at: now,
        });
        continue;
      }
      this.scannerSweeps.set(scanner, (this.scannerSweeps.get(scanner) ?? 0) + 1);
      for (const finding of findings) found.push(this.raise(scanner, finding, now));
    }
    this.lastSweepAt = now;
    this.deps.audit.append(this.deps.observer, 'production_sweep', {
      at: now, sweep: this.sweeps, found: found.length,
      critical: found.filter((i) => i.severity === 'critical').length,
    });
    this.writeCheckpoint(now);
    if (found.some((i) => i.severity === 'critical')) this.haltOnCritical(found, now);
  }

  /**
   * ثابت 8: نبضةُ المِجَسِّ المرجعيّ. تُنادى من مؤقّتِ المِجَسِّ في التشغيل، وتُنادى
   * مباشرةً في الاختبار كي يُقاس التمييزُ بأزمنةٍ مُصطنعةٍ لا بحظِّ الجدولة.
   */
  observeProbe(now: number): void {
    if (this.lastProbeAt !== null) {
      const late = now - this.probeBase() - this.deps.policy.supervision.tick_ms;
      if (late > this.probeLateMs) this.probeLateMs = late;
    }
    this.lastProbeAt = now;
  }

  /**
   * أساسُ قياسِ تأخّرِ المِجَسِّ: متأخّرٌ داخلَ النافذةِ الجاريةِ وحدها — فلا يُعتذر
   * بحجبٍ ماضٍ عن صمتٍ تالٍ (ولا يُحسب تأخّرٌ مرّتين على حدّي مسحتين).
   */
  private probeBase(): number {
    const probeAt = this.lastProbeAt ?? 0;
    return this.lastSweepAt === null ? probeAt : Math.max(probeAt, this.lastSweepAt);
  }

  /** ثابت 3 + ثابت 8: الصمت يُقاس ويُعلن، وسببُه يُسمّى ولا يُخلط */
  private measureSilence(now: number): void {
    if (this.lastSweepAt === null) return;
    const silence = now - this.lastSweepAt;
    // التسامحُ نبضتان من `tick_ms` المعلن: نبضةٌ لفارقِ مرساتينِ المؤقّتين (المِجَسُّ
    // يسبق المسحةَ داخلَ النافذةِ بما لا يتجاوز نبضةً) ونبضةٌ لجدولةِ المسحةِ نفسِها.
    // وهي دونَ `max_silence_ms` (خمسُ نبضات) فلا يُعطّل الحرسُ باسمِ التسامح.
    const toleranceMs = 2 * this.deps.policy.supervision.tick_ms;
    // تأخّرٌ لم يُسجّله المِجَسُّ بعدُ لأنّه هو نفسُه محجوبٌ الآن — يُحسب ولا يُنتظر
    const pendingLate = this.lastProbeAt === null
      ? 0
      : now - this.probeBase() - this.deps.policy.supervision.tick_ms;
    const stallMs = Math.max(this.probeLateMs, pendingLate, 0);
    this.probeLateMs = 0;
    const limitMs = this.deps.policy.supervision.max_silence_ms;
    if (silence <= limitMs) return;
    if (silence - stallMs <= toleranceMs) {
      const stalled = this.deps.audit.append(this.deps.observer, 'supervision_host_stall', {
        silenceMs: silence, stallMs, at: now, limitMs, toleranceMs,
      });
      this.hostStalls.push({ silenceMs: silence, stallMs, at: now, auditId: stalled.hash });
      return;
    }
    const entry = this.deps.audit.append(this.deps.observer, 'supervision_gap', {
      kind: 'silence', ms: silence, at: now, limitMs, stallMs,
    });
    this.gaps.push({ kind: 'silence', ms: silence, at: now, auditId: entry.hash });
  }

  private writeCheckpoint(now: number): void {
    const checkpoint: SupervisionCheckpoint = {
      at: now, sweeps: this.sweeps, incidents: this.incidents.length, bootAt: this.deps.bootAt,
    };
    try {
      this.deps.checkpoint.write(checkpoint);
    } catch (error) {
      this.failedSweeps += 1;
      this.deps.audit.append(this.deps.observer, 'production_scanner_failed', {
        scanner: 'checkpoint', reason: error instanceof Error ? error.message : String(error), at: now,
      });
      return;
    }
    this.deps.audit.append(this.deps.observer, 'production_checkpoint_written', {
      at: now, sweeps: this.sweeps,
    });
  }

  /** ثابت 5: الشدّة من التهيئة */
  private severityOf(kind: IncidentKind): Severity {
    if (this.deps.policy.severity.critical.includes(kind)) return 'critical';
    if ((this.deps.policy.severity.high ?? []).includes(kind)) return 'high';
    return 'low';
  }

  private raise(scanner: ScannerKind, finding: WatchFinding, now: number): Incident {
    const severity = this.severityOf(finding.kind);
    const entry = this.deps.audit.append(this.deps.observer, 'production_incident', {
      kind: finding.kind, scanner, severity, detail: finding.detail, at: now,
    });
    const incident: Incident = {
      kind: finding.kind, watch: scanner as never, severity,
      detail: finding.detail, at: now, auditId: entry.hash,
    };
    this.incidents.push(incident);
    return incident;
  }

  private haltOnCritical(found: readonly Incident[], now: number): void {
    if (!this.deps.policy.halt_on_critical || this.halted) return;
    const critical = found.filter((i) => i.severity === 'critical');
    this.halted = true;
    this.deps.audit.append(PRODUCTION_GUARD, 'production_critical_halt', {
      at: now, kinds: critical.map((i) => i.kind), count: critical.length,
    });
    this.deps.killSwitch.engage(
      PRODUCTION_GUARD, 'all',
      `حادث حرج في التشغيل الاتحادي: ${critical.map((i) => i.kind).join(', ')}`,
    );
  }

  incidentsOf(severity: Severity): readonly Incident[] {
    return this.incidents.filter((i) => i.severity === severity);
  }

  report(): SupervisionReport {
    const scannerSweeps: Record<string, number> = {};
    for (const [scanner, count] of this.scannerSweeps) scannerSweeps[scanner] = count;
    return {
      sweeps: this.sweeps,
      failedSweeps: this.failedSweeps,
      incidents: [...this.incidents],
      critical: this.incidents.filter((i) => i.severity === 'critical').length,
      high: this.incidents.filter((i) => i.severity === 'high').length,
      scannerSweeps,
      halted: this.halted,
      running: this.running,
      gaps: [...this.gaps],
      hostStalls: [...this.hostStalls],
      bootAt: this.deps.bootAt,
      startedAt: this.startedAt,
      firstSweepAt: this.firstSweepAt,
      lastSweepAt: this.lastSweepAt,
      restartGapMs: this.restartGapMs,
    };
  }
}
