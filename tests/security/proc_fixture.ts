/**
 * tests/security/proc_fixture.ts — جذرُ شاهدٍ مُصطنع لقياس الحصر (المرحلة 39، T-16)
 * المالك: ديوان التدقيق
 * المدخلات: تفاصيلُ حقائقٍ يريدها المختبِر | المخرجات: مجلدٌ يشبه `/proc` بنيةً ونصًّا
 * التبعيات: `node:fs` و`node:os` فقط
 * الصلاحيات: الكتابةُ في مجلدٍ مؤقّت وحده — لا يلمس `/proc` الحقيقي ولا يزعم تغييره
 * السجلات: لا شيء | حالات الفشل: يرمي إن تعذّرت الكتابة، فلا اختبارَ على جذرٍ ناقص
 * اختبار القبول: tests/security/confinement.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 * ثوابت هذا المهاد:
 *   1) **الجذرُ المُصطنع لا يُثبت حصرًا**: يُثبت أن القارئ يقرأ ما يُكتب له. الحصرُ
 *      الحقيقي يُقاس بمسبار `scripts/confinement_probe.ts` على النواة نفسها.
 *   2) **النصُّ بصيغة النواة حرفًا**: أعمدةُ `net/route` وحقولُ `self/mountinfo`
 *      بترتيبها المعلن، فلو غيّر القارئُ تفسيرَه سقط الاختبار لا مرّ.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeFacts {
  readonly uid: number;
  readonly capEff: string;
  readonly capBnd: string;
  readonly noNewPrivs: 0 | 1;
  readonly seccomp: 0 | 1 | 2;
  /** واجهاتٌ غير الحلقة المحلية — المجالُ الفارغ لا شيء فيه غير `lo` */
  readonly interfaces: readonly string[];
  /** مسارٌ افتراضي على واجهةٍ غير `lo` — وجودُه معناه بوابةُ خروج */
  readonly defaultRoute: boolean;
  readonly readOnlyRoot: boolean;
}

/** عمليّةٌ محصورةٌ بكل الشروط السبعة — أضيقُ ما يقبله `verifyConfinement` */
export const CONFINED: FakeFacts = {
  uid: 10001,
  capEff: '0000000000000000',
  capBnd: '0000000000000000',
  noNewPrivs: 1,
  seccomp: 2,
  interfaces: [],
  defaultRoute: false,
  readOnlyRoot: true,
};

/** عمليّةٌ كبيئة هذا المستودع: لا جذر ولا قدرات، وكلُّ ما بعدهما مفتوح */
export const UNCONFINED: FakeFacts = {
  uid: 2000,
  capEff: '0000000000000000',
  capBnd: '000001ffffffffff',
  noNewPrivs: 0,
  seccomp: 0,
  interfaces: ['eth0'],
  defaultRoute: true,
  readOnlyRoot: false,
};

function statusText(f: FakeFacts): string {
  return [
    'Name:\tnode',
    `Uid:\t${f.uid}\t${f.uid}\t${f.uid}\t${f.uid}`,
    `Gid:\t${f.uid}\t${f.uid}\t${f.uid}\t${f.uid}`,
    'CapInh:\t0000000000000000',
    `CapPrm:\t${f.capEff}`,
    `CapEff:\t${f.capEff}`,
    `CapBnd:\t${f.capBnd}`,
    'CapAmb:\t0000000000000000',
    `NoNewPrivs:\t${f.noNewPrivs}`,
    `Seccomp:\t${f.seccomp}`,
    '',
  ].join('\n');
}

function devText(f: FakeFacts): string {
  const header = 'Inter-|   Receive\n face |bytes    packets\n';
  const rows = ['lo', ...f.interfaces]
    .map((name) => `${name.padStart(6)}: 0 0 0 0 0 0 0 0`)
    .join('\n');
  return `${header}${rows}\n`;
}

function routeText(f: FakeFacts): string {
  const header = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask';
  const rows: string[] = [];
  if (f.defaultRoute) {
    const iface = f.interfaces[0] ?? 'eth0';
    rows.push(`${iface}\t00000000\t0100FEA9\t0003\t0\t0\t0\t00000000`);
    rows.push(`${iface}\t0000FEA9\t00000000\t0001\t0\t0\t0\t0000FFFF`);
  }
  return `${header}\n${rows.join('\n')}\n`;
}

function mountinfoText(f: FakeFacts): string {
  const options = f.readOnlyRoot ? 'ro,relatime' : 'rw,relatime';
  return [
    `1 1 0:1 / / ${options} shared:1 - overlay overlay ${options}`,
    '2 1 0:2 / /tmp rw,nosuid - tmpfs tmpfs rw',
    '',
  ].join('\n');
}

/** يكتب جذرًا مُصطنعًا ويعيد مساره — على المُنادي حذفُه بـ`rmSync` */
export function writeFakeProc(facts: FakeFacts): string {
  const root = mkdtempSync(join(tmpdir(), 'sool-proc-'));
  mkdirSync(join(root, 'self/ns'), { recursive: true });
  mkdirSync(join(root, 'net'), { recursive: true });
  writeFileSync(join(root, 'self/status'), statusText(facts), 'utf8');
  writeFileSync(join(root, 'self/mountinfo'), mountinfoText(facts), 'utf8');
  writeFileSync(join(root, 'net/dev'), devText(facts), 'utf8');
  writeFileSync(join(root, 'net/route'), routeText(facts), 'utf8');
  // في `/proc` الحقيقي رابطٌ رمزي؛ وهنا ملفٌّ عادي يقرأه القارئُ بالبديل المعلن
  writeFileSync(join(root, 'self/ns/net'), 'net:[4026999999]', 'utf8');
  return root;
}
