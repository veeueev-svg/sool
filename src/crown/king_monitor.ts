/**
 * src/crown/king_monitor.ts — مراقب الملك بمؤقّت حقيقي (المرحلة 8)
 * المالك: حرس التاج
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: نبض الملك (RoyalHeartbeat) | المخرجات: دخول حالة الحماية تلقائيًا + تقرير غياب
 * التبعيات: النبض، السجل، (اختياريًا) الإيقاف عند غياب مطوّل
 * الصلاحيات: المراقبة والتصعيد فقط — لا يصدر أوامر ولا يعتمدها (RULE-004)
 * ثوابت:
 *   - الدخول في الحماية لا يحتاج تدخّلًا بشريًا ولا استدعاءً خارجيًا
 *   - كل نوبة غياب تُسجَّل بزمن بدايتها ونهايتها ومدتها
 *   - الغياب الممتد فوق العتبة القصوى ⇒ إيقاف وقائي وتصعيد للملك
 * حالات الفشل (كلها مغلقة): تعذّر قراءة النبض ⇒ يُعامل كغياب لا كحضور
 * اختبار القبول: tests/crown/king_monitor.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-monarchy-comprehensive-spec.md — مراقبة الملك وغيابه
 */
import { StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { RoyalHeartbeat } from './royal_heartbeat';
import { KillSwitch } from '../security/kill_switch';

export interface AbsenceEpisode {
  readonly startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  escalated: boolean;
}

export interface MonitorOptions {
  /** كل كم مللي ثانية يُفحص الحضور */
  readonly tickMs: number;
  /** غياب يتجاوز هذه المدة ⇒ إيقاف وقائي */
  readonly maxAbsenceMs?: number;
  readonly killSwitch?: KillSwitch;
}

export class KingMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly episodes: AbsenceEpisode[] = [];
  private lastMode: StateMode = 'normal';
  private ticks = 0;

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly heartbeat: RoyalHeartbeat,
    private readonly options: MonitorOptions,
    private readonly onModeChange?: (mode: StateMode) => void,
  ) {}

  /** يبدأ المؤقّت الحقيقي — unref حتى لا يمنع خروج العملية */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.options.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.audit.append('authority:crown_guard', 'king_monitor_started', { tickMs: this.options.tickMs });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.audit.append('authority:crown_guard', 'king_monitor_stopped', { ticks: this.ticks });
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get tickCount(): number {
    return this.ticks;
  }

  /** فحص واحد — يُستدعى من المؤقّت، ويمكن استدعاؤه يدويًا في الاختبار */
  tick(now = Date.now()): StateMode {
    this.ticks += 1;
    let mode: StateMode;
    try {
      mode = this.heartbeat.evaluate(now);
    } catch {
      mode = 'protective'; // تعذّر التقييم = غياب، لا حضور (فشل مغلق)
    }

    if (mode !== this.lastMode) {
      if (mode === 'protective') {
        this.episodes.push({ startedAt: now, endedAt: null, durationMs: null, escalated: false });
        this.audit.append('authority:crown_guard', 'king_absence_detected', {
          lastBeatAt: this.heartbeat.lastBeatAt, at: now,
        });
      } else {
        const open = this.openEpisode();
        if (open) {
          open.endedAt = now;
          open.durationMs = now - open.startedAt;
          this.audit.append('authority:crown_guard', 'king_presence_restored', {
            absenceMs: open.durationMs,
          });
        }
      }
      this.lastMode = mode;
      this.onModeChange?.(mode);
    }

    const open = this.openEpisode();
    const maxAbsence = this.options.maxAbsenceMs;
    if (open && maxAbsence !== undefined && !open.escalated && now - open.startedAt >= maxAbsence) {
      open.escalated = true;
      this.audit.append('authority:crown_guard', 'king_absence_escalated', {
        absenceMs: now - open.startedAt, maxAbsenceMs: maxAbsence,
      });
      this.options.killSwitch?.engage(
        'authority:crown_guard', 'agents', 'غياب ملكي ممتد فوق العتبة — إيقاف وقائي',
      );
    }
    return mode;
  }

  private openEpisode(): AbsenceEpisode | undefined {
    const last = this.episodes[this.episodes.length - 1];
    return last && last.endedAt === null ? last : undefined;
  }

  /** تقرير الغياب: كل النوبات بمددها — دليل مسجَّل لا رواية */
  report(): readonly AbsenceEpisode[] {
    return this.episodes.map((e) => ({ ...e }));
  }

  get currentMode(): StateMode {
    return this.lastMode;
  }
}
