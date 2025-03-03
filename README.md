# async-queue

A lightweight but powerful asynchronous task queuing system, with smart task priority and configurable concurrency limit.

## Basic Use:

`npm i @xtia/async-queue`

```ts
import { AsyncQueue } from "@xtia/async-queue";

// create a queue with default options
// (maxConcurrent = 1)
const queue = new AsyncQueue();

// enqueue a task with a Promise-like interface:
// (enqueuing methods return a promise that forwards the task's resolution)
const text = await queue.promise<Response>(resolve => {
    fetch(someUrl).then(resolve);
}).then(r => r.text());

// enqueue a task with a specific priority:
queue.promise(resolve => {
    someAsyncOperation().then(resolve);
}, 1);
```

As well as resolution, promise rejection is forwarded by enqueuing methods:
```ts
queue.promise((resolve, reject) => {
    fetch("doesntexist.lol").then(resolve, reject);
}).catch((err) => console.warn("fetch failed:", err));
```

## `queue.createFunc()`

`createFunc(fn, priority?)` lets us easily convert asynchronous functions to identically-signed functions that place their behaviour in the queue.

```ts
const queue = new AsyncQueue({
    maxConcurrent: 3, // allow 3 notifications to be shown at a time
});

// we have a normal function to show a notification
function showNotification(level: "info" | "warning", message: string) {
    return new Promise(resolve => {
        // ... code to show notification
        // resolve when removed by click or timeout
    });
}

// wrap it so that its behaviour is queued when called
export const enqueueNotification = queue.createFunc(showNotification);

// function's signature is maintained, but calls are automatically enqueued:
enqueueNotification("info", "Download complete");
```

When wrapping the function, we can provide a priority for that function, or a function to determine a call's priority from its arguments:

```ts
// prioritise warnings
export const enqueueNotification = queue.createFunc(
    showNotification,
    (level, message) => level == "warning" ? 1 : 2
);

// wrap builtins, fixed priority
const enqueueFetch = queue.createFunc(fetch, 2);
const urgentFetch = queue.createFunc(fetch, 1);
// all type information is inherited from fetch
```

## `queue.enqueueFunc()`

`enqueueFunc(fn, priority?)` adds an asynchronous function to the queue without wrapping it with `createFunc`.

```ts
async function getData(url: string) {
    const response = await fetch(url);
    return await response.json();
}

const data = await queue.enqueueFunc(() => getData("data.json"));
```

## Constructor options

`AsyncQueue`'s constructor can be passed an object with the following properties

### `maxConcurrent: number`

Specifies how many tasks can be processed at a time. Default is 1.

### `defaultPriority: number`

Specifies a standard priority. Default is 5.

### `delayMs: number`

Specifies a delay between a queued task's completion and its concurrency slot becoming available for another task. Default is 0.

### `paused: boolean`

If true, the queue will start in a paused state; enqueued tasks will not be processed until resume() is called. Default is false.

## Queue Management

* `queue.pause()` and `queue.resume()` halt and resume queue processing.
* `queue.clear()` removes all queued tasks.
* `queue.panic(value?)` rejects and removes all queued tasks.

These methods do not affect active, on-going tasks.
