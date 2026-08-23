/**
 * src/data/journal_compaction.ts — ضغطُ يوميّة الحالة (المرحلة 39 — البند T-121)
 * المالك: وزارة البيانات | القاعدة الحاكمة RULE-000: كل تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: يوميّةٌ قائمة (StateJournal) بملفٍ مُتحقَّقٍ من سلسلته
 * المخرجات: تقريرُ ضغطٍ معلن {before, after, dropped..., head, archive} وملفٌ جديد
 * التبعيات: StateJournal و hashDurableRecord و JOURNAL_GENESIS — تُعاد استعمالًا لا نسخًا
 * الصلاحيات: القراءة والاستبدال المُؤرشَف؛ **ولا حذف** — الأصل يبقى بجوار الجديد
 * السجلات: لا تُسجّل الوحدة في السجل الأبدي — من ينادي الضغط هو من يُقيّد قراره
 *
 * ثوابت هذه الوحدة:
 *   1) **لا ضغط على سلسلةٍ مشكوكة**: يُتحقَّق من السلسلة أولًا؛ يوميّةٌ محرَّفة تُرفض
 *      رفضًا مغلقًا ولا تُلمس — الضغط لا يُستعمل مطهِّرًا لتحريف.
 *   2) **قيدُ التدقيق لا يُحذف أبدًا**: سلسلة التدقيق أبديّة (RULE-006)، فالمكسب هنا
 *      محدودٌ بالقيود المنسوخة من الذاكرة والمعرفة والمشاركات واللقطات — وهذا **يُعلن**
 *      انحرافًا عن أي فهمٍ بأن الضغط يُقلّص كل شيء (RULE-008).
 *   3) **الأصل لا يُحذف**: الملف السابق يُنقل إلى `<file>.<seq>.archive` فيبقى شاهدًا؛
 *      من أراد التحقق من الضغط نفسه قابَل الأرشيف بالجديد.
 *   4) **الكتابة ذرّية**: يُكتب ملفٌ مؤقّت ويُزامن ثم يُنقل نقلًا واحدًا — انقطاعُ
 *      الكهرباء في منتصف الضغط يترك اليوميّة الأصلية سليمة لا نصفَ يوميّة.
 *   5) **الضغط هو العملية الوحيدة التي تُعيد كتابة الملف** (إعلانُ انحراف صريح عن
 *      «يُضاف إليه فقط»): وله بابٌ واحد هو هذه الدالّة، وعلامةٌ في الملف تشهد بحدوثه.
 *   6) **العلامة أولًا**: أوّل قيدٍ في الملف الجديد `journal_compacted` — فمن يقرأ
 *      يوميّةً مضغوطة يعلم أنها مضغوطة قبل أن يُفسّر نقص قيودها.
 *   7) **الحمولة والزمن لا يُمَسّان**: يُعاد التسلسل والبصمات، ويبقى `payload` و`at`
 *      كما كُتبا أوّل مرة — الضغط يُسقط المنسوخ ولا يُحرّر الباقي.
 *
 * حالات الفشل (كلها مغلقة): سلسلة محرَّفة ⇒ JOURNAL_COMPACTION_TAMPERED ·
 *   يوميّة غائبة/فارغة ⇒ JOURNAL_COMPACTION_EMPTY · العلامة خارج النطاق المعلن ⇒
 *   JOURNAL_COMPACTION_KIND_NOT_IN_SCOPE · موضع أرشيفٍ مشغول ⇒ JOURNAL_COMPACTION_ARCHIVE_EXISTS
 * اختبار القبول: tests/data/journal_compaction.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0025-journal-compaction.md
 */
import { closeSync, existsSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';
import { SovereignViolation } from '../kernel/types';
import {
  DurableRecord, JOURNAL_GENESIS, StateJournal, hashDurableRecord,
} from './persistence';

export interface CompactionReport {
  /** عدد القيود قبل الضغط */
  readonly before: number;
  /** عدد القيود بعده — شاملًا قيد العلامة */
  readonly after: number;
  /** ما أُسقط لأنه نُسخ بأحدثَ منه */
  readonly droppedSupersededRecords: number;
  /** بصمة رأس اليوميّة الجديدة */
  readonly head: string;
  /** مسار أرشيف اليوميّة السابقة — الأصل لم يُحذف (ثابت 3) */
  readonly archive: string;
  /** بصمة رأس اليوميّة السابقة كما شُهد بها في العلامة */
  readonly previousHead: string;
}

/** مفتاحُ الهويّة لكل صنفٍ يُنسخ: القيدُ الأحدث بالمفتاح نفسه يُسقط ما قبله */
function identityOf(entry: DurableRecord): string | null {
  const payload = entry.payload as Record<string, unknown> | null;
  if (payload === null || typeof payload !== 'object') return null;
  switch (entry.kind) {
    case 'memory_record':
      return typeof payload.recordId === 'string' ? `memory_record:${payload.recordId}` : null;
    case 'knowledge_fact':
      return typeof payload.factId === 'string' ? `knowledge_fact:${payload.factId}` : null;
    case 'memory_share':
      return typeof payload.recordId === 'string' && typeof payload.reader === 'string'
        ? `memory_share:${payload.recordId}:${payload.reader}` : null;
    case 'archive_snapshot':
      // لقطةٌ واحدة تكفي: الأحدث تُغني عن كل ما قبلها بحكم كونها لقطةً كاملة.
      return 'archive_snapshot';
    default:
      // قيد التدقيق وعلامات الضغط السابقة: لا هويّة ⇒ لا إسقاط (ثابت 2).
      return null;
  }
}

/**
 * يختار الباقين: يُمسح الجدول من آخره إلى أوّله، فأوّلُ ظهورٍ للمفتاح هو الأحدث.
 * القيودُ بلا مفتاح تبقى كلها بترتيبها الأصلي.
 */
function selectSurvivors(entries: readonly DurableRecord[]): readonly DurableRecord[] {
  const seen = new Set<string>();
  const keep = new Array<boolean>(entries.length).fill(false);
  for (let i = entries.length - 1; i >= 0; i--) {
    const key = identityOf(entries[i]!);
    if (key === null) { keep[i] = true; continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    keep[i] = true;
  }
  return entries.filter((_, i) => keep[i]!);
}

/**
 * يضغط اليوميّة ضغطًا مُؤرشفًا. لا يُنادى تلقائيًّا من مسار كتابةٍ قطّ: من يقرّر الضغط
 * جهةٌ تُقيّد قرارها في السجل الأبدي، والوحدة هنا تُنفّذ ولا تُقرّر (RULE-004).
 */
export function compactJournal(journal: StateJournal, at = Date.now()): CompactionReport {
  if (!journal.covers('journal_compacted')) {
    throw new SovereignViolation(
      'علامة الضغط خارج النطاق المعلن — يوميّةٌ مضغوطة لا تُقرأ في الإقلاع التالي',
      'JOURNAL_COMPACTION_KIND_NOT_IN_SCOPE',
    );
  }
  // ثابت 1: التحقق قبل اللمس. `read()` يتحقق ويرفع رفضًا مغلقًا عند التحريف.
  let entries: readonly DurableRecord[];
  try {
    entries = journal.read();
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'PERSISTENCE_JOURNAL_TAMPERED';
    throw new SovereignViolation(
      `لا ضغط على يوميّة غير مُتحقَّقة (${code})`,
      'JOURNAL_COMPACTION_TAMPERED',
    );
  }
  if (entries.length === 0) {
    throw new SovereignViolation('لا يوميّة تُضغط', 'JOURNAL_COMPACTION_EMPTY');
  }

  const previousHead = entries[entries.length - 1]!.hash;
  const archive = `${journal.file}.${entries.length}.archive`;
  if (existsSync(archive)) {
    throw new SovereignViolation(
      `موضع الأرشيف مشغول: ${archive} — الأصل لا يُطمس بأصلٍ آخر`,
      'JOURNAL_COMPACTION_ARCHIVE_EXISTS',
    );
  }
  const survivors = selectSurvivors(entries);

  // ثابت 6 و7: العلامة أولًا، ثم الباقون بحمولاتهم وأزمانهم كما هي، بتسلسلٍ جديد.
  const marker = {
    seq: 1, at, kind: 'journal_compacted' as const,
    payload: { previousLength: entries.length, previousHead, archive },
    prevHash: JOURNAL_GENESIS,
  };
  const rebuilt: DurableRecord[] = [{ ...marker, hash: hashDurableRecord(marker) }];
  for (const entry of survivors) {
    const prev = rebuilt[rebuilt.length - 1]!;
    const base = {
      seq: prev.seq + 1, at: entry.at, kind: entry.kind,
      payload: entry.payload, prevHash: prev.hash,
    };
    rebuilt.push({ ...base, hash: hashDurableRecord(base) });
  }

  // ثابت 4: مؤقّتٌ يُزامن ثم نقلٌ واحد. الأصل يُؤرشف قبل النقل فلا لحظةَ يكون فيها
  // الملفان مفقودين معًا: الأرشيف موجود قبل أن يُستبدل الاسم الأصلي.
  const temp = `${journal.file}.compacting`;
  const fd = openSync(temp, 'w');
  try {
    for (const entry of rebuilt) writeSync(fd, `${JSON.stringify(entry)}\n`, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  journal.close();
  renameSync(journal.file, archive);
  renameSync(temp, journal.file);
  journal.reload();

  return {
    before: entries.length,
    after: rebuilt.length,
    droppedSupersededRecords: entries.length - survivors.length,
    head: rebuilt[rebuilt.length - 1]!.hash,
    archive,
    previousHead,
  };
}
