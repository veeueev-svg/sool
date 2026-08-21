/**
 * scripts/verify_audit_chain.ts — تحقق تشغيلي من سلامة سجل التدقيق (RULE-006)
 * الاستخدام: npm run verify
 * الخرج: 0 إذا كانت السلسلة سليمة، 1 وتقرير خطأ إذا كُشف تلاعب
 */
import { bootstrapState } from '../src/index';

const state = bootstrapState();
const cmd = state.king.issueCommand('approve_phase', 'phase:10');
state.gateway.authorize(cmd);
const report = state.audit.verifyIntegrity();

console.log(`عدد السجلات: ${report.length}`);
console.log(`الحالة: ${report.valid ? 'سليمة' : 'مخترقة'} — ${report.reason}`);
if (!report.valid) {
  console.error(`انقطاع عند السجل رقم ${report.brokenAt}`);
  process.exit(1);
}
console.log('وضع الدولة:', state.mode());
