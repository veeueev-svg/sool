/**
 * tests/services/critical_service_lifecycle.test.ts — قبول دورة الخدمات الحرجة (المرحلة 29)
 * المالك: وزارة الخدمات وديوان التدقيق؛ المجال وحدات برمجية لوكلاء مسجلين فقط (DIRECTIVES §6)
 * المدخلات: services.yaml، مصادر مقيدة، اوامر ملكية، وتحقق مستقل من التعافي
 * المخرجات: full او limited او halted فقط، مع سجل سبب كل انتقال
 * ثوابت هذه الوحدة:
 *   1) شرط القبول: خدمة حرجة تعمل limited عند فقد جزء من البيانات.
 *   2) فقد الاساسيات يوقفها بامان ولا يوجد وضع رابع.
 *   3) العودة الى full تحتاج تحقق معلنا بيد غير معلن الفقد.
 *   4) التهيئة سلوك ملزم وليست وصفا، وكل تغيير فيها يمر بالتحميل.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadServices } from '../../src/kernel/config';
import {
  AGENT, AUDITOR, DAY, HOSPITAL, HOSPITAL_SOURCES, criticalState, establishHospital, establishLab,
  performLab, recoverHospital,
} from './helpers';

function fullHospital() {
  const h = criticalState();
  assert.equal(establishHospital(h).ok, true);
  return h;
}

function copiedConfig(replace: (text: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), 'sool-phase29-'));
  cpSync(join(process.cwd(), 'config'), root, { recursive: true });
  const file = join(root, 'services.yaml');
  writeFileSync(file, replace(readFileSync(file, 'utf8')), 'utf8');
  return root;
}

test('قبول: فقد مصدر تشخيصي يخفض المستشفى الى limited فتعمل triage وترفض care-plan صراحة', () => {
  const h = fullHospital();
  h.setSource('source:diagnostic-history', false);
  const limited = h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: 'فرز بخدمة محدودة',
  }, h.now);
  assert.equal(limited.ok, true, 'عملية limited لم تعمل بعد فقد جزئي');
  assert.equal(limited.mode, 'limited');
  const forbidden = h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:care-plan', beneficiary: AGENT, purpose: 'خطة تحتاج المصدر المفقود',
  }, h.now);
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.reason ?? '', /full|مصادر/);
  const degradation = h.s.audit.find('service_degraded')[0];
  assert.deepEqual((degradation?.detail as { missingSources: string[] }).missingSources, ['source:diagnostic-history']);
});

test('فقد مصدرين اساسيين يهبط مباشرة الى halted ولا يحاول تقريبا', () => {
  const h = fullHospital();
  h.setSource('source:agent-registry', false);
  h.setSource('source:service-protocol', false);
  const receipt = h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: 'محاولة بعد فقد الاساسيات',
  }, h.now);
  assert.equal(receipt.ok, false);
  assert.equal(h.s.hospitals.get(HOSPITAL)?.mode, 'halted');
  assert.match(receipt.reason ?? '', /توقف/);
});

test('عودة المصدر وحدها لا ترفع limited، والتحقق المستقل المعلن وحده يعيد full', () => {
  const h = fullHospital();
  h.setSource('source:diagnostic-history', false);
  assert.equal(h.s.hospitals.reconcile(HOSPITAL, 'authority:service_monitor', h.now).ok, true);
  assert.equal(h.s.hospitals.get(HOSPITAL)?.mode, 'limited');
  h.setSource('source:diagnostic-history', true);
  assert.equal(h.s.hospitals.reconcile(HOSPITAL, 'authority:service_monitor', h.now).ok, true);
  assert.equal(h.s.hospitals.get(HOSPITAL)?.mode, 'limited', 'ارتفعت الخدمة تلقائيا بلا تحقق');
  assert.equal(h.s.hospitals.get(HOSPITAL)?.recoveryPending, true);
  const recovered = recoverHospital(h);
  assert.equal(recovered.ok, true);
  assert.equal(h.s.hospitals.get(HOSPITAL)?.mode, 'full');
  assert.equal(h.s.audit.find('service_recovered').length, 1);
});

test('من اعلن الفقد لا يتحقق من التعافي بيده حتى لو كان جهة التحقق المعلنة', () => {
  const h = fullHospital();
  h.setSource('source:diagnostic-history', false);
  assert.equal(h.s.hospitals.reconcile(HOSPITAL, AUDITOR, h.now).ok, true);
  h.setSource('source:diagnostic-history', true);
  const sameHand = recoverHospital(h, HOSPITAL, { verifiedBy: AUDITOR });
  assert.equal(sameHand.ok, false);
  if (!sameHand.ok) assert.match(sameHand.reason, /RULE-004/);
});

test('تحقق التعافي الناقص او المخالف للواقع لا يرفع الخدمة', () => {
  const h = fullHospital();
  h.setSource('source:diagnostic-history', false);
  assert.equal(h.s.hospitals.reconcile(HOSPITAL, 'authority:service_monitor', h.now).ok, true);
  h.setSource('source:diagnostic-history', true);
  assert.equal(recoverHospital(h, HOSPITAL, { verifiedSources: HOSPITAL_SOURCES.slice(0, 2) }).ok, false);
  h.setSource('source:diagnostic-history', false);
  assert.equal(recoverHospital(h).ok, false);
  assert.equal(h.s.hospitals.get(HOSPITAL)?.mode, 'limited');
});

test('الايقاف الشامل يوقف عملية قائمة بامان حتى قبل فقد اي مصدر', () => {
  const h = fullHospital();
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'احتواء شامل معلن');
  const receipt = h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: 'طلب في ايقاف شامل',
  }, h.now);
  assert.equal(receipt.ok, false);
  assert.match(receipt.reason ?? '', /بوابة التاج/);
});

test('مضي المدة يوقف الخدمة ولا يسمح بتشغيل او تحقق تعاف متاخر', () => {
  const h = criticalState();
  assert.equal(establishHospital(h, { days: 1 }).ok, true);
  const later = h.now + DAY + 1;
  assert.equal(h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: 'تشغيل منته',
  }, later).ok, false);
  assert.equal(recoverHospital(h, HOSPITAL, { at: later }).ok, false);
});

test('الاعلان يحصر الاوضاع في full ثم limited ثم halted ومصادرها ادنى متداخلة', () => {
  const h = criticalState();
  assert.deepEqual(h.s.servicesConfig.policy.mode_order, ['full', 'limited', 'halted']);
  const declaration = h.s.servicesConfig.services.find((service) => service.id === 'service:hospital-core');
  assert.equal(declaration?.modes.full.required_sources?.length, 3);
  assert.equal(declaration?.modes.limited.required_sources?.length, 2);
  assert.equal(declaration?.modes.halted.required_sources, null);
});

test('الفعل السيادي establish_service معلن في اليامل ويبنى في البوابة', () => {
  const h = criticalState();
  assert.ok(h.s.config.sovereign_actions.includes('establish_service'));
  assert.equal(h.s.gateway.authorize(h.royalService('service:gate-check'), h.now).allowed, true);
});

test('تغيير max_term_days في services.yaml يغير سلوك الاقامة فعلا', () => {
  const configDir = copiedConfig((text) => text.replace('max_term_days: 90', 'max_term_days: 1'));
  const h = criticalState({ configDir });
  assert.equal(h.s.servicesConfig.policy.max_term_days, 1);
  assert.equal(establishHospital(h, { days: 1 }).ok, true);
  assert.equal(establishHospital(h, { serviceId: 'service:two-days', days: 2 }).ok, false);
});

test('حد الجودة من التهيئة يقبل الدرجة عنده ويرفضها إذا زاد الحد بواحد', () => {
  const atLimit = criticalState({
    configDir: copiedConfig((text) => text.replace('min_quality_score: 70', 'min_quality_score: 65')),
  });
  assert.equal(establishLab(atLimit).ok, true);
  const acceptedCandidate = performLab(atLimit, 'result:quality-at-limit');
  assert.equal(acceptedCandidate.ok, true);
  if (!acceptedCandidate.ok) return;
  const accepted = atLimit.s.qualityControl.assess(acceptedCandidate.result, {
    inspector: AUDITOR, passed: ['provenance', 'reproducibility'],
  }, atLimit.now);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.decision.status, 'accepted');

  const aboveLimit = criticalState({
    configDir: copiedConfig((text) => text.replace('min_quality_score: 70', 'min_quality_score: 66')),
  });
  assert.equal(establishLab(aboveLimit).ok, true);
  const rejectedCandidate = performLab(aboveLimit, 'result:quality-over-limit');
  assert.equal(rejectedCandidate.ok, true);
  if (!rejectedCandidate.ok) return;
  const rejected = aboveLimit.s.qualityControl.assess(rejectedCandidate.result, {
    inspector: AUDITOR, passed: ['provenance', 'reproducibility'],
  }, aboveLimit.now);
  assert.equal(rejected.ok, true);
  if (rejected.ok) assert.equal(rejected.decision.status, 'rejected');
});

test('محمل الخدمات يرفض وضعا رابعا قبل تشغيل الدولة', () => {
  const configDir = copiedConfig((text) => text.replace('    - "halted"', '    - "paused"'));
  assert.throws(() => loadServices(configDir), { code: 'CONFIG_SERVICES_MODE_ORDER' });
});

test('محمل الخدمات يرفض حدا للجودة لا يبلغه مجموع الاوزان', () => {
  const configDir = copiedConfig((text) => text.replace('min_quality_score: 70', 'min_quality_score: 101'));
  assert.throws(() => loadServices(configDir), { code: 'CONFIG_SERVICES_QUALITY_UNREACHABLE' });
});

test('كل مصدر معلن يخدم خدمة او عملية ولا توجد خدمة رابعة او بشر في النطاق', () => {
  const config = loadServices();
  const declared = new Set(config.sources.map((source) => source.id));
  for (const service of config.services) {
    assert.ok(['hospital', 'lab'].includes(service.kind));
    assert.equal(service.ministry, config.policy.service_operator);
    for (const operation of service.operations) {
      for (const source of operation.required_sources) assert.ok(declared.has(source));
    }
  }
  assert.equal(config.policy.beneficiary_prefix, 'agent:');
});
