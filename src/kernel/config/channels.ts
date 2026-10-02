/**
 * src/kernel/config/channels.ts — القنواتُ المعلنة وعتباتُ كشفِ القناةِ المستورة
 * المالك: ديوان التدقيق | المرحلة: 39 (البند T-23 — إكمالُ C-12)
 * المدخلات: config/channels.yaml | المخرجات: ChannelsConfig
 * التبعيات: محلّل YAML الآمن و`resolveConfigDir` — ولا شيء غيرهما
 * الصلاحيات: القراءةُ والتحقّق؛ ولا تُنشئ هذه الوحدة قناةً ولا تكشف تواطؤًا
 * السجلات: لا شيء — والقرارُ يُقيَّد في وحدته
 * حالات الفشل (كلها مغلقة):
 *   - لا ملف أو لا سياسة ⇒ CONFIG_NO_CHANNEL_POLICY
 *   - الافتراض ليس رفضًا ⇒ CONFIG_CHANNEL_DEFAULT_ALLOW
 *   - شرطٌ مُلزمٌ مُعطَّل ⇒ CONFIG_CHANNEL_GUARD_DISABLED
 *   - حدٌّ غائبٌ أو غيرُ صحيحٍ موجب ⇒ CONFIG_CHANNEL_LIMIT
 *   - قناةٌ بلا معرِّفٍ أو بلا مشتركين أو بلا أنواع ⇒ CONFIG_CHANNEL_SPEC
 *   - قناةٌ مكرَّرةُ المعرِّف ⇒ CONFIG_CHANNEL_DUPLICATE (T-159 · W-2026-042: كان SPEC عامًّا)
 *   - نوعُ تفاعلٍ مكرَّرٌ في قناةٍ ⇒ CONFIG_CHANNEL_KIND_DUPLICATE
 *   - مشتركٌ مكرَّرٌ في قناةٍ ⇒ CONFIG_CHANNEL_PARTICIPANT_DUPLICATE
 *   - إشارةٌ مستورةٌ مسموحةٌ فوق الصفر ⇒ CONFIG_CHANNEL_COVERT
 *   - شدّةُ الإنتاج ليست «حرجة» ⇒ CONFIG_CHANNEL_SEVERITY
 * اختبار القبول: tests/kernel/channels_config.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 *
 * ثوابت هذه الوحدة:
 *   1) **قناةٌ لا تُنشأ عند أول استعمال.** القائمةُ هنا حصرٌ لا مثال (RULE-003).
 *   2) **الشرطان مُلزمان:** التسجيلُ والعضويّة لا يُعطَّلان من ملف (RULE-007).
 *   3) **الإشارةُ المستورة المسموحة صفر** — لا عتبةَ تسامحٍ تُرفع من التهيئة.
 *   4) **لا سابقةَ مشتركين بلا مرساة (`anchor`).** قناةٌ مشتركوها `agent:*` بلا طرفٍ
 *      معيّنٍ في أحد الطرفين هي ناقلٌ بين الوكلاء باسمٍ مشروع — وهو عينُ ما يُقاس
 *      في T-23. فالمرساةُ واجبةٌ متى أُعلنت سابقةٌ، وتُفحص في كلِّ رسالة.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { guardDeclaredCount } from './declaration_limits';
import { loadYamlFile } from './yaml';

const LIMIT = 'CONFIG_CHANNEL_LIMIT';
const SPEC = 'CONFIG_CHANNEL_SPEC';

export interface ChannelPolicy {
  /** شرطٌ مُلزم: لا رسالةَ إلا عبر قناةٍ مسجَّلة */
  readonly requireRegisteredChannel: true;
  /** شرطٌ مُلزم: مَن ليس مشتركًا لا يرسل ولا يستقبل */
  readonly refuseNonParticipant: true;
  readonly maxMessagesPerWindow: number;
  readonly windowMs: number;
}

export interface CovertPolicy {
  readonly windowMs: number;
  readonly minRendezvousParties: number;
  readonly minAlternations: number;
  readonly maxAlternationGapMs: number;
  /** الإشارةُ المستورة المسموحة — صفرٌ دائمًا */
  readonly maxUndetectedSignals: 0;
}

export interface DeclaredChannel {
  readonly id: string;
  readonly purpose: string;
  readonly kinds: readonly string[];
  /** مشتركٌ حرفيٌّ أو سابقةٌ منتهيةٌ بـ`*` */
  readonly participants: readonly string[];
  /** طرفٌ معيّنٌ يجب أن يكون أحدَ طرفي كلِّ رسالة — واجبٌ متى أُعلنت سابقة */
  readonly anchor: string | null;
}

export interface ChannelsConfig {
  readonly policy: ChannelPolicy;
  readonly covert: CovertPolicy;
  readonly channels: readonly DeclaredChannel[];
  readonly productionSeverity: 'critical';
}

function positiveInt(raw: unknown, field: string, code: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SovereignViolation(
      `حدُّ القنوات «${field}» غير معلنٍ أو غيرُ صحيحٍ موجب — لا حدَّ بلا رقم`,
      code,
    );
  }
  return value;
}

function mandatoryGuard(raw: unknown, field: string): true {
  if (raw !== true) {
    throw new SovereignViolation(
      `شرطُ القناة «${field}» مُلزمٌ ولا يُعطَّل من التهيئة — تعطيلُه نقضٌ للمعيار C-12`,
      'CONFIG_CHANNEL_GUARD_DISABLED',
    );
  }
  return true;
}

function readPolicy(raw: unknown): ChannelPolicy {
  if (!raw || typeof raw !== 'object') {
    throw new SovereignViolation('ملفُّ القنوات بلا قسمِ سياسة — لا شروطَ تُقرأ', 'CONFIG_NO_CHANNEL_POLICY');
  }
  const policy = raw as Record<string, unknown>;
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'افتراضُ سياسةِ القنوات يجب أن يكون رفضًا — والسماحُ الافتراضي قناةٌ بلا سجل',
      'CONFIG_CHANNEL_DEFAULT_ALLOW',
    );
  }
  return Object.freeze({
    requireRegisteredChannel: mandatoryGuard(
      policy.require_registered_channel, 'require_registered_channel',
    ),
    refuseNonParticipant: mandatoryGuard(policy.refuse_non_participant, 'refuse_non_participant'),
    maxMessagesPerWindow: positiveInt(policy.max_messages_per_window, 'max_messages_per_window', LIMIT),
    windowMs: positiveInt(policy.window_ms, 'window_ms', LIMIT),
  });
}

function readCovert(raw: unknown): CovertPolicy {
  const C = 'CONFIG_CHANNEL_COVERT';
  if (!raw || typeof raw !== 'object') {
    throw new SovereignViolation(
      'عتباتُ كشفِ القناةِ المستورة غير معلنة — وكشفٌ بلا عتبةٍ لا يقع على أحد',
      C,
    );
  }
  const covert = raw as Record<string, unknown>;
  if (Number(covert.max_undetected_signals) !== 0) {
    throw new SovereignViolation(
      'الإشارةُ المستورة المسموحة لا تكون فوق الصفر — واحدةٌ تمرّ تُسقط المعيار',
      C,
    );
  }
  const parties = positiveInt(covert.min_rendezvous_parties, 'min_rendezvous_parties', C);
  if (parties < 2) {
    throw new SovereignViolation('الموعدُ المستور لا يكون بطرفٍ واحد — أدنى الأطراف اثنان', C);
  }
  const alternations = positiveInt(covert.min_alternations, 'min_alternations', C);
  if (alternations < 4) {
    throw new SovereignViolation('قناةُ الإيقاع لا تُقاس بأقلَّ من أربعِ تبادلات — دونها مصادفة', C);
  }
  return Object.freeze({
    windowMs: positiveInt(covert.window_ms, 'window_ms', C),
    minRendezvousParties: parties,
    minAlternations: alternations,
    maxAlternationGapMs: positiveInt(covert.max_alternation_gap_ms, 'max_alternation_gap_ms', C),
    maxUndetectedSignals: 0 as const,
  });
}

function readChannel(raw: unknown, seen: Set<string>): DeclaredChannel {
  if (!raw || typeof raw !== 'object') {
    throw new SovereignViolation('قناةٌ معلنةٌ ليست خريطةَ حقول', SPEC);
  }
  const channel = raw as Record<string, unknown>;
  const id = String(channel.id ?? '');
  if (!id.startsWith('ch:') || id.length <= 3) {
    throw new SovereignViolation(`معرِّفُ قناةٍ غيرُ معلنٍ أو بلا سابقة «ch:»: ${id}`, SPEC);
  }
  if (seen.has(id)) {
    throw new SovereignViolation(`قناةٌ مكرَّرةٌ في الإعلان: ${id}`, 'CONFIG_CHANNEL_DUPLICATE');
  }
  seen.add(id);
  const kinds = channel.kinds;
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new SovereignViolation(`قناةٌ بلا أنواعِ تفاعلٍ معلنة: ${id}`, SPEC);
  }
  guardDeclaredCount('channel_kinds', kinds.length, `أنواعُ تفاعلِ القناة المعلنة: ${id}`);
  // فشل مغلق: نوعٌ مكرَّرٌ ينفخ مدى القناةِ عدًّا لا مدًى — والسقفُ يعدّ التكرارَ إعلانًا (T-135)
  const kindNames = kinds.map((k) => String(k));
  if (new Set(kindNames).size !== kindNames.length) {
    throw new SovereignViolation(
      `نوعُ تفاعلٍ مكرَّرٌ في القناة: ${id}`, 'CONFIG_CHANNEL_KIND_DUPLICATE',
    );
  }
  const participants = channel.participants;
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new SovereignViolation(`قناةٌ بأقلَّ من مشتركين اثنين: ${id}`, SPEC);
  }
  guardDeclaredCount(
    'channel_participants', participants.length, `مشتركو القناة المعلنون: ${id}`,
  );
  // فشل مغلق: مشتركٌ مكرَّرٌ يجعل «مشتركَين اثنين» مشتركًا واحدًا كُتب مرّتين — وشرطُ
  // الاثنين ضمانةٌ ألّا تكون القناةُ حديثَ طرفٍ مع نفسِه (T-135)
  const participantNames = participants.map((p) => String(p));
  if (new Set(participantNames).size !== participantNames.length) {
    throw new SovereignViolation(
      `مشتركٌ مكرَّرٌ في القناة: ${id}`, 'CONFIG_CHANNEL_PARTICIPANT_DUPLICATE',
    );
  }
  const purpose = String(channel.purpose ?? '');
  if (purpose.trim() === '') {
    throw new SovereignViolation(`قناةٌ بلا غرضٍ معلن: ${id}`, SPEC);
  }
  const names = participants.map((p) => String(p));
  const anchor = channel.anchor === undefined || channel.anchor === null
    ? null
    : String(channel.anchor);
  if (names.some((p) => p.endsWith('*'))) {
    if (anchor === null) {
      throw new SovereignViolation(
        `قناةٌ بسابقةِ مشتركين بلا مرساة — ناقلٌ بين الوكلاء باسمٍ مشروع: ${id}`,
        SPEC,
      );
    }
    if (!names.includes(anchor) || anchor.endsWith('*')) {
      throw new SovereignViolation(
        `مرساةُ القناة يجب أن تكون مشتركًا معيّنًا فيها: ${id}`,
        SPEC,
      );
    }
  }
  return Object.freeze({
    id,
    purpose,
    kinds: Object.freeze(kinds.map((k) => String(k))),
    participants: Object.freeze(names),
    anchor,
  });
}

/** تحميلُ إعلانِ القنوات وعتباتِ الكشف — الفشلُ مغلقٌ ولا افتراضاتَ صامتة */
export function loadChannels(configDir = resolveConfigDir()): ChannelsConfig {
  const path = join(configDir, 'channels.yaml');
  if (!existsSync(path)) {
    throw new SovereignViolation(
      'لا ملفَ قنواتٍ معلنة — ولا تفاعلَ بين كيانين بلا قناةٍ مسجَّلة',
      'CONFIG_NO_CHANNEL_POLICY',
    );
  }
  const doc = loadYamlFile(path) as Record<string, unknown>;
  if (doc.production_severity !== 'critical') {
    throw new SovereignViolation(
      'شدّةُ حادثِ القنوات في الإنتاج لا تُخفَّف عن «حرج»',
      'CONFIG_CHANNEL_SEVERITY',
    );
  }
  const declared = doc.channels;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new SovereignViolation('لا قناةَ معلنةً واحدة — والقائمةُ الفارغةُ ليست سياسة', SPEC);
  }
  guardDeclaredCount('channels', declared.length, 'القنواتُ المعلنة');
  const seen = new Set<string>();
  return Object.freeze({
    policy: readPolicy(doc.policy),
    covert: readCovert(doc.covert),
    channels: Object.freeze(declared.map((c) => readChannel(c, seen))),
    productionSeverity: 'critical' as const,
  });
}
