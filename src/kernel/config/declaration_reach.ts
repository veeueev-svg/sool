/**
 * src/kernel/config/declaration_reach.ts — مدى الحصر: ما يُحمَّل فعلًا يُحرس حيث يُقرأ (T-133)
 * المالك: القيّم على المستودع | المرحلة: 39 (دَينُ سقوفِ العدد)
 * المدخلات: مسارُ ملفٍ حُمِّل مع حجمِه وعُقدِه، أو مسارُ مجلدٍ يُمشى فيه
 * المخرجات: قائمةُ ملفاتِ الإعلان، أو دفترُ المُحمَّل، أو فشلٌ مغلق
 * حالات الفشل: `CONFIG_LOADED_BYTES_OVER_CEILING` · `CONFIG_LOADED_NODES_OVER_CEILING`
 *   · `CONFIG_DECLARATION_REACH_TOO_DEEP` (كلُّها فشلٌ مغلق — RULE-007)
 * اختبارات الوحدة: tests/kernel/declaration_reach.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0036-declaration-reach.md
 *   · القياسُ الخام: docs/audit/measurements/phase-39-T133.txt
 *
 * ثوابت هذه الوحدة:
 *   1) **الحدُّ يُعلن في الشفرة حيث يُقرأ لا في وثيقة**: مدى الحصر — اللواحقُ المعدودةُ وأقصى
 *      عمقٍ يُمشى فيه — مُثبتٌ في {@link DECLARATION_REACH} مجمَّدًا، لا في تعليقٍ ولا في ملفٍّ
 *      يحكمه من يتجاوزه (RULE-005). ومن وسّع المدى غيّر ثابتًا يُقرأ لا جملةً تُقرأ.
 *   2) **حرَسُ المجموع حرَسُ نداءٍ لا حرَسُ إقلاعٍ وحده**: قيس في T-133 أنّ نداءَ محمّلٍ مفردٍ
 *      يمرّ بسقفِ بايتات ملفِّه وبسقوفِ قوائمه **ولا يمرّ بسقفِ المجموع**، فصار كلُّ ملفٍّ
 *      يُقرأ يُقيَّد في دفترٍ لمجلدِه، ويُحرس **مجموعُ المُقيَّد** عند كلِّ قراءةٍ. فمن قرأ
 *      خمسةَ ملفاتٍ كلُّ واحدٍ تحت سقفِه يقع عليه سقفُ المجموع عند الخامس، بلا إقلاعٍ ولا تركيب.
 *   3) **الدفترُ لكلِّ مجلدٍ على حدة**: الميزانيّةُ تحرس **إعلانًا واحدًا** لا مجموعَ ما قرأته
 *      العمليّةُ من إعلاناتٍ مختلفة. فمن قرأ مجلدَ تهيئةٍ ثمّ مجلدَ بيانِ نشرٍ لم يُجمع عليه
 *      المجلدان في سقفٍ واحد — ولو جُمعا لسقط اختبارٌ يقرأ عشرةَ مجلداتٍ مؤقّتةٍ بلا ذنب.
 *   4) **المسارُ يُقيَّد مرّةً واحدةً ولو قُرئ مرّاتٍ**: القيدُ بالمسار لا بالقراءة، فإعادةُ
 *      قراءةِ الملفِّ نفسِه **تُحدِّث** قيدَه ولا تُضاعفه. وإلّا صار الحرَسُ يقيس تكرارَ
 *      النداءِ لا حجمَ الإعلان — وذاك كذبٌ في وحدةِ القياس.
 *   6) **البايتُ يُحرس بلا تحليلٍ والعُقدةُ لا تُحرس إلّا بعده**: مجموعُ بايتات المجلد
 *      يُقاس بمشيٍ وإحصاءِ أحجامٍ — بلا قراءةِ نصٍّ ولا تحليل — فيقع عند **كلِّ** قراءةٍ رخيصًا؛
 *      وأمّا العُقدُ فلا تُعرف إلّا بعد تحليلٍ، فتُحرس على ما حُمِّل فعلًا (الدفتر) وعلى المجلد
 *      كلِّه في الإقلاع (الحصر). فلكلِّ محورٍ موضعُ حرَسٍ يناسب كلفتَه، ولا يُدَّعى أكثر.
 *   7) **قياسُ المجلد يُحفظ ببصمةٍ ولا يُصدَّق بلا فحصٍ** (T-140): مجموعُ بايتات المجلد
 *      يُقاس مرّةً في الإقلاع، ويُعاد استخدامُه **فقط** إذا طابق زمنُ تعديلِ كلِّ مجلدٍ مُشِيَ
 *      فيه، ولم يختلف حجمُ ملفٍّ يُقرأ عمّا قيس. و**السقفُ يقع في الحالتَين برمزِه**: من أعاد
 *      استخدامَ قياسٍ لم يُعِد استخدامَ حكمٍ.
 *
 *   5) **العمقُ محدودٌ والوصلاتُ لا تُتَّبع**: مجلدٌ يشير إلى نفسه لا يُدخل الحصرَ في دَورٍ
 *      لا نهاية له، ومن أعمقَ من {@link DECLARATION_REACH.max_depth} رُدّ برمزٍ لا بصمت.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SovereignViolation } from '../types';
import { noteBootWork } from './declaration_work';
import { CONFIG_DECLARATION_BUDGET } from './declaration_budget';
import {
  directoryMeasureNames, forgetDirectoryMeasureIfFileChanged, memoizeDirectoryMeasure,
  resetDirectoryMeasures, storedDirectoryMeasure,
} from './declaration_dir_memo';

/**
 * مدى الحصر المعلن — **ثابتٌ يُقرأ في الشفرة**، وهو جوابُ T-133 عن «الحدُّ في وثيقةٍ لا في
 * شفرة»: كان مكتوبًا تعليقًا أنّ الحصر يقتصر على `*.yaml` مباشرةً في المجلد، فصار المدى
 * قيمةً تُقرأ ويُشتقّ منها السلوك.
 */
export const DECLARATION_REACH = Object.freeze({
  /** لواحقُ ملفات الإعلان المعدودة — `.yml` تُعدّ لأنّ المحمّلَ يقرؤها ولا يسأل عن الاسم */
  extensions: Object.freeze(['.yaml', '.yml'] as const),
  /** أقصى عمقِ مجلداتٍ يُمشى فيه تحت مجلد الإعلان — `deploy/staging/runbooks` عمقُه 1 */
  max_depth: 4,
});

/**
 * مجموعُ العُقد المعلنة في مستندٍ مُحلَّل: كلُّ مفتاحٍ في خريطةٍ وكلُّ عنصرٍ في قائمة.
 * ليس قياسًا لحجمِ الذاكرة بل لعددِ ما أُعلن — وهو أحدُ محورَي ميزانيّة T-130.
 * وموضعُه هذه الوحدةُ لا وحدةُ الحصر: يقرؤه المحمّلُ عند كلِّ قراءةٍ، ولو سكن وحدةَ الحصر
 * لدار الاستيرادُ (محمّلٌ ⇒ حصرٌ ⇒ محلّلٌ ⇒ محمّل).
 */
export function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    let n = value.length;
    for (const item of value) n += countNodes(item);
    return n;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>);
    let n = entries.length;
    for (const item of entries) n += countNodes(item);
    return n;
  }
  return 0;
}

/** أهذا ملفُّ إعلانٍ بمدًى معلن؟ — الجوابُ من الثابت لا من حرفٍ مكتوبٍ في موضعِ الفحص */
export function isDeclarationFile(name: string): boolean {
  return DECLARATION_REACH.extensions.some((ext) => name.endsWith(ext));
}

/**
 * كلُّ ملفات الإعلان تحت مجلدٍ — **بما في المجلدات الفرعيّة**، وهي فجوةُ T-133 الأولى:
 * كان الحصرُ يقتصر على المستوى الأوّل، فقيس أنّ **240032 بايتًا** من YAML في مجلدٍ فرعيٍّ
 * تمرُّ بسقفِ المجموع بلا أن يراها.
 * @param dir مجلدُ الإعلان
 * @param depth العمقُ الحاليُّ — لا يُمرَّر من خارج الوحدة إلّا في اختبارٍ يقصده
 * @param stamps دفترٌ يُملأ — إن مُرِّر — بزمنِ تعديلِ **كلِّ** مجلدٍ مُشِيَ فيه (T-140)
 */
export function walkDeclarationFiles(
  dir: string,
  depth = 0,
  stamps?: Map<string, bigint>,
): string[] {
  if (depth > DECLARATION_REACH.max_depth) {
    throw new SovereignViolation(
      `مجلدُ إعلانٍ أعمقُ من المدى المعلن: ${dir} — العمقُ ${depth}/${DECLARATION_REACH.max_depth}`,
      'CONFIG_DECLARATION_REACH_TOO_DEEP',
    );
  }
  const found: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  noteBootWork('dir_walks');
  noteBootWork('dir_entries', entries.length);
  if (stamps) stamps.set(dir, statSync(dir, { bigint: true }).mtimeNs);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkDeclarationFiles(path, depth + 1, stamps));
    else if (entry.isFile() && isDeclarationFile(entry.name)) found.push(path);
  }
  return found.sort();
}

/** قيدُ ملفٍّ مُحمَّلٍ في دفتر مجلدِه */
type LoadedFile = { readonly bytes: number; readonly nodes: number };

/** دفترُ ما حُمِّل فعلًا: مجلدٌ ⇒ (مسارٌ ⇒ حجمُه وعُقدُه) */
const LOADED = new Map<string, Map<string, LoadedFile>>();

/** مجموعُ ما حُمِّل من مجلدٍ حتى هذه اللحظة — يُقرأ في التقارير والدفتر، لا يُستنتج */
export function loadedDeclaration(dir: string): { files: number; bytes: number; nodes: number } {
  const ledger = LOADED.get(dir);
  if (!ledger) return { files: 0, bytes: 0, nodes: 0 };
  let bytes = 0;
  let nodes = 0;
  for (const entry of ledger.values()) {
    bytes += entry.bytes;
    nodes += entry.nodes;
  }
  return { files: ledger.size, bytes, nodes };
}

/**
 * يُنسى ما حُمِّل — للاختبارات والأدوات وحدَها: عمليّةٌ تقرأ مجلداتٍ مؤقّتةً بلا حدٍّ
 * تُراكم دفاترَ لا تُقرأ. ولا تُنادى في مسار الدولة: نسيانُ ما حُمِّل يُبطل الحرَس.
 * @param dir مجلدٌ بعينه، أو لا شيءَ فيُنسى الكلّ
 */
export function resetLoadedDeclaration(dir?: string): void {
  if (dir === undefined) LOADED.clear();
  else LOADED.delete(dir);
}

/**
 * يُقيِّد ملفًّا **قُرئ فعلًا** ثمّ يحرس مجموعَ مجلدِه — وهذا هو جوابُ T-133 الثاني:
 * سقفُ المجموع صار يقع في **موضع القراءة** فيمرّ به كلُّ نداءٍ، لا في الإقلاع وحدَه.
 * @param path مسارُ الملفِّ المقروء
 * @param bytes حجمُه بالبايت كما قيس قبل التحليل
 * @param nodes عُقدُه المعلنة كما حُسبت بعد التحليل
 */
export function noteLoadedDeclaration(path: string, bytes: number, nodes: number): void {
  const dir = dirname(path);
  const ledger = LOADED.get(dir) ?? new Map<string, LoadedFile>();
  ledger.set(path, { bytes, nodes });
  LOADED.set(dir, ledger);
  const total = loadedDeclaration(dir);
  if (total.bytes > CONFIG_DECLARATION_BUDGET.total_bytes) {
    throw new SovereignViolation(
      `مجموعُ ما حُمِّل من إعلانٍ فوق السقف المعلن — ${dir} بلغ: ${total.bytes}/`
      + `${CONFIG_DECLARATION_BUDGET.total_bytes} في ${total.files} ملفًا. `
      + 'سقفُ المجموع يقع حيث يُقرأ الإعلانُ لا في الإقلاع وحدَه (T-133)',
      'CONFIG_LOADED_BYTES_OVER_CEILING',
    );
  }
  if (total.nodes > CONFIG_DECLARATION_BUDGET.declared_nodes) {
    throw new SovereignViolation(
      `مجموعُ عُقدِ ما حُمِّل فوق السقف المعلن — ${dir} بلغ: ${total.nodes}/`
      + `${CONFIG_DECLARATION_BUDGET.declared_nodes} في ${total.files} ملفًا. `
      + 'سقفُ المجموع يقع حيث يُقرأ الإعلانُ لا في الإقلاع وحدَه (T-133)',
      'CONFIG_LOADED_NODES_OVER_CEILING',
    );
  }
}

/**
 * أبصماتُ المجلدات كما هي الآن كما هي في القياس المحفوظ؟ — زمنُ تعديلِ **كلِّ** مجلدٍ مُشِيَ
 * فيه يُقرأ من القرص (نداءٌ واحدٌ لكلِّ مجلدٍ، لا مشيٌ ولا قراءةُ نصّ). ومجلدٌ اختفى أو
 * تغيّر زمنُه ⇒ القياسُ لا يُعاد استخدامُه.
 */
function directoryStampsFresh(stamps: ReadonlyMap<string, bigint>): boolean {
  for (const [walked, stamp] of stamps) {
    let now: bigint;
    try {
      now = statSync(walked, { bigint: true }).mtimeNs;
    } catch {
      return false;
    }
    if (now !== stamp) return false;
  }
  return true;
}

/** سقفُ بايتات المجلد — يقع على القياس المحفوظ كما يقع على المقيسِ الآن (T-140) */
function guardDirectoryTotal(dir: string, bytes: number, files: number): number {
  if (bytes > CONFIG_DECLARATION_BUDGET.total_bytes) {
    throw new SovereignViolation(
      `مجموعُ بايتات مجلدِ الإعلان فوق السقف المعلن — ${dir} بلغ: ${bytes}/`
      + `${CONFIG_DECLARATION_BUDGET.total_bytes} في ${files} ملفًا. `
      + 'يقع هذا الحرَسُ عند كلِّ قراءةٍ لا في الإقلاع وحدَه (T-133)',
      'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING',
    );
  }
  return bytes;
}

/**
 * يحرس **مجموعَ بايتات مجلدِ الإعلان** عند كلِّ قراءةٍ منه — بمشيٍ وإحصاءِ أحجامٍ بلا تحليل.
 * وهو الجوابُ الأتمُّ عن شكوى T-133: من نادى محمّلًا مفردًا كان يقرأ من مجلدٍ مجموعُه فوق
 * السقفِ ولا يُردّ، فصار الإعلانُ الواحدُ **لا يُقبل في طريقٍ ويُرفض في طريق**.
 *
 * وجوابُ T-140: قيس أنّ هذا الحرَسَ كان يمشي المجلدَ **87 مرّةً في إقلاعٍ واحد** — 82 منها
 * بلا قراءةِ ملفٍّ واحدٍ بعد ذاكرةِ القراءة (T-139) — فصار القياسُ يُحفظ ببصمةٍ: زمنُ تعديلِ
 * كلِّ مجلدٍ مُشِيَ فيه، وأحجامُ كلِّ مساراته. **والسقفُ يقع في الحالتَين برمزِه نفسِه**:
 * الذاكرةُ توفّر مشيًا ولا توفّر حكمًا.
 * @param dir مجلدُ الملفِّ المقروء
 * @param observed الملفُّ الذي يُقرأ الآن وحجمُه — به تُكشف كتابةٌ فوق ملفٍّ قائمٍ لا
 *   يُحرِّك زمنَ المجلد، فيُنسى القياسُ ويُمشى المجلدُ من جديد
 * @returns مجموعُ البايتات المقيسُ — يُقرأ ولا يُستنتج
 */
export function guardDeclarationDirectoryBytes(
  dir: string,
  observed?: { readonly path: string; readonly bytes: number },
): number {
  if (observed) forgetDirectoryMeasureIfFileChanged(dir, observed.path, observed.bytes);
  const stored = storedDirectoryMeasure(dir);
  if (stored && directoryStampsFresh(stored.stamps)) {
    noteBootWork('dir_reuses');
    return guardDirectoryTotal(dir, stored.bytes, stored.files);
  }
  const stamps = new Map<string, bigint>();
  const paths = walkDeclarationFiles(dir, 0, stamps);
  const sizes = new Map<string, number>();
  let bytes = 0;
  for (const path of paths) {
    const size = statSync(path).size;
    sizes.set(path, size);
    bytes += size;
  }
  guardDirectoryTotal(dir, bytes, paths.length);
  memoizeDirectoryMeasure(dir, { bytes, files: paths.length, stamps, sizes });
  return bytes;
}

/**
 * **إعادةُ تحقّقٍ واحدةٌ من كلِّ مجلدٍ حُفظ قياسُه — في خاتمة الإقلاع قبلَ إعلانِ الدولة**
 * (البند T-141). وهي جوابُ الحدِّ الذي أعلنته T-140: نفخُ ملفٍّ **في مكانه لا يقرؤه أحدٌ في
 * هذا الإقلاع** لا يُحرّك زمنَ مجلدٍ ولا يراه قارئ، فكان يمرّ إلى ما بعد الإقلاع.
 *
 * ولم يُختر الجوابُ الأغلى: قيس أنّ إعادةَ إحصاءِ أحجامِ الملفات في **كلِّ** إعادةِ استخدامٍ
 * (81 مرّةً) تُعيد **3.17ms** إلى إقلاعٍ وسيطُه 7.62ms — أي **+42%** وإبطالُ أكثرِ ما كسبته
 * T-140 — فاختِيرت إعادةٌ **واحدةٌ** ثمنُها المقيسُ **0.138ms** (1.8%)، وثمنُها معدودٌ في
 * محور `dir_walks` لا مخفيًّا: من دفع عملًا عدَّه.
 *
 * وهي تُنسي القياسَ ثمّ تُنادي الحرَسَ نفسَه — فالسقفُ يقع برمزِه، ولا يُعاد حكمٌ من ذاكرة.
 * والقياسُ المحفوظُ يُحدَّث بما قيس الآن، فما قُرئ بعد الخاتمة يُقرأ على قياسٍ طازج.
 * @returns عددُ المجلدات المُعاد قياسُها وملفاتُها ومجموعُها — يُدوَّن في السجل (RULE-009)
 */
export function reverifyDeclarationDirectories(): {
  dirs: number; files: number; bytes: number;
} {
  const dirs = directoryMeasureNames();
  let bytes = 0;
  let files = 0;
  for (const dir of dirs) {
    resetDirectoryMeasures(dir);
    try {
      bytes += guardDeclarationDirectoryBytes(dir);
    } catch (error) {
      // سقفُ المجلد يمرّ برمزِه كما هو (RULE-007: لا يُبتلع ولا يُبدَّل رمزُه)
      if (error instanceof SovereignViolation) throw error;
      throw new SovereignViolation(
        `مجلدُ إعلانٍ قيس في هذا الإقلاع ثمّ لم يُقرأ في خاتمته — ${dir}: ${String(error)}. `
        + 'دولةٌ اتّكأت على قياسِ مجلدٍ صار لا يُقرأ لا تُعلن (T-141)',
        'CONFIG_DECLARATION_DIR_UNREADABLE_AT_BOOT_END',
      );
    }
    files += storedDirectoryMeasure(dir)?.files ?? 0;
  }
  return { dirs: dirs.length, files, bytes };
}
