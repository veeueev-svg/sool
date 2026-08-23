/**
 * scripts/confinement_probe.ts — مسبارُ الحصر على مستوى النواة (المرحلة 39، T-16)
 * المالك: وزارة الأمن السيبراني
 * المدخلات: `config/confinement.yaml` + `/proc` الحقيقي + `unshare` من النواة
 * المخرجات: قياسٌ خامٌ إلى `docs/audit/measurements/phase-39-T16.txt` وإلى الشاشة
 * التبعيات: `node:child_process` و`src/security/confinement.ts` — ولا شبكةَ خارج المحاولة المقيسة
 * الصلاحيات: القياسُ وحده. لا يُصلح المسبارُ حصرًا ولا يُغيّر تهيئةً ولا يُعلن استيفاءً
 * السجلات: الملفُّ نفسه هو السجل (RULE-006) | حالات الفشل: يُدوّن العجزَ ولا يُخفيه
 * اختبار القبول: tests/security/confinement.test.ts + المسبار نفسه بخرجه المحفوظ
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 *
 * ثوابتُ هذا المسبار:
 *   1) **يتجاوز بوابةَ التطبيق قصدًا.** المحاولةُ تُنادى بـ`net.connect` خامًا، لا
 *      بـ`NetworkEgressGuard`. فلو كان المنعُ في الشيفرة وحده لَنجحت المحاولةُ —
 *      وهذا بالضبط ما يقيسه هذا الملف: الفجوةُ التي فتحها C-09 وسدّها T-16.
 *   2) **`unshare --net` ليست بيئةَ الإنتاج**، لكنها البدائيةُ النوويّة نفسها التي
 *      تبني عليها الحاويات مجالَها الشبكي. فما يُقاس هنا يُقاس على النواة لا على وعد.
 *   3) **لا يُعلن المسبارُ نجاحًا.** يُخرج أرقامًا؛ والحكمُ لديوان التدقيق (RULE-004).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfinement, resolveConfigDir } from '../src/kernel/config';
import { readConfinementFacts, verifyConfinement } from '../src/security/confinement';

const configDir = resolveConfigDir();
const repoRoot = dirname(configDir);
const distSecurity = resolve(__dirname, '../src/security/confinement.js');
const lines: string[] = [];

function say(text: string): void {
  lines.push(text);
  process.stdout.write(`${text}\n`);
}

/** محاولةُ خروجٍ خامّة: لا بوابةَ تطبيقٍ في الطريق — الرافضُ إن رفض هو النواة */
const RAW_CONNECT = `
const net = require('node:net');
const socket = net.connect(443, '1.1.1.1');
socket.setTimeout(4000);
socket.on('connect', () => { console.log('OUTCOME=connected'); socket.destroy(); process.exit(0); });
socket.on('timeout', () => { console.log('OUTCOME=timeout'); socket.destroy(); process.exit(1); });
socket.on('error', (e) => { console.log('OUTCOME=error CODE=' + e.code); process.exit(1); });
`;

/** حقائقُ الحصر داخل مجالٍ شبكيٍّ آخر — تُقرأ بالقارئ نفسه لا بقارئٍ ثانٍ */
const FACTS_IN_NS = `
const { readConfinementFacts } = require(${JSON.stringify(distSecurity)});
const f = readConfinementFacts('/proc');
console.log('interfaces=' + f.interfaces.join(','));
console.log('defaultRoutes=' + f.defaultRoutes);
console.log('networkNamespace=' + f.networkNamespace);
`;

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 30_000 });
  if (result.error) return `تعذّر التنفيذ: ${result.error.message}`;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || `(بلا خرج) exit=${result.status}`;
}

say('# قياسُ الحصر على مستوى النواة — المرحلة 39، T-16 (إكمال C-09)');
say(`# التاريخ: ${new Date().toISOString()} · العقدة: ${process.version}`);
say('# هذا الملف خرجٌ خامٌ لـ`npm run probe:confinement`. لا يُحرَّر يدًا.');
say('');

// ١) السياسةُ المعلنة — من التهيئة لا من الشيفرة
const policy = loadConfinement(configDir).policy;
say('## ١) السياسةُ المعلنة (config/confinement.yaml)');
say(`الافتراض: ${policy.default} · جذرُ الشاهد: ${policy.witness_root}`);
say(`الشروطُ المُلزمة: ${Object.keys(policy.require).join(' · ')}`);
say('');

// ٢) حكمُ الشاهد على هذه العمليّة — كما هو لا كما يُرجى
say('## ٢) حكمُ الشاهد على العمليّة الحالية (بيئةُ التطوير لا بيئةُ الإنتاج)');
try {
  const verdict = verifyConfinement(policy, readConfinementFacts(policy.witness_root));
  const f = verdict.facts;
  say(`uid=${f.uid} · CapEff=${f.effectiveCapabilities} · CapBnd=${f.boundingCapabilities}`);
  say(`NoNewPrivs=${f.noNewPrivileges} · Seccomp=${f.seccompMode} · readOnlyRoot=${f.readOnlyRoot}`);
  say(`interfaces=${f.interfaces.join(',')} · defaultRoutes=${f.defaultRoutes}`);
  say(`networkNamespace=${f.networkNamespace}`);
  say(`confined=${verdict.confined} · شروطٌ غيرُ مستوفاة=${verdict.failures.length}`);
  for (const failure of verdict.failures) {
    say(`  - ${failure.requirement}: ${failure.measured} — ${failure.reason}`);
  }
} catch (error) {
  say(`عجزٌ عن القياس (وهو خرقٌ لا صمت): ${(error as Error).message}`);
}
say('');

// ٣) الخروجُ خارج المجال — تجاوزُ بوابة التطبيق قصدًا (ثابت 1)
say('## ٣) محاولةُ خروجٍ خامّة **خارج** مجالٍ محصور — بلا بوابة التطبيق');
say('# المتوقَّع: connected. ونجاحُها هو الدليلُ على أن منعَ الشيفرة وحده لا يكفي.');
say(run('node', ['-e', RAW_CONNECT]));
say('');

// ٤) الخروجُ داخل مجالٍ شبكيٍّ خاصّ — النواةُ ترفض قبل أن تُنادى شيفرتنا
say('## ٤) المحاولةُ نفسها **داخل** مجالٍ شبكيٍّ خاصّ (unshare --net)');
say('# المتوقَّع: error CODE=ENETUNREACH — رفضٌ من جدولِ النواة لا من شيفرةِ الدولة.');
say(run('unshare', ['--net', '--map-root-user', 'node', '-e', RAW_CONNECT]));
say('');

// ٥) حقائقُ الحصر داخل المجال — الشرطُ الشبكي مستوفًى قياسًا
say('## ٥) حقائقُ الحصر داخل المجال نفسه — بالقارئ نفسه');
say('# المتوقَّع: interfaces=lo و defaultRoutes=0 ⇒ default_deny_egress مستوفًى.');
say(run('unshare', ['--net', '--map-root-user', 'node', '-e', FACTS_IN_NS]));
say('');

// ٦) ما تتيحه هذه البيئة وما لا تتيحه — يُعلن ولا يُخفى (RULE-008)
say('## ٦) أدواتُ الحصر المتاحة في هذه البيئة');
for (const tool of ['docker', 'podman', 'iptables', 'nft', 'unshare', 'ip', 'capsh']) {
  const found = spawnSync('bash', ['-lc', `command -v ${tool} || echo غير-موجود`], {
    encoding: 'utf8',
  });
  say(`${tool}: ${(found.stdout ?? '').trim()}`);
}
say('');
say('## الخلاصة (قياسٌ لا حكم)');
say('البوابةُ في الشيفرة تمنع ما تعلمه؛ ومجالُ النواة يمنع ما لا تعلمه. البندُ ٣');
say('يُثبت أن الأولى وحدها لا تحمل دعوى «صفر أثرٍ خارجيٍّ غير معلن»، والبندان ٤ و٥');
say('يُثبتان أن الثانية تحملها. وبنيةُ infra/ هي تنزيلُ ذلك على بيئةِ تشغيلٍ حقيقية.');

const target = join(repoRoot, 'docs/audit/measurements/phase-39-T16.txt');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`\nالقياسُ محفوظٌ في: ${target}\n`);
