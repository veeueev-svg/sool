/**
 * src/scale/scheduler.ts — جدولة عادلة محدودة للسكان الموسعين (المرحلة 31)
 * المالك: وزارة البنية
 * المدخلات: مهام بمعرف ومُلك، سقوف التهيئة، ومفتاح الإيقاف
 * المخرجات: مهمة تالية عادلة أو رفض مسجل، وإقفال حاسم عند الإيقاف
 * التبعيات: سجل التدقيق ومفتاح الإيقاف
 * الصلاحيات: لا تعتمد قرارا سياديا ولا تعدل السياسة؛ تنفذ ما أذن به التاج فقط
 * السجلات: scale_task_enqueued / scale_task_refused / scale_task_started / scale_scheduler_frozen
 * حالات الفشل: تكرار أو طابور ممتلئ أو إيقاف => رفض/إقفال صريح، لا مهمة منسية
 * اختبارات الوحدة: tests/scale/scheduler.test.ts
 * اختبار القبول: tests/scale/scale_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0015-scale.md
 * ثوابت هذه الوحدة:
 *   1) **الدور بين الملاك**: مهمة واحدة لكل مالك في الدورة قبل عودة أي مالك.
 *   2) **مرة واحدة فقط**: المعرّف معروف من لحظة الإدراج ولا يقبل إعادة إدراجه.
 *   3) **السقفان مستقلان**: الكلي وسقف المالك يرفضان ولا يؤجلان.
 *   4) **الإيقاف قاطع**: المجدول يجمد المنتظر ويقفل الجاري ولا يبقي معلقا.
 */
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';

export type ScheduledStatus = 'queued' | 'running' | 'completed' | 'frozen';
export interface ScaleTask { readonly taskId: string; readonly owner: string; status: ScheduledStatus; }
export type ScheduleResult = { ok: true } | { ok: false; code: string };
export interface SchedulerSnapshot {
  readonly tasks: readonly ScaleTask[];
  readonly queues: readonly [string, readonly string[]][];
  readonly owners: readonly string[];
  readonly cursor: number;
  readonly running: number;
  readonly frozen: boolean;
}

export class FairScheduler {
  private readonly tasks = new Map<string, ScaleTask>();
  private readonly queues = new Map<string, string[]>();
  private readonly owners: string[] = [];
  private cursor = 0;
  private running = 0;
  private frozen = false;

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly killSwitch: KillSwitch,
    readonly maxConcurrent: number,
    readonly queueMax: number,
    readonly ownerQueueMax: number,
    /** سجل المنتهين (المرحلة 35): وكيل منتهٍ كان ينال حصةً عادلة من الجدولة */
    private readonly terminated?: { isTerminated(entity: string): boolean },
  ) {
    audit.append('ministry:infrastructure', 'scale_scheduler_online', { maxConcurrent, queueMax, ownerQueueMax });
  }

  enqueue(taskId: string, owner: string): ScheduleResult {
    if (this.killSwitch.status.engaged || this.frozen) return this.refuse(taskId, 'SCHEDULER_HALTED');
    if (!taskId || !owner) return this.refuse(taskId, 'SCHEDULER_TASK_INCOMPLETE');
    if (this.terminated?.isTerminated(owner)) return this.refuse(taskId, 'SCHEDULER_OWNER_TERMINATED');
    if (this.tasks.has(taskId)) return this.refuse(taskId, 'SCHEDULER_DUPLICATE_TASK');
    const total = [...this.queues.values()].reduce((sum, queue) => sum + queue.length, 0);
    if (total >= this.queueMax) return this.refuse(taskId, 'SCHEDULER_QUEUE_FULL');
    const queue = this.queues.get(owner) ?? [];
    if (queue.length >= this.ownerQueueMax) return this.refuse(taskId, 'SCHEDULER_OWNER_QUEUE_FULL');
    const task: ScaleTask = { taskId, owner, status: 'queued' };
    this.tasks.set(taskId, task);
    if (!this.queues.has(owner)) { this.queues.set(owner, queue); this.owners.push(owner); }
    queue.push(taskId);
    this.audit.append('ministry:infrastructure', 'scale_task_enqueued', { taskId, owner });
    return { ok: true };
  }

  next(): ScaleTask | null {
    this.freezeIfHalted();
    if (this.frozen || this.running >= this.maxConcurrent || this.owners.length === 0) return null;
    for (let tries = 0; tries < this.owners.length; tries += 1) {
      const index = this.cursor % this.owners.length;
      const owner = this.owners[index]!;
      this.cursor = (index + 1) % this.owners.length;
      const queue = this.queues.get(owner)!;
      const taskId = queue.shift();
      if (!taskId) continue;
      const task = this.tasks.get(taskId)!;
      task.status = 'running';
      this.running += 1;
      this.audit.append('ministry:infrastructure', 'scale_task_started', { taskId, owner });
      return { ...task };
    }
    return null;
  }

  complete(taskId: string): boolean {
    this.freezeIfHalted();
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running' || this.frozen) return false;
    task.status = 'completed';
    this.running -= 1;
    this.audit.append('ministry:infrastructure', 'scale_task_completed', { taskId, owner: task.owner });
    return true;
  }

  freezeIfHalted(): void {
    if (this.killSwitch.status.engaged && !this.frozen) {
      this.frozen = true;
      for (const task of this.tasks.values()) if (task.status === 'queued' || task.status === 'running') task.status = 'frozen';
      this.running = 0;
      this.audit.append('authority:crown_guard', 'scale_scheduler_frozen', { tasks: this.tasks.size });
    }
  }

  statusOf(taskId: string): ScheduledStatus | null { return this.tasks.get(taskId)?.status ?? null; }
  queued(): number { return [...this.tasks.values()].filter((task) => task.status === 'queued').length; }

  private refuse(taskId: string, code: string): ScheduleResult {
    this.audit.append('ministry:infrastructure', 'scale_task_refused', { taskId, code });
    return { ok: false, code };
  }

  exportAll(): SchedulerSnapshot {
    return {
      tasks: [...this.tasks.values()].map((task) => ({ ...task })),
      queues: [...this.queues.entries()].map(([owner, queue]) => [owner, [...queue]] as const),
      owners: [...this.owners], cursor: this.cursor, running: this.running, frozen: this.frozen,
    };
  }

  importAll(snapshot: SchedulerSnapshot, by: string): boolean {
    const statuses: readonly ScheduledStatus[] = ['queued', 'running', 'completed', 'frozen'];
    if (!Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.queues) || !Array.isArray(snapshot.owners)
      || !Number.isSafeInteger(snapshot.cursor) || !Number.isSafeInteger(snapshot.running)
      || snapshot.running < 0 || snapshot.running > this.maxConcurrent
      || snapshot.tasks.some((task) => !task.taskId || !task.owner || !statuses.includes(task.status))
      || new Set(snapshot.tasks.map((task) => task.taskId)).size !== snapshot.tasks.length) {
      throw new Error('RECOVERY_SCHEDULER_INVALID');
    }
    const tasks = new Map(snapshot.tasks.map((task) => [task.taskId, { ...task }]));
    const queues = new Map<string, string[]>();
    for (const [owner, queue] of snapshot.queues) {
      if (!owner || !Array.isArray(queue) || queue.some((id) => !tasks.has(id))) {
        throw new Error('RECOVERY_SCHEDULER_QUEUE_INVALID');
      }
      queues.set(owner, [...queue]);
    }
    if (new Set(snapshot.owners).size !== snapshot.owners.length
      || snapshot.owners.some((owner) => !queues.has(owner))) throw new Error('RECOVERY_SCHEDULER_OWNERS_INVALID');
    this.tasks.clear(); for (const [id, task] of tasks) this.tasks.set(id, task);
    this.queues.clear(); for (const [owner, queue] of queues) this.queues.set(owner, queue);
    this.owners.splice(0, this.owners.length, ...snapshot.owners);
    this.cursor = snapshot.cursor; this.running = snapshot.running; this.frozen = snapshot.frozen;
    this.audit.append(by, 'scale_scheduler_restored', { tasks: this.tasks.size });
    return true;
  }
}
