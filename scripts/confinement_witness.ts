/**
 * scripts/confinement_witness.ts — شاهدُ الحصر داخل الحاوية (T-16 · T-124)
 * المالك: وزارة الأمن السيبراني | المرحلة 39 (T-16) · المرحلة 40 (T-124 — شاهدٌ محصور)
 *
 * لماذا هذا الملف: وُجد `infra/docker/Dockerfile` يُنشئ الحصرَ، و`src/security/confinement.ts`
 * يشهد عليه من `/proc`. لكنّ الشاهد لم يُشغَّل قطّ **داخل** حاويةٍ فعليّة: قياسُ
 * `phase-39-T16.txt` من بيئةِ التطوير (confined=false — متوقَّع)، وقياسُ هذا الملف
 * من داخل الحاوية المحصورة (confined=true — المُستهدَف). الاثنانِ قياسانِ مختلفانِ
 * لفعلٍ مختلف: ذاك على العمليّةِ المُطلِقة، وهذا على العمليّةِ المُحصورةِ فعلًا.
 *
 * ثوابتُ هذا الشاهد:
 *   1) **لا يكتبُ ملفًّا.** يُخرجُ القياسَ إلى stdout وحده، فيعمل داخل حاويةٍ
 *      بجذرٍ للقراءة فقط بلا امتيازٍ للكتابة. ومن أراد حفظَ القياس فيُلتقطُه من خرجِ
 *      التشغيل (وهو ما تفعله وظيفةُ CI).
 *   2) **لا يُنشئُ الحصرَ ولا يُغيّرُه.** يقرأُ ما أَنشأهُ `Dockerfile` + وصفُ
 *      التشغيل، فيُقاسُ الحصرُ لا يُدَّعى. والإنشاءُ والشهادةُ فاعلانِ مختلفانِ (RULE-004).
 *   3) **لا يَسمحُ بنفسه.** يخرجُ برمزٍ 1 إن لم يكن محصورًا، فيسقطُ التشغيلُ
 *      لا يمرّ صامتًا. غيابُ الحصرِ ليس حالةً محايدةً بل خرقٌ (RULE-007).
 *
 * المدخلات: `config/confinement.yaml` + `/proc` للعمليّة الجارية.
 * المخرجات: قياسٌ نصّيٌّ على stdout · رمزُ الخروج 0 إن confined=true و1 إن false.
 * التبعيات: `src/security/confinement.ts` وحده — ولا شبكةَ ولا كتابةَ على القرص.
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 */
import { confinementWitness, readConfinementFacts } from '../src/security/confinement';
import { loadConfinement, resolveConfigDir } from '../src/kernel/config';
import { dirname } from 'node:path';

const configDir = resolveConfigDir();
const repoRoot = dirname(configDir);
const policy = loadConfinement(configDir).policy;

const out: string[] = [];
function say(text: string): void {
  out.push(text);
  process.stdout.write(`${text}\n`);
}

say('# شاهدُ الحصر داخل الحاوية — T-16 · T-124 (إكمالُ C-09)');
say(`# التاريخ: ${new Date().toISOString()} · العقدة: ${process.version}`);
say('# هذا الملف خرجٌ خامٌ لـ`node dist/scripts/confinement_witness.js` داخل الحاوية. لا يُحرَّر يدًا.');
say('');

// ١) السياسةُ المعلنة — المصدرُ الوحيد للحصر
say('## ١) السياسةُ المعلنة (config/confinement.yaml)');
say(`الافتراض: ${policy.default} · جذرُ الشاهد: ${policy.witness_root}`);
say(`الشروطُ المُلزمة: ${Object.keys(policy.require).join(' · ')}`);
say('');

// ٢) شهادةُ النواة — حقائقُ العمليّة الجارية من /proc لا من وعد
say('## ٢) شهادةُ النواة على هذه العمليّة (من /proc)');
const witness = confinementWitness(policy);
const verdict = witness.verify();
const f = verdict.facts;
say(`uid=${f.uid} · CapEff=${f.effectiveCapabilities} · CapBnd=${f.boundingCapabilities}`);
say(`NoNewPrivs=${f.noNewPrivileges} · Seccomp=${f.seccompMode} · readOnlyRoot=${f.readOnlyRoot}`);
say(`interfaces=${f.interfaces.join(',')} · defaultRoutes=${f.defaultRoutes}`);
say(`networkNamespace=${f.networkNamespace}`);
say(`confined=${verdict.confined} · شروطٌ غيرُ مستوفاة=${verdict.failures.length}`);
for (const failure of verdict.failures) {
  say(`  - ${failure.requirement}: ${failure.measured} — ${failure.reason}`);
}
say('');

// ٣) الحكمُ — لا نجاحٌ صامتٌ ولا فشلٌ مُخفًى
say('## ٣) حكمُ الشاهد');
if (verdict.confined) {
  say('✓ الحاويةُ محصورة: كلُّ الشروطِ المُعلنةِ مستوفاةٌ من `/proc` — الحصرُ على');
  say('  مستوى النواةِ والحاويةِ قائمٌ لا تطبيقيٌّ وحده. فجوةُ C-09 (T-16) مُسدَّةٌ قياسًا.');
} else {
  say('✗ الحاويةُ غيرُ محصورة: شرطٌ مُعلَنٌ غيرُ مستوفًى من `/proc`. وغيابُ الحصرِ خرقٌ');
  say('  لا حالةٌ محايدة (RULE-007) — والمنعُ التطبيقيُّ وحده لا يحملُ دعوى «صفرُ أثرٍ».');
  say('  ملاحظةٌ: إن كان هذا التشغيلُ في بيئةِ التطوير لا الحاوية، فالحصرُ المتوقَّعُ false.');
}

void repoRoot;
process.exit(verdict.confined ? 0 : 1);
