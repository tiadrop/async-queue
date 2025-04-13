type Resolver<T> = (resolve: (value: T) => void, reject: (reason: any) => void) => void;
type QueueTask<T> = {
	priority: number;
	func: Resolver<T>;
	resolve: (value: T) => void;
	reject: (reason: any) => void;
};

type AsyncQueueOptions = {
	/**
	 * Specifies maximum number of tasks to run at a given time
	 * 
	 * *Default is 1*
	 */
	maxConcurrent?: number;
	/**
	 * Specifies default priority to be assigned to tasks; lower values place the task toward the front of the queue
	 * 
	 * *Default is 5*
	 */
	defaultPriority?: number;
	/**
	 * Specifies a delay between a task completing and its concurrency slot becoming available for another task
	 * 
	 * *Default is 0*
	 */
	delayMs?: number;
	/**
	 * If true, the queue will start in a paused state; enqueued tasks will not be processed until resume() is called
	 * 
	 * *Default is false*
	 */
	paused?: boolean;
};

export class AsyncQueue {
	private queue: QueueTask<any>[] = [];
	private busyTasks: number = 0;
	private priorityCounts: Map<number, number> = new Map();
	private maxConcurrent: number;
	private defaultPriority: number;
	private delayMs: number;
	private _paused: boolean;

	constructor(options?: AsyncQueueOptions) {
		this.maxConcurrent = options?.maxConcurrent ?? 1;
		this.defaultPriority = options?.defaultPriority ?? 5;
		this.delayMs = options?.delayMs ?? 0;
		this._paused = options?.paused ?? false;
	}

	get paused(){ return this._paused }

	private adjustPriorityCount(priority: number, delta: number) {
		const value = (this.priorityCounts.get(priority) ?? 0) + delta;
		if (value == 0) {
			this.priorityCounts.delete(priority);
		} else {
			this.priorityCounts.set(priority, value);
		}
	}

	private getInsertionIndex(priority: number) {
		let sum = 0;
		const iter = this.priorityCounts.keys();
		let item = iter.next();
		while (!item.done) {
			if (item.value <= priority) sum += this.priorityCounts.get(item.value) as number;
			item = iter.next();
		}
		return sum;
	}

	private continue() {
		if (this._paused) return;
		while (this.busyTasks < this.maxConcurrent) {
			if (this.queue.length == 0) return;

			this.busyTasks++;
			const task = this.queue.shift() as QueueTask<any>;
			this.adjustPriorityCount(task.priority, -1);

			const result = new Promise(task.func);

			result.then(
				value => task.resolve(value),
				value => task.reject(value)
			).finally(() => {
				if (this.delayMs == 0) {
					this.busyTasks--;
					this.continue();
				} else setTimeout(() => {
					this.busyTasks--;
					this.continue();
				}, this.delayMs)
			});
		}
	}

	/**
	 * Creates and enqueues a Promise initialiser
	 * @param executor A function in the form of a Promise initialiser, ie `(resolve, reject) => void`
	 * @param priority A queue priority for this entry; lower values place the task toward the front of the queue
	 * @returns A Promise, to be settled by `executor`
	 */
	promise<T>(executor: Resolver<T>, priority: number = this.defaultPriority) {
		return new Promise<T>((resolve, reject) => {
			const task = { func: executor, priority, resolve, reject };
			this.adjustPriorityCount(priority, 1);
			const size = this.queue.length;

			if (
				size == 0
				|| this.queue[size - 1].priority <= priority
			) {
				this.queue.push(task);
			} else {
				const insertIdx = this.getInsertionIndex(priority);
				this.queue.splice(insertIdx, 0, task);
			}

			this.continue();
		});
	}

	/**
	 * Enqueues an asynchronous function
	 * @param func The function to enqueue
	 * @param priority A queue priority for this entry; lower values place the task toward the front of the queue
	 * @returns A promise, to be settled by the given function
	 */
	enqueueFunc<T>(func: () => Promise<T>, priority?: number) {
		return this.promise<T>(
			(resolve, reject) => func().then(resolve, reject),
			priority
		);
	}

	/**
	 * Wraps an asynchronous function and provides an identically-signed function that enqueues calls
	 * @param fn The function to wrap
	 * @param priority A fixed priority for the wrapped function, or a separate function that takes a call's arguments to determine priority; lower values place the task toward the front of the queue
	 * @returns The new function
	 */
	createFunc<F extends (...args: any[]) => Promise<any>>(
		fn: F,
		priority: number | ((...args: Parameters<F>) => number) = this.defaultPriority
	) {
		type A = Parameters<F>;
		type R = ReturnType<F> extends Promise<infer T> ? T : never;
		return typeof priority == "function"
			? (...args: A) => this.enqueueFunc<R>(
				() => fn(...args),
				priority(...args)
			)
			: (...args: A) => this.enqueueFunc<R>(
				() => fn(...args),
				priority
			);
	}

	/**
	 * Clears the queue
	 * 
	 * Does not affect any on-going tasks
	 */
	clear() {
		this.queue.splice(0, this.queue.length);
		this.priorityCounts.clear();
	}

	/**
	 * Rejects all enqueued tasks
	 * 
	 * Does not affect any on-going tasks
	 * @param value Optional value to reject all tasks with
	 */
	panic(value?: any) {
		const rejecters = this.queue.map(task => task.reject);
		this.clear();
		rejecters.forEach(r => r(value));
	}

	/**
	 * Pauses queue processing
	 * 
	 * Does not affect any on-going tasks
	 */
	pause() {
		this._paused = true;
	}

	/**
	 * Resumes queue processing when paused
	 */
	resume() {
		this._paused = false;
		this.continue();
	}

}
