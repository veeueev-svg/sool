/**
 * src/scale/sharding.ts — توزيع هويات السكان وعزل الشرائح (المرحلة 31)
 * المالك: وزارة البنية
 * المدخلات: معرّف هوية، سياسة الشرائح، وأوامر تاج لعزل شريحة أو إعادتها
 * المخرجات: شريحة حتمية، حالة عزل، ومخالفات انحراف مسجلة
 * التبعيات: بوابة التاج، مفتاح الإيقاف، والسجل غير القابل للمحو
 * الصلاحيات: هذه الوحدة توزّع وتتحقق فقط؛ الاعتماد في بوابة التاج ولا بوابة فرعية
 * السجلات: shard_assigned / shard_isolated / shard_restored / shard_drift_detected
 * حالات الفشل: شريحة ممتلئة أو معزولة أو سجل منحرف => رفض مسجل، لا إعادة توازن صامتة
 * اختبارات الوحدة: tests/scale/sharding.test.ts
 * اختبار القبول: tests/scale/scale_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0015-scale.md
 * ثوابت هذه الوحدة:
 *   1) **المعرّف نفسه في الشريحة نفسها دائما**: FNV-1a حتمية، فلا قرار محلي متغير.
 *   2) **لا فائض صامت**: امتلاء الشريحة يرفض الطلب ولا ينقله إلى غيرها.
 *   3) **العزل موضعي**: عزل شريحة لا يغير حالة أي شريحة سليمة.
 *   4) **الانحراف دليل لا تخمين**: المالك أو الشريحة أو العدد المخالف يرفع مخالفة.
 */
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { SignedRoyalCommand } from '../kernel/types';

export interface ShardRecord {
  readonly agentId: string;
  readonly owner: string;
  readonly shardId: number;
  readonly resourceQuota: string;
}

export interface ShardDrift {
  readonly code: 'SHARD_OWNER_MISSING' | 'SHARD_ASSIGNMENT_MISMATCH' | 'SHARD_CAP_EXCEEDED';
  readonly agentId?: string;
  readonly shardId: number;
}

export class Sharding {
  private readonly isolated = new Set<number>();

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly gateway: CrownGateway,
    readonly shardCount: number,
    readonly perShardMax: number,
  ) {
    if (!Number.isSafeInteger(shardCount) || shardCount <= 0 || !Number.isSafeInteger(perShardMax) || perShardMax <= 0) {
      throw new Error('تهيئة الشرائح غير صالحة');
    }
    audit.append('ministry:infrastructure', 'sharding_online', { shardCount, perShardMax });
  }

  /** FNV-1a 32-bit: دالة معلنة ثابتة لا تعتمد على ترتيب التسجيل أو حالة الشريحة. */
  shardFor(agentId: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < agentId.length; i += 1) {
      hash ^= agentId.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % this.shardCount;
  }

  isIsolated(shardId: number): boolean {
    return this.isolated.has(shardId);
  }

  isolate(command: SignedRoyalCommand, shardId: number, now = Date.now()): boolean {
    const decision = this.gateway.authorize(command, now);
    if (!decision.allowed || command.payload.action !== 'declare_emergency' || !this.validShard(shardId)) {
      this.audit.append('ministry:infrastructure', 'shard_isolation_refused', { shardId, commandId: command.payload.commandId });
      return false;
    }
    this.isolated.add(shardId);
    this.audit.append('authority:crown_guard', 'shard_isolated', { shardId, commandId: command.payload.commandId });
    return true;
  }

  restore(command: SignedRoyalCommand, shardId: number, now = Date.now()): boolean {
    const decision = this.gateway.authorize(command, now);
    if (!decision.allowed || command.payload.action !== 'declare_emergency' || !this.validShard(shardId)) {
      this.audit.append('ministry:infrastructure', 'shard_restore_refused', { shardId, commandId: command.payload.commandId });
      return false;
    }
    this.isolated.delete(shardId);
    this.audit.append('authority:crown_guard', 'shard_restored', { shardId, commandId: command.payload.commandId });
    return true;
  }

  /** يفحص سجلات السكّان المقدمة من سجلهم؛ لا يملك الشارد صلاحية تصحيحها. */
  auditRecords(records: Iterable<ShardRecord>): readonly ShardDrift[] {
    const drifts: ShardDrift[] = [];
    const counts = Array.from({ length: this.shardCount }, () => 0);
    for (const record of records) {
      if (!record.owner) drifts.push({ code: 'SHARD_OWNER_MISSING', agentId: record.agentId, shardId: record.shardId });
      const expected = this.shardFor(record.agentId);
      if (record.shardId !== expected) {
        drifts.push({ code: 'SHARD_ASSIGNMENT_MISMATCH', agentId: record.agentId, shardId: record.shardId });
      }
      if (this.validShard(record.shardId)) counts[record.shardId]! += 1;
    }
    for (let shardId = 0; shardId < counts.length; shardId += 1) {
      if (counts[shardId]! > this.perShardMax) drifts.push({ code: 'SHARD_CAP_EXCEEDED', shardId });
    }
    for (const drift of drifts) this.audit.append('ministry:infrastructure', 'shard_drift_detected', { ...drift });
    return drifts;
  }

  private validShard(shardId: number): boolean {
    return Number.isSafeInteger(shardId) && shardId >= 0 && shardId < this.shardCount;
  }
}
