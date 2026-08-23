/**
 * src/security/channel_bus.ts — ناقلُ القنوات المعلنة: لا تفاعلَ خارج قناةٍ مسجَّلة
 * المالك: ديوان التدقيق | المرحلة: 39 (البند T-23 — إكمالُ C-12)
 * المدخلات: رسالةٌ (من، إلى، قناة، نوع، موضوع، وقت) + إعلانُ القنوات من التهيئة
 * المخرجات: قبولٌ يُقيَّد ويُغذّي كاشفَ التواطؤ، أو رفضٌ يُقيَّد ويُرفع نمطًا
 * التبعيات: السجل + كاشف التواطؤ + `config/channels.yaml` — ولا تمنح شيئًا
 * الصلاحيات: الرفضُ والتقييد ورفعُ النمط؛ والتعليقُ والتجميدُ يقعان في الكاشف
 * السجلات: channel_message_sent / unregistered_channel_refused /
 *          channel_participant_refused / channel_kind_refused / channel_rate_exceeded /
 *          channel_anchor_refused
 * حالات الفشل (كلها مغلقة): قناةٌ غيرُ معلنة · مرسلٌ أو مستقبلٌ ليس مشتركًا ·
 *   نوعُ تفاعلٍ خارج القناة · تجاوزُ سقفِ الرسائل في النافذة
 * اختبار القبول: tests/rebellion/channel_bus.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 *
 * ثوابت هذه الوحدة:
 *   1) **القناةُ لا تُنشأ باستعمالها.** إرسالٌ على معرِّفٍ غيرِ معلنٍ **رفضٌ ونمطُ تواطؤ**:
 *      من يملك اختراعَ قناةٍ بالإرسال يملك التنسيقَ خارج مدى القياس (عينُ فجوة T-23).
 *   2) **العضويّةُ شرطٌ في الطرفين.** غيرُ المشترك لا يرسل ولا يُرسَل إليه.
 *   2م) **المرساةُ طرفٌ لازم.** قناةٌ أُعلنت لها مرساةٌ لا تُستعمل بين مشتركين اثنين
 *      دونها: سابقةُ `agent:*` بلا مرساةٍ ناقلٌ بين الوكلاء باسمٍ مشروع.
 *   3) **الرسالةُ المقبولةُ تُغذّي كاشفَ التواطؤ** — فالقناةُ المشروعةُ مقروءةٌ لا معفاة.
 *   4) **السقفُ حدٌّ لا زينة:** له قيمةٌ تُسقطه في الاختبار، فليس ثابتًا نائمًا (RULE-005).
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ChannelsConfig, DeclaredChannel, loadChannels } from '../kernel/config/channels';
import { CollusionDetector, InteractionKind } from './collusion_detector';

export interface ChannelMessage {
  readonly from: EntityId;
  readonly to: EntityId;
  readonly channel: string;
  readonly kind: InteractionKind;
  readonly subject: string;
  readonly at: number;
}

export interface ChannelDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly code: string;
}

/** المشتركُ يُطابَق حرفيًّا أو بسابقةٍ منتهيةٍ بـ`*` — ولا نمطَ أوسعَ من ذلك */
function isParticipant(pattern: string, entity: EntityId): boolean {
  if (pattern.endsWith('*')) return entity.startsWith(pattern.slice(0, -1));
  return pattern === entity;
}

export class ChannelBus {
  /** أوقاتُ الرسائل لكلِّ قناةٍ — لقياسِ السقف في النافذة */
  private readonly windows = new Map<string, number[]>();
  private readonly accepted: ChannelMessage[] = [];

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly collusion: CollusionDetector,
    private readonly config: ChannelsConfig = loadChannels(),
    private readonly busId: EntityId = 'authority:audit_bureau',
  ) {}

  /** القنواتُ المعلنة — تُقرأ ولا تُزاد في الجريان */
  get channels(): readonly DeclaredChannel[] {
    return this.config.channels;
  }

  get acceptedCount(): number {
    return this.accepted.length;
  }

  private refuse(m: ChannelMessage, code: string, reason: string, raisePattern: boolean): ChannelDecision {
    this.audit.append(this.busId, code, {
      from: m.from, to: m.to, channel: m.channel, kind: m.kind, subject: m.subject,
    });
    if (raisePattern) {
      this.collusion.raise({
        pattern: 'unregistered_channel',
        parties: [m.from, m.to],
        subject: `${m.channel}:${m.subject}`,
      });
    }
    return { allowed: false, reason, code };
  }

  /**
   * إرسالُ رسالةٍ بين كيانين. القبولُ يُقيَّد ويُمرَّر إلى كاشف التواطؤ،
   * والرفضُ يُقيَّد ويُرفع نمطًا حين يكون الرفضُ دليلَ تنسيقٍ خارج المدى.
   */
  send(m: ChannelMessage): ChannelDecision {
    const channel = this.config.channels.find((c) => c.id === m.channel);
    if (!channel) {
      return this.refuse(
        m, 'unregistered_channel_refused',
        'قناة غير مسجَّلة — ولا تُنشأ قناةٌ باستعمالها',
        true,
      );
    }
    if (!channel.kinds.includes(m.kind)) {
      return this.refuse(
        m, 'channel_kind_refused',
        `نوع تفاعل خارج أنواع القناة المعلنة: ${m.kind}`,
        true,
      );
    }
    if (this.config.policy.refuseNonParticipant) {
      const senderOk = channel.participants.some((p) => isParticipant(p, m.from));
      const receiverOk = channel.participants.some((p) => isParticipant(p, m.to));
      if (!senderOk || !receiverOk) {
        return this.refuse(
          m, 'channel_participant_refused',
          'طرفٌ ليس مشتركًا في القناة — لا إرسال ولا استقبال',
          true,
        );
      }
    }
    if (channel.anchor !== null && m.from !== channel.anchor && m.to !== channel.anchor) {
      return this.refuse(
        m, 'channel_anchor_refused',
        `قناةٌ مرساتُها ${channel.anchor} لا تُستعمل بين طرفين دونها`,
        true,
      );
    }
    const times = (this.windows.get(m.channel) ?? [])
      .filter((t) => m.at - t < this.config.policy.windowMs);
    if (times.length >= this.config.policy.maxMessagesPerWindow) {
      this.windows.set(m.channel, times);
      // تجاوزُ السقف ليس تواطؤًا بحكم الشكل — فهو ضجيجٌ يُرفض ويُقيَّد ولا يُعلَّق به أحد
      return this.refuse(
        m, 'channel_rate_exceeded',
        `تجاوز سقف رسائل القناة (${this.config.policy.maxMessagesPerWindow})`,
        false,
      );
    }
    times.push(m.at);
    this.windows.set(m.channel, times);
    this.accepted.push(m);
    this.audit.append(m.from, 'channel_message_sent', {
      to: m.to, channel: m.channel, kind: m.kind, subject: m.subject,
    });
    // القناةُ المشروعةُ مقروءةٌ لا معفاة: أنماطُ الوسيطِ والحلقةِ والتصعيدِ تُقاس عليها
    this.collusion.record({ from: m.from, to: m.to, kind: m.kind, subject: m.subject, at: m.at });
    return { allowed: true, reason: 'قناة مسجَّلة ومشتركوها معلنون', code: 'channel_message_sent' };
  }

  report(): {
    readonly declared: number;
    readonly accepted: number;
    readonly severity: 'critical';
  } {
    return {
      declared: this.config.channels.length,
      accepted: this.accepted.length,
      severity: this.config.productionSeverity,
    };
  }
}
