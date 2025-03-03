type Resolver<T> = (resolve: (value: T) => void, reject: (reason: any) => void) => void;
type QueueTask<T> = {
	priority: number;
	func: Resolver<T>;
	resolve: (value: T) => void;
	reject: (reason: any) => void;
};

type AsyncQueueOptions = {
	maxConcurrent?: number;
	defaultPriority?: number;
	delayMs?: number;
};

export class AsyncQueue {
	private queue: QueueTask<any>[] = [];
	private busyTasks: number = 0;
	private priorityCounts: Map<number, number> = new Map();
	private maxConcurrent: number;
	private defaultPriority: number;
	private delayMs: number;

	constructor(options?: AsyncQueueOptions) {
		this.maxConcurrent = options?.maxConcurrent ?? 1;
		this.defaultPriority = options?.defaultPriority ?? 5;
		this.delayMs = options?.delayMs ?? 0;
	}

	private adjustPriorityCount(priority: number, delta: number) {
		const value = (this.priorityCounts.get(priority) ?? 0) + delta;
		if (value == 0) {
			this.priorityCounts.delete(priority);
		} else {
			this.priorityCounts.set(priority, value);
		}
	}

	private getInsertionIndex(priority: number) {
		// find all present priorities less than or equal to given:
		const ltePriorities = [...this.priorityCounts.keys()].filter(k => k <= priority);
		// insertion point is sum of their counts:
		return ltePriorities.reduce((acc, p) => acc + (this.priorityCounts.get(p) as number), 0);
	}

	private continue() {
		while (this.busyTasks < this.maxConcurrent) {
			if (this.queue.length == 0) return;

			this.busyTasks++;
			const task = this.queue.shift() as QueueTask<any>;
			this.adjustPriorityCount(task.priority, -1);

			const result = new Promise(task.func);

			result.then(
				value => task.resolve(value),
				value => task.reject(value)
			).finally(
				this.delayMs == 0 ? () => {
					this.busyTasks--;
					this.continue();
				} : () => setTimeout(() => {
					this.busyTasks--;
					this.continue();
				}, this.delayMs)
			);
		}
	}

	enqueue<T>(func: Resolver<T>, priority: number = this.defaultPriority) {
		return new Promise<T>((resolve, reject) => {
			const task = { func, priority, resolve, reject };

			const insertIdx = this.getInsertionIndex(priority);
			this.adjustPriorityCount(priority, 1);

			this.queue.splice(insertIdx, 0, task);
			this.continue();
		});
	}

	createFunc<F extends (...args: any[]) => Promise<any>>(
		fn: F,
		priority: number | ((...args: Parameters<F>) => number) = this.defaultPriority
	) {
		type A = Parameters<F>;
		type R = ReturnType<F> extends Promise<infer T> ? T : never;
		return typeof priority == "function"
			? (...args: A) => this.enqueue<R>(
				(resolve, reject) => fn(...args).then(resolve, reject),
				priority(...args)
			)
			: (...args: A) => this.enqueue<R>(
				(resolve, reject) => fn(...args).then(resolve, reject),
				priority
			);
	}
}
