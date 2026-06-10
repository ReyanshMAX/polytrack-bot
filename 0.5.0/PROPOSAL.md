# Worker-Per-Car Architecture Proposal

## Problem

`simulation_worker.bundle.js` uses a fixed-size Ammo.js WASM heap. Every `CreateCar(trackData)` call builds a new `btBvhTriangleMeshShape` (BVH triangle mesh) for the track geometry in that heap. With one shared worker:

```
Init(trackParts)       → 1 BVH  (from captured trackParts)
CreateCar(trackData)   → 1 more BVH per car
```

N concurrent cars = N+1 BVH meshes in one heap → OOM at N≥2. Current workaround: `carCount=1`.

## Solution

Give each car its own worker. Each worker gets `Init(trackParts)` + one `CreateCar(trackData)` = 2 BVH meshes, which is the same as bootstrap and known to fit.

```
aiWorkers: Map<carID, Worker>

Worker 0: Init → CreateCar(car 0) → episodes for car 0
Worker 1: Init → CreateCar(car 1) → episodes for car 1
...
Worker N: Init → CreateCar(car N) → episodes for car N
```

Each worker runs an isolated WASM heap. No cross-car memory pressure.

---

## Episode Restart Problem

After each episode, `ai_env.js` calls `createAI_car(carID)` which sends `DeleteCar` + `CreateCar` to restart. In the same worker, `CreateCar` builds a second BVH on top of the existing two → accumulates over episodes → eventual OOM.

**Fix**: Transparently recycle the worker on `CreateCar` when the car slot already has a live worker:

1. Terminate old worker
2. Create fresh worker, send `Init(trackParts)` + `TestDeterminism`
3. Queue any incoming messages for that carID
4. On `DeterminismResult`, drain the queue (forwards `CreateCar`, `StartCar`, etc.)

`ai_env.js` is unaware of this — it just calls `createAI_car()` as normal.

---

## Memory Budget

Each worker allocates one Ammo.js WASM heap (typically 256 MB address space, ~50–100 MB RSS with Init+1 car). 

| carCount | Estimated RSS |
|---|---|
| 5 | ~500 MB |
| 10 | ~1 GB |
| 20 | ~2 GB |

Safe default: **5 cars** on a machine with 8–16 GB RAM.

---

## Changes Required

### `ai_bridge.js`

**1. Replace single worker with worker map**

```js
// Before
let aiWorker = new Worker('simulation_worker.bundle.js');

// After
const AI_CAR_COUNT = 5;  // must match carCount in ai_env.js
let aiWorkers = new Map();   // carID (0..N-1) → Worker
let _pendingMsgs = new Map(); // carID → [] while worker is reinitializing
```

**2. Add `_spawnWorker(carID)` helper**

Creates a fresh worker, sends Init+TestDeterminism, resolves a Promise on DeterminismResult, then swaps `onmessage` to `_mainOnMessage`. Returns the Promise.

```js
function _spawnWorker(carID) {
    return new Promise(function(resolve) {
        const w = new _OrigWorker('simulation_worker.bundle.js');
        w.onmessage = function(e) {
            if (e.data && e.data.messageType === Q_.DeterminismResult) {
                w.onmessage = _mainOnMessage;
                aiWorkers.set(carID, w);
                resolve(w);
            } else {
                _mainOnMessage.call(this, e);
            }
        };
        w.postMessage({ messageType: Q_.Init, isRealtime: false,
                        trackParts: _capturedTrackParts,
                        mountainVertices: _capturedMountainVertices });
        w.postMessage({ messageType: Q_.TestDeterminism });
    });
}
```

**3. Update `_finalizeBootstrap`**

Replace the current "create 1 fresh worker, wait for 1 DeterminismResult" with:

```js
// Spawn all N workers in parallel, fire events when all are ready
const spawns = [];
for (let i = 0; i < AI_CAR_COUNT; i++) spawns.push(_spawnWorker(i));
Promise.all(spawns).then(function() {
    _fireEvent('onAmmoLoaded');
    _fireEvent('onCommunicatorReady', 'AI_Init');
});
```

**4. Update `postToWorkerFn`**

Route by `msg.carId`:

```js
function postToWorkerFn(msg) {
    const raw = _serializeMsg(msg);  // existing serialization logic
    const id  = msg.carId;

    // If this CreateCar is a restart (worker already exists), recycle the worker
    if (msg.messageType === Q_.CreateCar && aiWorkers.has(id)) {
        aiWorkers.get(id).terminate();
        aiWorkers.delete(id);
        _pendingMsgs.set(id, [raw]);  // queue CreateCar; StartCar will follow
        _spawnWorker(id).then(function() {
            const q = _pendingMsgs.get(id) || [];
            _pendingMsgs.delete(id);
            const w = aiWorkers.get(id);
            q.forEach(function(m) { w.postMessage(m); });
        });
        return;
    }

    // If worker is reinitializing, queue the message
    if (_pendingMsgs.has(id)) {
        _pendingMsgs.get(id).push(raw);
        return;
    }

    const w = aiWorkers.get(id);
    if (w) w.postMessage(raw);
    else console.warn('postToWorkerFn: no worker for car', id);
}
```

Note: messages without a `carId` (none should reach `postToWorkerFn` in normal operation after setup) would fall through to the `console.warn`.

**5. Remove the old `aiWorker` variable**

All references to `aiWorker.postMessage(msg)` in the `switch` blocks become the routing call above (they already call `postToWorkerFn`, so this is implicit once the function is updated).

The `_mainOnMessage` and bootstrap handler stay structurally the same, but they now receive events from whichever worker owns a given car — the sim worker includes `carId` in UpdateResult and AI event messages, so the existing routing in `_mainOnMessage` continues to work without changes.

---

### `ai_env.js`

**1. Increase `carCount`**

```js
// Before
const carCount = 1;

// After
const carCount = 5;  // must match AI_CAR_COUNT in ai_bridge.js
```

No other changes needed. `createAI_car(i)` still sends `CreateCar` + `StartCar` per car; `postToWorkerFn` handles worker routing and recycling transparently.

---

## Implementation Order

1. Add `AI_CAR_COUNT` constant and `aiWorkers` Map to `ai_bridge.js`
2. Implement `_spawnWorker(carID)` helper
3. Update `_finalizeBootstrap` to use `Promise.all(_spawnWorker × N)`
4. Rewrite `postToWorkerFn` routing + queueing logic
5. Update `carCount = 5` in `ai_env.js`
6. Test with `carCount = 2` first (lower memory risk), then 5

---

## Known Risks

**Worker init latency**: `_spawnWorker` on restart takes ~20–30ms (determinism test). At 6–10s per episode this is <1% overhead. Acceptable.

**Memory spike on spawn**: All N workers are created simultaneously in `_finalizeBootstrap`. If N=5 each allocates 256MB heap space on init, Chrome requests ~1.28GB before any is freed. Monitor Task Manager; if it crashes on load, init workers lazily (spawn worker for car `i` only when `createAI_car(i)` is first called).

**_mainOnMessage scope**: The bootstrap handler (`aiWorker.onmessage = function(e) {...}`) references the old `aiWorker` variable. After refactor, the bootstrap still uses the single initial worker before the Map exists, so bootstrap logic is unchanged. The `_mainOnMessage` captured at line 451 must be captured before any worker is replaced — verify capture order.

**Message ordering**: `CreateCar` and `StartCar` are sent as two separate postMessage calls ~0ms apart in `createAI_car`. The queue will capture both before the new worker's DeterminismResult fires (DeterminismResult takes ~20ms), so ordering is safe.

---

## What This Unlocks

- Parallel episodes = N× more experience per wall-clock second
- Restore `carCount` to original 100 target (with `AI_CAR_COUNT = 100` and enough RAM / careful memory profiling)
- Each worker is isolated: a crash in one car's physics doesn't kill others
