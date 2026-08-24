/**
 * scripts/closed_enum_probe.ts — مسبارُ التعدادات المغلقة (المرحلة 39، البند T-131)
 * المالك: القيّم على المستودع | المدخلات: `config/` تُنسخ إلى tmpdir · وسيطٌ: مسارُ حفظِ الخرج
 * المخرجات: جدولٌ مقيسٌ لكلِّ قائمةٍ محدودةٍ بتعدادٍ مغلق — نصٌّ إلى الشاشة وإلى ملفٍ إن طُلب
 * التبعيات: scripts/closed_enum_cases.ts · scripts/declaration_cases.ts | لا يكتب في اليوميّة
 * الصلاحيات: قراءةُ `config/` وكتابةٌ في tmpdir وفي مسار الخرج وحدهما — لا يُلمس المستودع
 * حالات الفشل: مفتاحٌ غيرُ موجودٍ ⇒ استثناءٌ صريح · تعدادٌ فارغٌ ⇒ يُعلن في الجدول لا يُبتلع
 * اختبارات الوحدة: tests/kernel/closed_enum_bounds.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0035-closed-enum-bounds.md
 * ثوابت هذه الوحدة:
 *   1) **ثلاثةُ أسئلةٍ لا سؤال**: هل تُرفض قيمةٌ **خارج** التعداد (أي العضويّةُ مُنفَذة)؟
 *      وهل تُرفض قيمةٌ **داخلَه مكرّرةٌ ألفَ مرّة** (أي الطولُ محدود)؟ وهل التعدادُ
 *      **مجمَّدٌ في التشغيل** (أي مغلقٌ فعلًا لا في الأنواع وحدها)؟ فمن سأل الأوّلَ وحده
 *      قرأ «مغلقٌ» عن قائمةٍ لا حدَّ لطولها.
 *   2) **النفخُ بقيمةٍ معلومةٍ مقروءةٍ من التعداد** لا بقيمةٍ مكتوبةٍ حرفًا: فلو غُيّر التعدادُ
 *      غدًا نُفخ بأوّلِ عضوٍ فيه ولم يُقرأ الرفضُ عضويّةً وهو تكرار.
 *   3) **الرقمُ 1024 هو نفسُه المُستعمَل في T-129** ليكون القياسان مقارنَين لا متقاربَين.
 *   4) **لا حكمَ في المسبار**: يطبع ما قِيس ويترك الحكمَ للتقرير والاختبار. ومن أراد رقمًا
 *      خضراءَ فليقرأ البوابةَ لا هذا الملف.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOSED_CASES, alien } from './closed_enum_cases';
import { inflate, refusal, repoRoot } from './declaration_cases';

const BULK = 1024;

/**
 * أوّلُ قيمةٍ **معلنةٍ اليومَ** تحت مفتاحٍ في ملفِّ تهيئة — تُقرأ من الملف لا تُكتب حرفًا.
 * ولِمَ لا يُؤخذ أوّلُ عضوٍ في التعداد؟ لأنّ عضوًا معلومًا غيرَ معلنٍ هنا قد يُرفض
 * **بتناقضٍ آخرَ** (حرجٌ يُضاف إلى العالي مثلًا) فيُقرأ رفضُ التناقض حدًّا للطول وليس به.
 * @returns القيمةُ كما هي في الملف، أو `undefined` إن لم يوجد المفتاح أو كان فارغًا
 */
function firstDeclared(path: string, key: string): string | undefined {
  const lines = readFileSync(path, 'utf8').split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  if (at === -1) return undefined;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = (lines[i] as string).trim();
    if (line === '' || line.startsWith('#')) continue;
    if (!line.startsWith('- ')) return undefined;
    return line.slice(2).trim().replace(/^"(.*)"$/, '$1');
  }
  return undefined;
}

/** يُشغّل التحميلَ ويصف نتيجتَه: رمزُ رفضٍ إن رُفض، وإلّا «قُبل بلا حدّ» */
function verdict(run: () => unknown): string {
  try {
    run();
    return 'قُبل بلا حدّ';
  } catch (error) {
    return refusal(error);
  }
}

type Row = {
  readonly enumName: string;
  readonly where: string;
  readonly size: number;
  readonly frozen: boolean;
  readonly alienVerdict: string;
  readonly repeatVerdict: string;
};

function copyConfig(from: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'closed-enum-'));
  cpSync(from, dir, { recursive: true });
  return dir;
}

function main(): void {
  const root = repoRoot();
  const source = join(root, 'config');
  const rows: Row[] = [];

  for (const c of CLOSED_CASES) {
    const known = firstDeclared(join(source, c.file), c.key);
    if (known === undefined) {
      rows.push({
        enumName: c.enumName, where: `${c.file} · ${c.key}`, size: 0, frozen: Object.isFrozen(c.values),
        alienVerdict: 'لا عنصرَ معلنًا — لا قياس', repeatVerdict: 'لا عنصرَ معلنًا — لا قياس',
      });
      continue;
    }

    // (أ) قيمةٌ خارج التعداد: العضويّةُ مُنفَذةٌ أم لا
    const alienDir = copyConfig(source);
    inflate(join(alienDir, c.file), c.key, () => c.entry(alien(c.values)), {} as never, 1);
    const alienVerdict = verdict(() => c.load(alienDir));
    rmSync(alienDir, { recursive: true, force: true });

    // (ب) **العنصرُ المعلنُ نفسُه** مكرَّرًا ألفًا: الطولُ محدودٌ أم لا
    const repeatDir = copyConfig(source);
    inflate(join(repeatDir, c.file), c.key, () => c.entry(known), {} as never, BULK);
    const repeatVerdict = verdict(() => c.load(repeatDir));
    rmSync(repeatDir, { recursive: true, force: true });

    rows.push({
      enumName: c.enumName,
      where: `${c.file} · ${c.key}`,
      size: c.values.length,
      frozen: Object.isFrozen(c.values),
      alienVerdict,
      repeatVerdict,
    });
  }

  const out: string[] = [];
  out.push(`# مسبارُ التعدادات المغلقة — البند T-131 (${new Date().toISOString()})`);
  out.push(`# الأمر: npm run probe:closed-enums · التكرار: ${BULK} نسخةً من أوّلِ عنصرٍ معلنٍ فعلًا`);
  out.push('');
  out.push('## الجدول: ثلاثةُ أسئلةٍ لكلِّ قائمةٍ محدودةٍ بتعدادٍ مغلق');
  out.push('');
  out.push('| التعداد | الموضع | حجمُه | مجمَّد؟ | قيمةٌ خارجه | عنصرٌ معلنٌ مكرَّرٌ ×1024 |');
  out.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    out.push(`| ${r.enumName} | ${r.where} | ${r.size} | ${r.frozen ? 'نعم' : '**لا**'} `
      + `| ${r.alienVerdict} | ${r.repeatVerdict} |`);
  }
  out.push('');
  const membership = rows.filter((r) => r.alienVerdict !== 'قُبل بلا حدّ').length;
  const bounded = rows.filter((r) => r.repeatVerdict !== 'قُبل بلا حدّ').length;
  const frozen = rows.filter((r) => r.frozen).length;
  out.push(`المفاتيحُ المقيسة: ${rows.length}`);
  out.push(`العضويّةُ مُنفَذةٌ (قيمةٌ خارج التعداد تُرفض): ${membership} من ${rows.length}`);
  out.push(`الطولُ محدودٌ (عنصرٌ معلنٌ مكرَّرٌ ألفًا يُرفض): **${bounded} من ${rows.length}**`);
  out.push(`التعدادُ مجمَّدٌ في التشغيل: **${frozen} من ${rows.length}**`);
  out.push('');
  out.push('**قياسُ منفّذٍ حتى يعيده المدقّق.**');

  const text = out.join('\n');
  console.log(text);
  const target = process.argv[2];
  if (target !== undefined && target.trim() !== '') {
    writeFileSync(target, `${text}\n`, 'utf8');
    console.log(`\nحُفظ في: ${target}`);
  }
}

main();
