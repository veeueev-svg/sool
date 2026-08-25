/**
 * scripts/boot_work_meter.ts — مقياسُ عملِ الإقلاع وحرَسُه في البوابة (المرحلة 39، البند T-134)
 * المالك: القيّم على المستودع | المدخلات: تهيئةُ المستودع الفعليّة (`resolveConfigDir`)
 * المخرجات: جدولُ محاورِ العمل مقابلَ سقوفها · تاريخُ الزمن · رمزُ خروجٍ 1 عند التجاوز
 * التبعيات: src/index (`bootstrapState`) · src/kernel/config (`bootWork` · السقوف)
 * الصلاحيات (RULE-004): يقيس ويحكم بالسقفِ المعلن، ولا يُعدّل سقفًا ولا شفرةً
 * السجلات: خرجٌ نصّيٌّ في البوابة · وقيدُ `boot_work_measured` يكتبه الإقلاعُ نفسُه
 * حالات الفشل: محورٌ فوق سقفه ⇒ رمز 1 · تعذُّرُ الإقلاع ⇒ رمز 1
 * الوثيقة: docs/decisions/ADR-0037-boot-work-ceilings.md
 *   · القياسُ الخام: docs/audit/measurements/phase-39-T134.txt
 *
 * ثوابت هذا المقياس:
 *
 *   1) **يُنادى في البوابة لا بيد**: نصُّ T-134 يطلب «عتبةً معلنةً في مسارٍ مُقاسٍ لا في
 *      مسبارٍ يُنادى بيدٍ» — فهذا الملفُّ يُشغَّل من `npm run verify` عبر
 *      `scripts/check_boot_work.sh`، ورمزُ خروجه يُسقط الدفعةَ.
 *
 *   2) **يُطبع الجدولُ كلُّه لا أوّلُ مخالفةٍ**: من رأى محورًا واحدًا لم يعرف أين ذهب العمل،
 *      فتُطبع المحاورُ الستّةُ بأعدادها ونسبتها من سقفها ثمّ يُحكم.
 *
 *   3) **الزمنُ يُطبع تاريخًا لا عقدًا**: يُقاس وسيطُ سبعةِ إقلاعاتٍ ووحدةُ معايرةٍ في
 *      العمليّة نفسِها، ويُطبع النسبةُ بينهما — **ولا يُسقط رمزَ الخروج**. لأنّ زمنَ الجدار
 *      يختلف بآلةٍ وحمولةٍ، فحاجزٌ عليه يسقط بريئًا أو يمرّ مذنبًا. والانحدارُ يُحرس بعدِّ
 *      العمل في الأعلى، وهذا هو الشرطُ الثاني الذي أذن به البند صريحًا.
 */
import { bootstrapState } from '../src/index';
import {
  BOOT_WORK_CEILINGS, BootWork, bootWork, censusDeclaration, loadedDeclaration, resolveConfigDir,
} from '../src/kernel/config';

const configDir = resolveConfigDir();
const out: string[] = [];
const say = (line: string): void => {
  out.push(line);
  process.stdout.write(`${line}\n`);
};

/** وحدةُ معايرةٍ: عملٌ حسابيٌّ ثابتٌ لا يلمس القرص — تُقاس بها الآلةُ لا الشفرة */
function calibrationMs(): number {
  const started = process.hrtime.bigint();
  let acc = 0;
  for (let i = 1; i <= 4_000_000; i += 1) acc += (i % 7) * (i % 13);
  if (acc < 0) throw new Error('غيرُ ممكن — يمنع تحسينًا يحذف الحلقة');
  return Number(process.hrtime.bigint() - started) / 1e6;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// 1) إقلاعٌ واحدٌ يُقاس عملُه — العدّادُ يُصفَّر في أوّلِ التركيب فالحصيلةُ حصيلةُ إقلاعٍ واحد
bootstrapState({ configDir, now: 1 });
const work = bootWork();
const axes = Object.keys(BOOT_WORK_CEILINGS) as (keyof BootWork)[];

say('## عملُ الإقلاع مقابلَ سقوفه المعلنة');
say('');
say('| المحور | المقيس | السقف | النسبة |');
say('|---|---|---|---|');
const over: string[] = [];
for (const axis of axes) {
  const measured = work[axis];
  const ceiling = BOOT_WORK_CEILINGS[axis];
  const pct = ((measured / ceiling) * 100).toFixed(1);
  say(`| \`${axis}\` | ${measured} | ${ceiling} | ${pct}% |`);
  if (measured > ceiling) over.push(`${axis}: ${measured}/${ceiling}`);
}
say('');

// 2) تكرارُ القراءة — عددٌ يُقرأ ولا يُحرس اليومَ (T-139)
const census = censusDeclaration(configDir);
const distinct = loadedDeclaration(configDir).files;
const loaderReads = work.file_reads - census.files;
say(`- الحصرُ قرأ ${census.files} ملفًا مرّةً واحدةً، والمحمّلاتُ قرأت ${loaderReads} قراءةً `
  + `وفي دفتر مجلدِ التهيئة **${distinct}** ملفًا مميّزًا فقط — فالملفُّ الواحدُ يُقرأ من القرص `
  + 'مرّاتٍ (وأكثرُها `config/quotas.yaml`: ستٌّ وعشرون قراءةً في إقلاعٍ واحد، مقيسةً في '
  + 'docs/audit/measurements/phase-39-T134.txt). عددٌ يُقاس ولا يُحرس اليومَ: البندُ T-139');

// 3) الزمنُ تاريخًا لا عقدًا
const calib = median([calibrationMs(), calibrationMs(), calibrationMs()]);
const boots: number[] = [];
for (let i = 0; i < 7; i += 1) {
  const started = process.hrtime.bigint();
  bootstrapState({ configDir, now: 1 });
  boots.push(Number(process.hrtime.bigint() - started) / 1e6);
}
const bootMs = median(boots);
say(`- الزمنُ (تاريخٌ لا عقد): وسيطُ الإقلاع **${bootMs.toFixed(2)}ms** · المدى `
  + `${Math.min(...boots).toFixed(2)}–${Math.max(...boots).toFixed(2)}ms · وحدةُ المعايرة `
  + `${calib.toFixed(2)}ms · النسبةُ **${(bootMs / calib).toFixed(3)}** وحدةَ معايرة`);
say('- وهذا السطرُ **لا يُسقط رمزَ الخروج**: زمنُ الجدار يختلف بآلةٍ وحمولةٍ، والانحدارُ '
  + 'يُحرس بعدِّ العمل أعلاه (T-134، الشرطُ الثاني في نصّ البند)');
say('');

if (process.argv[2]) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { writeFileSync } = require('node:fs') as typeof import('node:fs');
  writeFileSync(process.argv[2], `${out.join('\n')}\n`, 'utf8');
}

if (over.length > 0) {
  say(`✗ عملُ الإقلاع فوق سقفه المعلن: ${over.join(' · ')}`);
  say('  فمن زاد العملَ فليُعلن ما تغيّر في PROGRESS.md، ولا يُوسَّع سقفٌ لتمرَّ دفعة.');
  process.exit(1);
}
say('✓ عملُ الإقلاع تحت سقوفه المعلنة — والزمنُ يُقرأ تاريخًا لا عقدًا (T-134)');
