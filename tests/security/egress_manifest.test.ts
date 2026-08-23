/**
 * tests/security/egress_manifest.test.ts — قياسُ مولّد بُنى المنع الشبكي (المرحلة 39، T-16)
 * المالك: ديوان التدقيق
 * المدخلات: `config/external.yaml` + `config/confinement.yaml` + الملفات المولَّدة على القرص
 * المخرجات: تطابقٌ بايتًا بايت وحكمٌ على النظير غير المعلن
 * التبعيات: renderEgressManifests + declaredEgressTargets + loadExternal + loadConfinement
 * الصلاحيات: القياسُ وحده — لا يكتب هذا الملف بنيةً ولا يُصلح انحرافًا
 * السجلات: لا شيء | حالات الفشل: تُقرأ برمزها
 * اختبار القبول: هذا الملف + `npm run check:confinement` في بوابات الدفع
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 * ثوابتُ هذا الملف:
 *   1) **المولّدُ دالّةٌ خالصة**: النداءُ مرتين على المدخل نفسه يعطي البايتاتِ نفسها،
 *      وإلّا لَصار الحاجزُ يرفض انحرافًا لم يقع.
 *   2) **البنيةُ على القرص هي البنيةُ المولَّدة**: تحريرٌ يدويٌّ يُكتشف بايتًا لا نيّةً.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  renderEgressManifests, declaredEgressTargets, loadConfinement,
} from '../../src/index';
import { loadExternal } from '../../src/kernel/config/external';

const CONFIG = resolve(__dirname, '../../../config');
const ROOT = resolve(__dirname, '../../..');
const external = loadExternal(CONFIG);
const confinement = loadConfinement(CONFIG).policy;

test('الوجهاتُ المعلنة تُقرأ من `config/external.yaml` وحدها ومرتبةً', () => {
  const targets = declaredEgressTargets(external);
  assert.ok(targets.length >= 1);
  for (const target of targets) assert.match(target, /^[a-z0-9.-]+:\d+$/);
  // الترتيبُ بالمُعرّف لا بترتيب الملف، لتبقى البايتاتُ واحدةً مع تغير الترتيب
  const sortedById = [...external.counterparties]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => `${c.host.toLowerCase()}:${c.port}`);
  assert.deepEqual([...targets], sortedById);
});

test('المولّدُ خالص: نداءان على المدخل نفسه يعطيان البايتاتِ نفسها', () => {
  const first = renderEgressManifests(external, confinement);
  const second = renderEgressManifests(external, confinement);
  assert.equal(first.defaultDeny, second.defaultDeny);
  assert.equal(first.allowlist, second.allowlist);
  assert.equal(first.runtime, second.runtime);
});

test('المنعُ الافتراضي منعٌ كامل: `egress: []` لا قاعدةَ سماحٍ واحدة فيه', () => {
  const { defaultDeny } = renderEgressManifests(external, confinement);
  assert.match(defaultDeny, /kind:\s*NetworkPolicy/);
  assert.match(defaultDeny, /egress:\s*\[\]/);
  assert.ok(!defaultDeny.includes('toFQDNs'), 'المنعُ الافتراضي لا يسمح بشيء');
});

test('لكل نظيرٍ معلن قاعدةٌ باسمه ومنفذه — ولا قاعدةَ لغير معلن', () => {
  const { allowlist } = renderEgressManifests(external, confinement);
  const targets = declaredEgressTargets(external);
  for (const target of targets) {
    const [host, port] = target.split(':') as [string, string];
    assert.ok(allowlist.includes(host), `المضيفُ المعلن غائبٌ عن القاعدة: ${host}`);
    assert.ok(allowlist.includes(`- port: "${port}"`), `المنفذُ غائب: ${port}`);
  }
  const hosts = allowlist.match(/matchName:\s*"([^"]+)"/g) ?? [];
  assert.equal(hosts.length, targets.length, 'قاعدةٌ لمضيفٍ لا يقابله نظيرٌ معلن');
});

test('الحاويةُ لا تُمنح قدرةً ولا جذرًا: الجذرُ للقراءة والشبكةُ داخلية', () => {
  const { runtime } = renderEgressManifests(external, confinement);
  assert.match(runtime, /read_only:\s*true/);
  assert.match(runtime, /cap_drop:/);
  assert.match(runtime, /no-new-privileges:true/);
  assert.match(runtime, /internal:\s*true/);
  // التعليقاتُ تُستبعد: الملفُ يشرح الممنوع باسمه قصدًا، والمقيسُ ما يُنفّذ لا ما يُشرح
  const effective = runtime.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.ok(!/cap_add/.test(effective), 'قدرةٌ مُضافة تنقض الحصر');
  assert.ok(!/seccomp[:=]unconfined/.test(effective), 'إلغاءُ المِصفاة ينقض الحصر');
  assert.ok(!/internal:\s*false/.test(effective), 'شبكةٌ غير داخلية تفتح الخروج');
});

test('البنيةُ على القرص هي البنيةُ المولَّدة بايتًا بايت — لا تحريرَ يدويًّا', () => {
  const rendered = renderEgressManifests(external, confinement);
  const dir = join(ROOT, confinement.generated.directory);
  assert.equal(
    readFileSync(join(dir, confinement.generated.default_deny_file), 'utf8'), rendered.defaultDeny,
  );
  assert.equal(
    readFileSync(join(dir, confinement.generated.allowlist_file), 'utf8'), rendered.allowlist,
  );
  assert.equal(
    readFileSync(join(ROOT, confinement.generated.runtime_file), 'utf8'), rendered.runtime,
  );
});

test('نظيرٌ بمضيفٍ غير صالح يُرفض عند التوليد ولا يُكتب في بنية', () => {
  const broken = {
    ...external,
    counterparties: [
      ...external.counterparties,
      { id: 'external:خطأ', host: 'bad host.example', port: 443, purpose: 'قياس' },
    ],
  } as typeof external;
  assert.throws(
    () => renderEgressManifests(broken, confinement),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'EGRESS_MANIFEST_UNDECLARED_HOST');
      return true;
    },
  );
});
