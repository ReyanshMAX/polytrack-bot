# polytrack-bot

## What this is

Archived copies of [Polytrack](https://www.kodub.com/apps/polytrack) (a browser 3D racing game by Kodub), plus a PPO-based AI mod that trains a neural network to drive the game's Summer1 track in the browser. No Polytrack source code is included — all files are ripped from Kodub's static hosting.

Two versions exist:
- `0.3.1/` — old archive with a camera-follow-ghost mod. Development stopped.
- `0.5.0/` — active version with the AI training mod plus ~90% serialization optimization for main↔sim thread communication.

## Architecture: 3 threads

```
Main game thread (main.bundle.js)
  └── ai_bridge.js  (loaded before main.bundle.js, patches window.Worker)
        ├── fires shared events: onAmmoLoaded, onCommunicatorReady, onWorkerMessage
        └── owns aiWorker (simulation_worker.bundle.js, non-realtime)

ai_env.js  (loaded as separate script, polls for ai_bridge readiness)
  └── training_worker.js  (PPO, TF.js, persists model in localStorage)
```

**ai_bridge.js** (`0.5.0/ai_bridge.js`) is the glue layer. It:
- Intercepts the game's own `Worker` constructor to capture the `Init` message (which contains `trackParts`) and forwards it to `aiWorker` — this is what prevents the "no physics model" crash.
- Runs a **bootstrap**: spawns car id `-999` with a pre-recorded WR replay for 1200 frames to collect track centerline positions, then builds a 3D KD-tree from those points (sampled every ~0.5m). This populates `window.points[]` and `window.treeNearest()`.
- Fires `onCommunicatorReady("AI_Init")` once bootstrap completes, signaling `ai_env.js` to start.
- Batches 100 physics states per car, then pauses the car in the sim and fires `onWorkerMessage` with `AI_fromSim_controlsrequested` so `ai_env.js` can call inference.
- Resumes the car after `ai_env.js` posts back `AI_fromEnv_updateControls`.

**ai_env.js** (`0.5.0/ai_env.js`, wraps code in `setupAI()` with a polling init to wait for `ai_bridge`):
- Spawns 100 AI cars staggered 100ms apart.
- Builds a `Float32Array(98)` per batch (transferable buffer, zero-copy to training worker): header byte, timestamp, carID, reward, finishFrames, then 93 agent state floats.
- On `train_done`: saves model to localStorage, re-creates the same car, increments iteration counter, plots median progress every 100 iterations via Plotly.

**training_worker.js** (`0.5.0/training_worker.js`):
- PPO actor-critic. `policyNetwork` outputs `{steering: -1|0|1, throttle: 0|1, brake: 0|1}`. `valueNetwork` outputs a scalar value estimate.
- Model state persists in `localStorage` under key `<modelName>-policyNetwork` / `<modelName>-valueNetwork`.
- Receives predict calls as raw `ArrayBuffer` (not `{type, data}`). Sends back `{type: "outputs", data: {carID, outputs, lastFrame}}`.
- Receives train calls as `{type: "train", data: {carID, carRequestId, progressIndex, epochs:10, batchSize:32}}`.

## Key constants / config

| Constant | Value | Location |
|---|---|---|
| `numInputs` | 93 | training_worker.js:19 |
| `STATES_PER_BATCH` | 100 | ai_bridge.js:176 |
| `targetSimulationTimeFrames` | 5000 (50s) | ai_env.js |
| `carCount` | 100 | ai_env.js |
| Track | Summer1 (hardcoded `trackData` string) | ai_env.js, ai_bridge.js |
| Model name | `model-1` default, overridable via `?modelName=` URL param | ai_env.js |

## Agent state vector (93 floats)

`getAgentState()` in `ai_env.js` builds this in order:
1. `frames` (time)
2. `speedKmh`, `acceleration` (delta speed)
3. Controls: up, down, left, right (0/1)
4. `hasCheckpointToRespawnAt`, `nextCheckpointIndex`
5. Position: x, y, z
6. Delta position (velocity): dx, dy, dz
7. Quaternion: x, y, z, w
8. Wheel contact positions relative to car (4 × xyz = 12)
9. Wheel contact normals (4 × xyz = 12, zero if airborne)
10. Wheel positions relative to car (4 × xyz = 12)
11. Wheel quaternions (4 × xyzw = 16)
12. Wheel rotation (4)
13. Wheel delta rotation (4)
14. Wheel skid info (4)
15. Wheel suspension length (4)
16. Wheel suspension velocity (4)
17. `progressIndex`, `deltaProgress_1s`

## Reward function

```
reward = (progressIndex * 0.5 * 0.01)   // distance from start in meters * 0.01
       + deltaCheckpointIndex * 1000     // per checkpoint passed
       + 1000000 if finished             // finish bonus
       - states.length * 0.0012         // time penalty
reward *= 0.1                           // scale to ~PPO range
```

## Shared event API (set up by ai_bridge.js on window)

- `addSharedEventListener(event, cb)` — register; replays immediately if event already fired
- `callSharedEventListener(event)` — get the registered function for an event (used by ai_env to get `postToWorker`)
- `getShared(key)` — get shared values (e.g. `Q_` enum)
- `window.points[]` — track centerline points after bootstrap
- `window.treeNearest(pos, k)` — KD-tree nearest neighbor
- `window.getProgress(pointIdx, sqDist)` — returns pointIdx (identity, kept as API seam)

## Q_ message type enum

Standard sim messages: `Init(0)`, `Verify(1)`, `TestDeterminism(2)`, `CreateCar(3)`, `DeleteCar(4)`, `StartCar(5)`, `ControlCar(6)`, `PauseCar(7)`, `VerifyResult(8)`, `DeterminismResult(9)`, `UpdateResult(10)`

Bridge-only (intercepted, never forwarded to sim): `AI_fromSim_controlsrequested(100)`, `AI_fromSim_carTimeExpired(101)`, `AI_fromEnv_updateControls(200)`, `AI_fromEnv_makeRecordingString(201)`, `AI_fromSim_recordingStringResult(202)`

## Files to know

| File | Purpose |
|---|---|
| `0.5.0/ai_bridge.js` | **The active working file.** Glue layer, KD-tree, sim worker management |
| `0.5.0/ai_env.js` | Main thread AI loop (spawns cars, handles episodes, builds state) |
| `0.5.0/training_worker.js` | PPO training worker (TF.js) |
| `0.5.0/index.html` | Entry point for v0.5.0 |
| `_ai_env.js` | Older reference version of ai_env (no setupAI wrapper) |
| `_training_worker.js` | Older reference version of training_worker |
| `servers/main.ts` | Deno server for hosting the static files |
| `.github/workflows/deploy.yml` | Deploys to Deno Deploy on push to main |

## Comm optimization (v0.5.0)

The main game sim normally serializes every physics step. In v0.5.0, the sim only sends ~10% of steps; the main thread reconstructs the rest by copying the last sent step with updated frame counts. This cuts ~90% of serialization overhead. The AI sim worker (`aiWorker`) is separate and unoptimized — it runs non-realtime anyway.

## What's not implemented / known gaps

- `AI_fromEnv_makeRecordingString` is a stub that returns an empty string immediately.
- Buffer memory beaming (SharedArrayBuffer ring buffer) is commented out — was planned as next optimization after the serialization work.
- The `servers/` directory and deploy CI have a broken build step (`npm run` with no script target).
- `window.treeNearest(pos, k)` always returns only 1 nearest point regardless of `k`.
