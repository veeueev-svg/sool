/**
 * scripts/declaration_scope_probe.ts — مسبارُ سقوفِ العدد المعلن في محمّلات النواة (المرحلة 39، البند T-129)
 * المالك: القيّم على المستودع | المدخلات: مجلدُ تهيئةٍ منسوخٌ في tmpdir (لا يُلمس المستودع)
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًا في docs/audit/measurements/phase-39-T129.txt
 * التبعيات: src/kernel/config/* | الصلاحيات: قراءةُ `config/` وكتابةٌ في tmpdir وحده
 * السجلات: لا يكتب في اليوميّة — القياسُ لا يُلوّث الدفتر
 * حالات الفشل: أيُّ خطأٍ غيرِ سياديّ يخرج بشفرة 1 — ولا يُبتلع خطأ (RULE-007)
 * اختبارات الوحدة: tests/kernel/declaration_ceilings.test.ts · tests/kernel/declaration_ceilings_rest.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0033-declared-count-ceilings.md
 * ثوابت هذا الملف:
 *   1) **الدعوى تُقاس لا تُصدَّق**: دعوى T-129 أنّ في المحمّلات مواضعَ ترفض القائمةَ الفارغة
 *      ولا موضعَ يرفض اللانهائية. فتُعَدُّ المواضعُ من الشفرة نفسها بمسحٍ نصّيّ، ويُطبع العددُ
 *      كما قيس — لا كما رُوي في تقريرٍ سابق.
 *   2) **الفجوةُ تُبرهن بحمولةٍ لا بوصف**: كلُّ قائمةٍ مفتوحةِ العدد تُنفخ إلى {@link INFLATE_TO}
 *      عنصرًا صحيحَ البنية في نسخةٍ من التهيئة، ثم يُنادى محمّلُها. فإن قُبلت فالبابُ مفتوح،
 *      وإن رُفضت طُبع رمزُ الرفض. والنتيجةُ نفسُها تُقاس قبل الإصلاح وبعده بالأمر ذاته.
 *   3) **المقيَّدُ بمجموعةٍ مغلقةٍ يُعلن لا يُسقَف**: قائمةٌ كلُّ عنصرٍ فيها يُقابل تعدادًا
 *      مغلقًا في النواة (كالقطوع والماسحات وكتبِ التشغيل) محدودةٌ بحجم التعداد أصلًا،
 *      فسقفُها ثابتٌ نائمٌ لا يقع. تُطبع في جدولٍ منفصلٍ بسببِ استثنائها معلنًا.
 *   4) **الكلفةُ تُطبع كما قيست**: حجمُ الملف قبل النفخ وبعده وزمنُ التحميل — فمن يقول
 *      «لا حدَّ يضرّ» يقرأ ما يضرّ رقمًا.
 *   5) **الجدولُ لا يُنسخ**: جدولُ الحالات ودالّةُ النفخ خرجا إلى `scripts/declaration_cases.ts`
 *      في البند T-130 حين احتاجهما مسبارُ الكلفة. لا حالةَ أُضيفت ولا حُذفت في النقل،
 *      والنتيجةُ نفسُها تُعاد بالأمر نفسه — وجدولان متطابقان يفترقان لا يُكشف فرقُهما.
 */
import {
  cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfigDir } from '../src/kernel/config/paths';
import {
  CLOSED_ENUM_CASES, OPEN_CASES, inflate, readCtx, refusal, repoRoot,
} from './declaration_cases';

/** عددُ العناصر المنفوخة: أكبرُ بمراتبَ من كلِّ سقفٍ معلن، فالمرورُ به مرورٌ بلا حدّ */
const INFLATE_TO = 1024;

const out: string[] = [];
function say(line: string): void {
  out.push(line);
  process.stdout.write(`${line}\n`);
}

/** مسحُ الشفرة: يُعَدُّ ما يرفض الفراغَ وما يحرس العددَ — عدٌّ لا رواية */
function census(srcDir: string): void {
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts')).sort();
  let emptyGuards = 0;
  let ceilingGuards = 0;
  let loadersWithEmpty = 0;
  say('| المحمّل | يرفض الفراغ | يحرس العدد |');
  say('|---|---|---|');
  for (const file of files) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    const empty = (text.match(/length === 0|length < 1/g) ?? []).length;
    const ceiling = (text.match(/guardDeclaredCount\(/g) ?? []).length;
    emptyGuards += empty;
    ceilingGuards += ceiling;
    if (empty > 0) loadersWithEmpty += 1;
    if (empty > 0 || ceiling > 0) say(`| ${file} | ${empty} | ${ceiling} |`);
  }
  say('');
  say(`المحمّلات: ${files.length} · مواضعُ رفضِ الفراغ: ${emptyGuards}`
    + ` في ${loadersWithEmpty} محمّلًا · مواضعُ حرسِ العدد: ${ceilingGuards}`);
}

function main(): void {
  const configDir = resolveConfigDir();
  const ctx = readCtx(configDir);

  say(`# مسبارُ سقوفِ العدد المعلن — البند T-129 (${new Date().toISOString()})`);
  say(`# الأمر: npm run probe:declaration-scope · النفخ: ${INFLATE_TO} عنصرًا لكل قائمة`);
  say('');
  say('## أوّلًا: مسحُ الشفرة — ما يرفض الفراغَ مقابلَ ما يحرس العدد');
  say('');
  census(join(repoRoot(), 'src', 'kernel', 'config'));
  say('');
  say('## ثانيًا: القوائمُ مفتوحةُ العدد — نفخٌ ثم تحميل');
  say('');
  say('| السقف | الملف | المفتاح | الحجم قبل | الحجم بعد | النتيجة | زمن التحميل |');
  say('|---|---|---|---|---|---|---|');
  let accepted = 0;
  let refused = 0;
  for (const item of OPEN_CASES) {
    const dir = mkdtempSync(join(tmpdir(), 'sool-decl-'));
    try {
      cpSync(configDir, join(dir, 'config'), { recursive: true });
      const path = join(dir, 'config', item.file);
      const before = statSync(path).size;
      inflate(path, item.key, item.entry, ctx, INFLATE_TO);
      const after = statSync(path).size;
      const t0 = Date.now();
      let result: string;
      try {
        item.load(join(dir, 'config'));
        result = '**قُبل بلا حدّ**';
        accepted += 1;
      } catch (error) {
        result = refusal(error);
        refused += 1;
      }
      const ms = Date.now() - t0;
      say(`| ${item.ceiling} | ${item.file} | ${item.key} | ${before}B | ${after}B`
        + ` | ${result} | ${ms}ms |`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  say('');
  say(`القوائمُ مفتوحةُ العدد: ${OPEN_CASES.length} · قُبلت بلا حدّ: ${accepted}`
    + ` · رُفضت: ${refused}`);
  say('');
  say('## ثالثًا: القوائمُ المقيَّدةُ بتعدادٍ مغلق — تُعلن ولا تُسقَف');
  say('');
  say('| الملف | القائمة | ما يحدّها اليوم |');
  say('|---|---|---|');
  for (const [file, key, bound] of CLOSED_ENUM_CASES) say(`| ${file} | ${key} | ${bound} |`);
  say('');
  say(`المقيَّدةُ بتعدادٍ مغلق: ${CLOSED_ENUM_CASES.length} — سقفُها ثابتٌ نائمٌ لا يقع،`
    + ' فاستُثنيت معلنةً لا مسكوتًا عنها.');
  say('');
  say('**قياسُ منفّذٍ حتى يعيده المدقّق.**');

  const target = process.argv[2];
  if (target) writeFileSync(target, `${out.join('\n')}\n`, 'utf8');
}

main();
