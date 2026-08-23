/**
 * src/security/covert_channels.ts — كشفُ القناةِ المستورة من أثرِ النداءات لا من التبليغ
 * المالك: ديوان التدقيق | المرحلة: 39 (البند T-23 — إكمالُ C-12)
 * المدخلات: كلُّ نداءِ أداةٍ وقع فعلًا (عبر `ToolCallWitness`) + عتباتُ التهيئة
 * المخرجات: نمطُ `covert_signal` أو `covert_cadence` يُرفع إلى كاشف التواطؤ
 * التبعيات: السجل + كاشف التواطؤ + `config/channels.yaml` — ولا تمنح شيئًا ولا تمنع
 * الصلاحيات: القياسُ ورفعُ النمط؛ والتعليقُ والتجميدُ يقعان في الكاشف (RULE-004)
 * السجلات: covert_signal_detected / covert_cadence_detected (بواسطة الكاشف)
 * حالات الفشل (كلها مغلقة): لا عتبةَ في التهيئة ⇒ التحميلُ يسقط قبل التشغيل
 * اختبار القبول: tests/rebellion/covert_channels.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 *
 * ثوابت هذه الوحدة:
 *   1) **يُقاس ما وقع لا ما بُلِّغ عنه.** مصدرُ الأثر شاهدُ النداءات، فمن نسّق بلا رسالةٍ
 *      لم يخرج من مدى القياس (عينُ فجوة T-23).
 *   2) **الرابطُ المُعلَن يرفع الشبهة.** طرفان بينهما تفاعلٌ مُبلَّغٌ عنه يُحاكمان بأنماطِ
 *      كاشفِ التواطؤ المعلنة، لا بأنماطِ الستار — وإلا لعُوقب الإبلاغُ بنفسه.
 *   3) **النمطان شكليّان لا ظنّيّان:** موعدٌ على قيمةٍ واحدة، أو تبادلٌ صارمُ التعاقب —
 *      كلاهما يُحسب بعددٍ وزمنٍ من التهيئة، لا بنموذجٍ غامض.
 *   4) **الأثرُ محدودُ الذاكرة بالنافذة**: ما خرج منها يُنسى، فلا نموٌّ بلا حدّ.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ChannelsConfig, loadChannels } from '../kernel/config/channels';
import { CollusionDetector, CollusionFinding } from './collusion_detector';
import { argFingerprint } from './intent_plan';

interface CallTrace {
  readonly entity: EntityId;
  readonly tool: string;
  readonly fingerprint: string;
  readonly at: number;
}

export class CovertChannelDetector {
  private traces: CallTrace[] = [];
  private readonly raised = new Set<string>();

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly collusion: CollusionDetector,
    private readonly config: ChannelsConfig = loadChannels(),
    private readonly detectorId: EntityId = 'authority:audit_bureau',
  ) {}

  get traceCount(): number {
    return this.traces.length;
  }

  /** يُستدعى من ناقلِ الأدوات عند كلِّ نداءٍ ناجح — يقيس ولا يمنع */
  record(
    entity: EntityId,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    now: number,
  ): readonly CollusionFinding[] {
    const window = this.config.covert.windowMs;
    this.traces = this.traces.filter((t) => now - t.at <= window);
    const trace: CallTrace = { entity, tool, fingerprint: argFingerprint(args), at: now };
    this.traces.push(trace);
    this.audit.append(this.detectorId, 'covert_trace_recorded', {
      entity, tool, fingerprint: trace.fingerprint,
    });
    const found: CollusionFinding[] = [];
    const signal = this.detectSignal(trace);
    if (signal) found.push(signal);
    const cadence = this.detectCadence(trace);
    if (cadence) found.push(cadence);
    for (const finding of found) this.collusion.raise(finding);
    return found;
  }

  /** لا يُرفع النمطُ نفسُه مرتين على الأطرافِ والموضوعِ ذاتِه — تكرارُ الرفع ليس دليلًا ثانيًا */
  private once(finding: CollusionFinding): CollusionFinding | null {
    const key = `${finding.pattern}|${[...finding.parties].sort().join(',')}|${finding.subject}`;
    if (this.raised.has(key)) return null;
    this.raised.add(key);
    return finding;
  }

  /** كلُّ زوجٍ من الأطراف بلا رابطٍ مُعلَن؟ شرطُ الستار في النمطين */
  private allUnlinked(parties: readonly EntityId[]): boolean {
    for (let i = 0; i < parties.length; i += 1) {
      for (let j = i + 1; j < parties.length; j += 1) {
        if (this.collusion.hasDeclaredLink(parties[i]!, parties[j]!)) return false;
      }
    }
    return true;
  }

  /**
   * نمط 1 — الموعدُ المستور: أطرافٌ متعددةٌ تنادي الأداةَ ذاتَها بقيمةِ معاملٍ واحدةٍ
   * داخل النافذة بلا رابطٍ مُعلَن. القيمةُ المشتركةُ هي الرسالةُ، والقناةُ هي الأداة.
   */
  private detectSignal(trace: CallTrace): CollusionFinding | null {
    if (trace.fingerprint === '') return null;
    const peers = this.traces.filter(
      (t) => t.tool === trace.tool && t.fingerprint === trace.fingerprint
        && t.entity.startsWith('agent:'),
    );
    const parties = [...new Set(peers.map((p) => p.entity))];
    if (parties.length < this.config.covert.minRendezvousParties) return null;
    if (!this.allUnlinked(parties)) return null;
    return this.once({
      pattern: 'covert_signal',
      parties,
      subject: `${trace.tool}?${trace.fingerprint}`,
    });
  }

  /**
   * نمط 2 — قناةُ الإيقاع: طرفان يتعاقبان تعاقبًا صارمًا (أ ب أ ب…) على الأداةِ ذاتِها
   * بفواصلَ تحت الحدّ، بلا رابطٍ مُعلَن. المعلومةُ في الإيقاعِ لا في المتن.
   */
  private detectCadence(trace: CallTrace): CollusionFinding | null {
    if (!trace.entity.startsWith('agent:')) return null;
    const sameTool = this.traces.filter(
      (t) => t.tool === trace.tool && t.entity.startsWith('agent:'),
    );
    const tail: CallTrace[] = [];
    for (let i = sameTool.length - 1; i >= 0; i -= 1) {
      const item = sameTool[i]!;
      const previous = tail[tail.length - 1];
      if (previous) {
        if (previous.at - item.at > this.config.covert.maxAlternationGapMs) break;
        if (previous.entity === item.entity) break;
      }
      tail.push(item);
      if (tail.length >= this.config.covert.minAlternations) break;
    }
    if (tail.length < this.config.covert.minAlternations) return null;
    const parties = [...new Set(tail.map((t) => t.entity))];
    if (parties.length !== 2) return null;
    if (!this.allUnlinked(parties)) return null;
    return this.once({
      pattern: 'covert_cadence',
      parties: [...parties].sort(),
      subject: `${trace.tool}#cadence`,
    });
  }

  report(): {
    readonly traces: number;
    readonly raised: number;
    readonly maxUndetected: 0;
  } {
    return {
      traces: this.traces.length,
      raised: this.raised.size,
      maxUndetected: this.config.covert.maxUndetectedSignals,
    };
  }
}
