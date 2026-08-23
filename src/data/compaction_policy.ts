/**
 * src/data/compaction_policy.ts — عتبةُ الضغط واحتفاظُ الأرشيفات (المرحلة 39 — البند T-123)
 * المالك: وزارة البيانات | القاعدة الحاكمة RULE-000: كل تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: يوميّةٌ قائمة (StateJournal) + سياسةُ الضغط والاحتفاظ من `config/persistence.yaml`
 * المخرجات: رأيٌ معلَّل في الضغط (CompactionVerdict) وتقريرُ محوٍ مُبرهن (ArchivePruneReport)
 * التبعيات: `persistence.ts` و`journal_compaction.ts` — تُعاد استعمالًا لا نسخًا
 * الصلاحيات: الحسابُ والمحوُ المُبرهن. **لا تُنادي هذه الوحدة الضغطَ ولا تُقرّره** (RULE-004)
 * السجلات: لا تُسجّل الوحدة في السجل الأبدي — من يقرأ الرأي ويعمل به هو من يُقيّد قراره
 *
 * ثوابت هذه الوحدة:
 *   1) **العتبةُ في التهيئة لا في الشفرة**: كل رقمٍ هنا مقروءٌ من `compaction` و`archives`،
 *      والوحدةُ لا تعرف قيمةً افتراضيّة تعمل بها إن غابت السياسة (RULE-005).
 *   2) **الرأيُ معلَّل دائمًا**: `shouldCompact` يُرجع سببًا مقروءًا في الحالتين — «نعم»
 *      بلا سبب و«لا» بلا سبب سواءٌ في العجز عن التدقيق (RULE-006).
 *   3) **الفاصلُ يُقاس من اليوميّة نفسها لا من حالةٍ في الذاكرة**: زمنُ آخر ضغطٍ يُقرأ من
 *      علامة `journal_compacted` في أوّل الملف — فإعادةُ تشغيل العملية لا تُصفّر السياسة.
 *   4) **لا يُمحى أرشيفٌ إلا بثلاثة شروطٍ مجتمعة**: ليس من أحدثِ `keep_min`، وعمرُه فوق
 *      `max_age_ms`، و**كلُّ قيدٍ فيه مُغطًّى في اليوميّة القائمة**. سقوطُ أيّ شرطٍ إبقاءٌ.
 *   5) **التغطيةُ برهانٌ لا ظنّ**: القيدُ ذو الهويّة يُغطّى بوجود هويّته في اليوميّة (فأحدثُه
 *      باقٍ بحكم الضغط)، والقيدُ بلا هويّة — كقيد التدقيق — يُغطّى ببصمةِ حمولته حرفًا.
 *      أرشيفٌ لا يُقرأ أو لا يُبرهن على تغطيته **يبقى**: العجزُ عن البرهان ليس إذنًا بالمحو.
 *   6) **المحوُ لا يمسّ اليوميّة القائمة قطّ**: الوحدة تحذف ملفات `*.archive` وحدها،
 *      ولا تكتب في ملف اليوميّة ولا تُعيد ترتيبه.
 *
 * حالات الفشل (كلها مغلقة): مجلدُ اليوميّة غائب ⇒ ARCHIVE_RETENTION_DIRECTORY ·
 *   حرسُ التغطية مُعطَّل في السياسة ⇒ ARCHIVE_RETENTION_GUARD_DISABLED
 * اختبار القبول: tests/data/compaction_policy.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0030-durability-scope-and-retention.md
 */
import {
  createHash,
} from 'node:crypto';
import {
  existsSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { SovereignViolation } from '../kernel/types';
import type { ArchiveRetentionConfig, CompactionPolicyConfig } from '../kernel/config/persistence';
import { DurableRecord, StateJournal } from './persistence';
import { durableIdentity } from './journal_compaction';

/** رأيٌ في الضغط: قرارُه لغيرِ هذه الوحدة، وتعليلُه واجبٌ عليها (ثابت 2) */
export interface CompactionVerdict {
  /** هل بلغت اليوميّةُ العتبةَ المعلنة وانقضى الفاصلُ الأدنى؟ */
  readonly compact: boolean;
  /** سببٌ مقروء — يُقيّده من يعمل بالرأي في السجل الأبدي */
  readonly reason: string;
  readonly records: number;
  readonly threshold: number;
  /** زمنُ آخر ضغطٍ كما شهدت به العلامةُ في الملف، أو `null` إن لم تُضغط قطّ */
  readonly lastCompactedAt: number | null;
  readonly sinceMs: number | null;
  readonly minIntervalMs: number;
}

/** ما جرى لأرشيفٍ واحد — وكلُّ إبقاءٍ معلَّل كما كلُّ محو */
export interface ArchiveDecision {
  readonly file: string;
  readonly bytes: number;
  readonly ageMs: number;
  readonly pruned: boolean;
  readonly reason: string;
}

export interface ArchivePruneReport {
  readonly examined: number;
  readonly pruned: readonly string[];
  readonly kept: readonly string[];
  readonly reclaimedBytes: number;
  readonly decisions: readonly ArchiveDecision[];
}

/** بصمةُ الحمولةِ حرفًا — شاهدُ القيدِ الذي لا هويّةَ له (ثابت 5) */
function payloadFingerprint(entry: DurableRecord): string {
  return createHash('sha256')
    .update(`${entry.kind}\u0000${entry.at}\u0000${JSON.stringify(entry.payload)}`)
    .digest('hex');
}

/**
 * زمنُ آخر ضغط: من علامة `journal_compacted` إن كانت أوّلَ قيدٍ في الملف (ثابت 3).
 * يوميّةٌ لم تُضغط قطّ تُرجع `null` — وهي حالةٌ مشروعة لا خطأ.
 */
export function lastCompactionAt(entries: readonly DurableRecord[]): number | null {
  const first = entries[0];
  if (!first || first.kind !== 'journal_compacted') return null;
  return first.at;
}

/**
 * يحسب الرأيَ في مناداة الضغط. لا يقرأ الملفَ إن مُرّرت القيودُ — فمن قرأ اليوميّةَ
 * لغرضٍ آخر لا يُكلَّف قراءةً ثانية.
 */
export function shouldCompact(
  journal: StateJournal,
  policy: CompactionPolicyConfig,
  now = Date.now(),
  entries?: readonly DurableRecord[],
): CompactionVerdict {
  const records = entries ?? journal.read();
  const lastAt = lastCompactionAt(records);
  const sinceMs = lastAt === null ? null : now - lastAt;
  const base = {
    records: records.length,
    threshold: policy.compact_at_records,
    lastCompactedAt: lastAt,
    sinceMs,
    minIntervalMs: policy.min_interval_ms,
  };
  if (records.length < policy.compact_at_records) {
    return {
      ...base,
      compact: false,
      reason: `القيود ${records.length} دون العتبة المعلنة ${policy.compact_at_records}`,
    };
  }
  if (sinceMs !== null && sinceMs < policy.min_interval_ms) {
    return {
      ...base,
      compact: false,
      reason: `العتبة مبلوغة، لكن الفاصل ${sinceMs}ms دون الأدنى المعلن ${policy.min_interval_ms}ms`,
    };
  }
  return {
    ...base,
    compact: true,
    reason: `القيود ${records.length} بلغت العتبة ${policy.compact_at_records}`
      + `${sinceMs === null ? ' ولم تُضغط اليوميّة قطّ' : ` والفاصل ${sinceMs}ms فوق الأدنى`}`,
  };
}

/** أرشيفاتُ يوميّةٍ بعينها مرتّبةً بتسلسلها: `<file>.<seq>.archive` */
function listArchives(journalFile: string): { file: string; seq: number }[] {
  const directory = dirname(journalFile);
  if (!existsSync(directory)) {
    throw new SovereignViolation(
      `مجلد اليوميّة غير موجود: ${directory}`,
      'ARCHIVE_RETENTION_DIRECTORY',
    );
  }
  const prefix = `${journalFile.slice(directory.length + 1)}.`;
  const found: { file: string; seq: number }[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith('.archive')) continue;
    const seq = Number(name.slice(prefix.length, name.length - '.archive'.length));
    if (!Number.isSafeInteger(seq) || seq <= 0) continue;
    found.push({ file: join(directory, name), seq });
  }
  return found.sort((left, right) => left.seq - right.seq);
}

/** شواهدُ اليوميّة القائمة: هويّاتٌ وبصماتُ حمولات (ثابت 5) */
function currentWitnesses(entries: readonly DurableRecord[]): {
  identities: Set<string>; fingerprints: Set<string>;
} {
  const identities = new Set<string>();
  const fingerprints = new Set<string>();
  for (const entry of entries) {
    const identity = durableIdentity(entry);
    if (identity !== null) identities.add(identity);
    else fingerprints.add(payloadFingerprint(entry));
  }
  return { identities, fingerprints };
}

/**
 * يبرهن أنّ كلَّ قيدٍ في الأرشيف له شاهدٌ في اليوميّة القائمة (ثابت 5).
 * يُرجع `null` عند البرهان، أو نصَّ أوّلِ قيدٍ لا شاهدَ له — فالرفضُ مُبيَّن لا مبهم.
 */
function witnessGap(
  archiveFile: string,
  witnesses: { identities: Set<string>; fingerprints: Set<string> },
): string | null {
  let lines: string[];
  try {
    lines = readFileSync(archiveFile, 'utf8').split('\n').filter((line) => line.trim() !== '');
  } catch {
    return 'الأرشيف لا يُقرأ — والعجز عن البرهان ليس إذنًا بالمحو';
  }
  for (const line of lines) {
    let entry: DurableRecord;
    try {
      entry = JSON.parse(line) as DurableRecord;
    } catch {
      return 'قيدٌ في الأرشيف لا يُفسَّر — والعجز عن البرهان ليس إذنًا بالمحو';
    }
    // علامةُ ضغطٍ سابقة ليست شهادةَ حالة: هي شهادةٌ على الضغط نفسه، وقد نُقلت إلى
    // الملف الجديد علامةً أحدث. فلا تُطلب تغطيتُها — وهذا انحرافٌ معلن (RULE-008).
    if (entry.kind === 'journal_compacted') continue;
    const identity = durableIdentity(entry);
    if (identity !== null) {
      if (!witnesses.identities.has(identity)) return `هويّة بلا شاهد: ${identity}`;
      continue;
    }
    if (!witnesses.fingerprints.has(payloadFingerprint(entry))) {
      return `قيد ${entry.kind} بتسلسل ${entry.seq} بلا شاهد في اليوميّة القائمة`;
    }
  }
  return null;
}

/**
 * يمحو ما استوفى الشروطَ الثلاثة مجتمعةً (ثابت 4)، ويُبقي ما دونها ببيان سببه.
 * التنفيذُ لا القرار: من ينادي هذه الدالّة يُقيّد قراره في السجل الأبدي (RULE-004/006).
 */
export function pruneArchives(
  journal: StateJournal,
  retention: ArchiveRetentionConfig,
  now = Date.now(),
  entries?: readonly DurableRecord[],
): ArchivePruneReport {
  if (retention.require_witness_coverage !== true) {
    throw new SovereignViolation(
      'حرس تغطية الشاهد مُعطَّل — لا محو أرشيفٍ بسياسةٍ تُعطّل برهانَها',
      'ARCHIVE_RETENTION_GUARD_DISABLED',
    );
  }
  const archives = listArchives(journal.file);
  const witnesses = currentWitnesses(entries ?? journal.read());
  const protectedFrom = Math.max(0, archives.length - retention.keep_min);
  const decisions: ArchiveDecision[] = [];
  const pruned: string[] = [];
  const kept: string[] = [];
  let reclaimed = 0;

  for (let index = 0; index < archives.length; index++) {
    const { file } = archives[index]!;
    const stats = statSync(file);
    const ageMs = now - stats.mtimeMs;
    const decide = (isPruned: boolean, reason: string): void => {
      decisions.push({ file, bytes: stats.size, ageMs, pruned: isPruned, reason });
      if (isPruned) { pruned.push(file); reclaimed += stats.size; } else kept.push(file);
    };
    if (index >= protectedFrom) {
      decide(false, `من أحدث ${retention.keep_min} أرشيفات — لا يُمسّ`);
      continue;
    }
    if (ageMs <= retention.max_age_ms) {
      decide(false, `عمره ${ageMs}ms دون الحدّ المعلن ${retention.max_age_ms}ms`);
      continue;
    }
    const gap = witnessGap(file, witnesses);
    if (gap !== null) {
      decide(false, `شاهدٌ مطلوب لم يُبرهن على بقائه — ${gap}`);
      continue;
    }
    rmSync(file, { force: true });
    decide(true, 'كل قيوده مُغطّاة في اليوميّة القائمة، وعمره فوق الحدّ المعلن');
  }

  return {
    examined: archives.length, pruned, kept, reclaimedBytes: reclaimed, decisions,
  };
}
