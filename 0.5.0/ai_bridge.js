// ai_bridge.js — provides global API for ai_env.js, runs separate non-realtime AI sim worker
// loaded as non-module script before main.bundle.js and ai_env.js

(function () {

// === SHARED EVENT SYSTEM ===
const _listeners = {};
const _sharedFns = {};
const _sharedVals = {};

window.calledSharedEventListeners = new Set();

window.addSharedEventListener = function (event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
};

// used by ai_env.js as: postToWorker = callSharedEventListener("postToWorker")
window.callSharedEventListener = function (event) {
    return _sharedFns[event];
};

window.getShared = function (key) {
    return _sharedVals[key];
};

function _fireEvent(event) {
    const args = Array.prototype.slice.call(arguments, 1);
    calledSharedEventListeners.add(event);
    (_listeners[event] || []).forEach(cb => cb.apply(null, args));
}


// === Q_ ENUM ===
const Q_ = {
    Init: 0,
    Verify: 1,
    TestDeterminism: 2,
    CreateCar: 3,
    DeleteCar: 4,
    StartCar: 5,
    ControlCar: 6,
    PauseCar: 7,
    VerifyResult: 8,
    DeterminismResult: 9,
    UpdateResult: 10,
    // bridge-only types (intercepted, never sent to sim)
    AI_fromSim_controlsrequested: 100,
    AI_fromSim_carTimeExpired: 101,
    AI_fromEnv_updateControls: 200,
    AI_fromEnv_makeRecordingString: 201,
    AI_fromSim_recordingStringResult: 202,
};
_sharedVals['Q_'] = Q_;


// === loadScript ===
window.loadScript = function (src, callback) {
    const s = document.createElement('script');
    s.src = src;
    if (callback) s.onload = callback;
    document.head.appendChild(s);
};


// === KD-TREE (3D nearest neighbor over track centerline points) ===
window.points = [];  // populated after bootstrap; ai_env.js uses points.length

let _kdRoot = null;

function _buildKD(items, depth) {
    if (items.length === 0) return null;
    const key = ['x', 'y', 'z'][depth % 3];
    items.sort((a, b) => a.pt[key] - b.pt[key]);
    const mid = items.length >> 1;
    return {
        pt: items[mid].pt,
        idx: items[mid].idx,
        left: _buildKD(items.slice(0, mid), depth + 1),
        right: _buildKD(items.slice(mid + 1), depth + 1)
    };
}

function _kdSearch(node, q, depth, best) {
    if (!node) return;
    const key = ['x', 'y', 'z'][depth % 3];
    const dx = q.x - node.pt.x, dy = q.y - node.pt.y, dz = q.z - node.pt.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best.d2) { best.d2 = d2; best.idx = node.idx; }
    const diff = q[key] - node.pt[key];
    const near = diff <= 0 ? node.left : node.right;
    const far  = diff <= 0 ? node.right : node.left;
    _kdSearch(near, q, depth + 1, best);
    if (diff * diff < best.d2) _kdSearch(far, q, depth + 1, best);
}

// treeNearest(carPos, 1) -> [[pointIndex, squaredDistance]]
window.treeNearest = function (carPos, k) {
    const best = { d2: Infinity, idx: 0 };
    _kdSearch(_kdRoot, carPos, 0, best);
    return [[best.idx, best.d2]];
};

// getProgress(pointIdx, sqDist) -> integer track progress index
window.getProgress = function (pointIdx, sqDist) {
    return pointIdx;
};


// === TRACK DATA (Summer1) — needed for bootstrap car CreateCar ===
const TRACK_DATA = "4pdXVdtzriDEerE9ylBIAheAEa3RxOAmSATJwTflf6snVf1KNa6GMz8NDp2Vte0nnbLaV10h1veiig234ZWj2tVD7bmPkPNvPe24bSr3WrquSapV1Wl1X6SSPutyEXeHrBZoaeijwdQdGEkegVYgT6x5NhTBQrOo9VAASPAZ9s4giwZooSwyaeD6JNlkyGBOeHRNCaANOR7gBwQbjKOQPU2u6FcIYDR2V0hAec35ckcDeq6drtlhzqRpfE4HolDwth2XgoJeBTTcwRB5wXAzN3GjNGclDfvSl3HEoCH7swKhpafjjd2uyFFSjSN6Ge7DR0aaqnfr1XRGJhHg7AcKN5bR3veLvuGFwTrePe1W1diC7j9se5wkR2DJZWsDQdo11kAq1gYdIGRm5e5Ry4MhEmxFOylELHcfjJ40bNCWsReJn2ZniZbIozJEfzeeyF5gZYIXfjceOWzhp6UNOp3VGFlunCk692FebWC0kYekehY73UJnMNSEUVpZAfxJ2Pby6R2zhY3F8KRpC1k206IgLkaWkc4g7EW49ZTlVD4CCv0sYlo4yJz4AwpR1cvrOoq2e8SVOmQivDzzSFf6aXT1ZZ1v7iVL2fQbfhYwJgAP0LevM3EUfskaDV3unKyLGWw4RWz81mezfP5p6nMqo0g6QDi3PLy3oeRmo8dvyvYsNE28m2fsfz98njOGPPJJKdcSCfL5fXOf03n4f861ERIYmDevEXpf8eVq9vYeS25BRPupXMpcy9MhBvtXw3dLuGMeUIwPYdfaS6xJqsvabVqlJH1vFcmkBSYxJsvuotVjZvpkrQlqxtSYZxrT6kEDPg96z73ibn3JZ0szBazbRxnr0pHFlTFE7O58aOQN6DxGU5Q12Jim9F9naeXdscQ1an3yHa7m5vRpOa7mEtun6qGsS8ApQg01gkjwbKw7ew3FsKwMfo3oZCIOd6IwkqeSqi23bm2wGJ7L8iVuDCNCm029LDkHfsZfavYqWol2jPpoMTNmXS5jExfwqhJz22tmGY45sByAVBTQEPFiGhdZdEugGBbcK4IIsRwDMTNwGSVL719XEwTfRXYPf4fBcEfsFIVxeGVbmddbtPfWlhrR77nfqOYk1XdxsMKMehxNg67aHp3J3QmIATh9KjXezU5Q2RWfM3y3hVIS9Mxrr5Yn9d3oMAW05gzPe1ZeR1y4KxWA1CERv6f8erKQ95EsXzHt3jOxKFfqZ3IFlFOd8XDyNnnZZvYesh2ecBgHMEXaX4oxCUfbS5h6ug8pl92vE0ce1NVVQvBqto3ycF7xXLRsVMVPv81HGpAO01vq2a0rMPcrPvWJqDyK9A3AfZByVptK3tul5PlmqULKMTWP79hcvr00XVHe1gA0PIq4Gpb23qakhqoN5QiFdGh6cWuhymq0BycWrt3fyEkF8E2wbI11ofhkoqXwVYPfXhB2GjvEkNGpL3LgxalqDPeh5HnlWGjbXlePBL278wbXBRf5RwyPVnEosNpBbSeQiVlKGhipWmfwoCXM9wwgyJBhs5pCD8MER2vQIJqK8DjWMfXeD6TpZbQ2nrFVtuRbZFkZDCfa8N2DzgyTI9d8qzwbcvzHKJoIrB9f0gQp0b0GNEsKceg10zWFThunfDqKXRLZ4fiwyPJiJfeSqeefRXwbhHstYMDzsHt8YveHjy1DhgFWrZHaOSnBBnJwBJdmfGBLq6zmq0hXFwW9tZaQLACg37giA585jx46yRKXEBrzCf8DHmOgCTsA9Cged3ZgHuTpWkjASvEnTac9FRN1OJGxHdGpjJBccAR3X2nHSXtHnChB7qxUKTdnqRaB9Fe8A6u57sb3YTx8PVePpzmhvC";

// === CAR COLLISION SHAPE VERTICES (from ai_env.js) — needed for bootstrap CreateCar ===
const CAR_COLLISION_SHAPE_VERTICES = [
    -0.7532370686531067, -0.34599804878234863, 1.5797429084777832,
    -0.7532370686531067, -0.10825656354427338, 1.5797429084777832,
    -0.7532370686531067, -0.032746829092502594, -1.85726797580719,
    -0.7532370686531067, -0.34599804878234863, 1.5797429084777832,
    -0.7532370686531067, -0.032746829092502594, -1.85726797580719,
    -0.7532370686531067, -0.34599804878234863, -1.85726797580719,
    -0.16806356608867645, 0.37836751341819763, -0.5776124000549316,
    0.16806338727474213, 0.37836751341819763, -0.5776124000549316,
    0.7532369494438171, -0.032746829092502594, -1.85726797580719,
    -0.16806356608867645, 0.37836751341819763, -0.5776124000549316,
    0.7532369494438171, -0.032746829092502594, -1.85726797580719,
    -0.7532370686531067, -0.032746829092502594, -1.85726797580719,
    0.7532369494438171, -0.34599804878234863, -1.85726797580719,
    0.7532369494438171, -0.032746829092502594, -1.85726797580719,
    0.753237247467041, -0.10825656354427338, 1.5797449350357056,
    0.7532369494438171, -0.34599804878234863, -1.85726797580719,
    0.753237247467041, -0.10825656354427338, 1.5797449350357056,
    0.7532369494438171, -0.34599804878234863, 1.5797429084777832,
    0.7532369494438171, -0.032746829092502594, -1.85726797580719,
    0.7532369494438171, -0.34599804878234863, -1.85726797580719,
    -5.960464477539063e-8, -0.34599804878234863, -1.976300597190857,
    0.753237247467041, -0.10825656354427338, 1.5797449350357056,
    0.7532369494438171, -0.032746829092502594, -1.85726797580719,
    0.16806338727474213, 0.37836751341819763, -0.5776124000549316,
    -0.7532370686531067, -0.10825656354427338, 1.5797429084777832,
    -0.7532370686531067, -0.34599804878234863, 1.5797429084777832,
    -1.1920928955078125e-7, -0.3459986746311188, 1.6698905229568481,
    -0.7532370686531067, -0.032746829092502594, -1.85726797580719,
    -0.7532370686531067, -0.10825656354427338, 1.5797429084777832,
    -0.16806356608867645, 0.37836751341819763, -0.5776124000549316,
    -0.7532370686531067, -0.10825656354427338, 1.5797429084777832,
    0.753237247467041, -0.10825656354427338, 1.5797449350357056,
    0.16806338727474213, 0.37836751341819763, -0.5776124000549316,
    -0.7532370686531067, -0.10825656354427338, 1.5797429084777832,
    0.16806338727474213, 0.37836751341819763, -0.5776124000549316,
    -0.16806356608867645, 0.37836751341819763, -0.5776124000549316,
    0.753237247467041, -0.10825656354427338, 1.5797449350357056,
    -0.7532370686531067, -0.10825656354427338, 1.5797429084777832,
    -1.1920928955078125e-7, -0.3459986746311188, 1.6698905229568481,
    -1.1920928955078125e-7, -0.3459986746311188, 1.6698905229568481,
    0.7532369494438171, -0.34599804878234863, 1.5797429084777832,
    0.753237247467041, -0.10825656354427338, 1.5797449350357056,
    -5.960464477539063e-8, -0.34599804878234863, -1.976300597190857,
    -0.7532370686531067, -0.34599804878234863, -1.85726797580719,
    -0.7532370686531067, -0.032746829092502594, -1.85726797580719,
    -0.7532370686531067, -0.032746829092502594, -1.85726797580719,
    0.7532369494438171, -0.032746829092502594, -1.85726797580719,
    -5.960464477539063e-8, -0.34599804878234863, -1.976300597190857
];


// === AI SIM WORKER SETUP ===
const BOOTSTRAP_REPLAY  = "eNpjYgCBBh4GTgaGEwwMKTAEYU9gBJE57CA1TDApIAAArTUF6g";
const BOOTSTRAP_CAR_ID  = -999;
const BOOTSTRAP_FRAMES  = 1200;
const STATES_PER_BATCH  = 100;
const EXPIRY_THRESHOLD  = 5;

const aiWorker = new Worker('simulation_worker.bundle.js');

// per-car state
const _carBufs      = {};  // id -> state[]
const _carLastState = {};  // id -> last state
const _carMissing   = {};  // id -> consecutive UpdateResult misses
const _tracked      = new Set();

// bootstrap state
let _bPositions  = [];
let _bDone       = false;
let _bCarSeen    = false;


function _finalizeBootstrap() {
    if (_bDone) return;
    _bDone = true;

    // Delete bootstrap car from sim
    aiWorker.postMessage({ messageType: Q_.DeleteCar, carId: BOOTSTRAP_CAR_ID });

    // Sample positions every ~0.5m
    const sampled = [];
    let last = null;
    for (const pos of _bPositions) {
        if (!last) {
            sampled.push(pos);
            last = pos;
        } else {
            const dx = pos.x - last.x, dy = pos.y - last.y, dz = pos.z - last.z;
            if (dx * dx + dy * dy + dz * dz >= 0.25) { // 0.5m^2 = 0.25
                sampled.push(pos);
                last = pos;
            }
        }
    }

    // Populate the global points array (keep same reference so ai_env.js sees it)
    sampled.forEach(p => window.points.push(p));

    // Build KD-tree
    const items = sampled.map((pt, idx) => ({ pt, idx }));
    _kdRoot = _buildKD(items, 0);

    console.log('AI bridge: bootstrap done, path points:', window.points.length);

    // Signal ai_env.js that Ammo and the communicator are ready
    _fireEvent('onAmmoLoaded');
    _fireEvent('onCommunicatorReady', 'AI_Init');
}


aiWorker.onmessage = function (e) {
    const raw = e.data;

    // Non-realtime sim sends structured UpdateResult
    if (raw && raw.messageType === Q_.UpdateResult) {
        const states = raw.carStates || [];

        // --- bootstrap car collection ---
        if (!_bDone) {
            const bStates = states.filter(s => s.id === BOOTSTRAP_CAR_ID);
            if (bStates.length > 0) {
                _bCarSeen = true;
                bStates.forEach(s => _bPositions.push({ x: s.position.x, y: s.position.y, z: s.position.z }));
                // check finish
                if (bStates[bStates.length - 1].finishFrames !== null) {
                    _finalizeBootstrap();
                    return;
                }
            } else if (_bCarSeen) {
                // bootstrap car was seen before but disappeared — it finished its targetSimulationTime
                _finalizeBootstrap();
                return;
            }
            // still bootstrapping; ignore AI car states
            return;
        }

        // --- normal AI car message routing ---
        const seenIds = new Set();
        states.forEach(s => {
            const id = s.id;
            if (!_tracked.has(id)) return;
            seenIds.add(id);
            _carMissing[id] = 0;
            _carLastState[id] = s;
            _carBufs[id].push(s);
        });

        // Check for missing cars and fire batches
        _tracked.forEach(id => {
            if (!seenIds.has(id)) {
                _carMissing[id] = (_carMissing[id] || 0) + 1;
                // Fire with partial buffer before declaring expiry
                if (_carMissing[id] >= EXPIRY_THRESHOLD) {
                    const lastState = _carLastState[id];
                    if (lastState) {
                        // flush remaining buffer before expiry
                        if (_carBufs[id] && _carBufs[id].length > 0) {
                            _flushCarBatch(id);
                        }
                        _tracked.delete(id);
                        delete _carBufs[id];
                        delete _carLastState[id];
                        delete _carMissing[id];
                        _fireEvent('onWorkerMessage', {
                            messageType: Q_.AI_fromSim_carTimeExpired,
                            carID: id,
                            lastState: lastState,
                            hasFinished: false
                        });
                    }
                }
                return;
            }

            // Fire batch when buffer is full
            if (_carBufs[id] && _carBufs[id].length >= STATES_PER_BATCH) {
                _flushCarBatch(id);
            }
        });

    } else if (raw && raw.messageType === Q_.DeterminismResult) {
        // Forward to ai_env.js
        _fireEvent('onWorkerMessage', raw);
    }
    // Ignore all other sim messages (VerifyResult, etc.)
};


function _flushCarBatch(id) {
    const batch = _carBufs[id].splice(0, STATES_PER_BATCH);

    // Check if any state in this batch marks the car as finished
    let finishedState = null;
    for (const s of batch) {
        if (s.finishFrames !== null) {
            finishedState = s;
            break;
        }
    }

    if (finishedState) {
        // Fire controlsrequested for this final batch (ai_env will handle finish detection)
        const statesPerId = {};
        statesPerId[id] = batch;
        _fireEvent('onWorkerMessage', {
            messageType: Q_.AI_fromSim_controlsrequested,
            statesPerId: statesPerId
        });
    } else {
        const statesPerId = {};
        statesPerId[id] = batch;
        _fireEvent('onWorkerMessage', {
            messageType: Q_.AI_fromSim_controlsrequested,
            statesPerId: statesPerId
        });
    }
}


// === postToWorker function exposed to ai_env.js ===
function postToWorkerFn(msg) {
    switch (msg.messageType) {

    case Q_.AI_fromEnv_updateControls:
        // Translate to ControlCar
        aiWorker.postMessage({
            messageType: Q_.ControlCar,
            carId: msg.carId,
            up:    msg.newControls.up,
            right: msg.newControls.right,
            down:  msg.newControls.down,
            left:  msg.newControls.left,
            reset: msg.newControls.reset
        });
        break;

    case Q_.AI_fromEnv_makeRecordingString:
        // Stub: immediately return a fake recording string
        setTimeout(function () {
            _fireEvent('onWorkerMessage', {
                messageType: Q_.AI_fromSim_recordingStringResult,
                carRecording: 'STUB',
                totalReward: msg.totalReward,
                progressIndex: msg.progressIndex,
                startTime: msg.startTime
            });
        }, 0);
        break;

    case Q_.StartCar: {
        // Track this car from now on
        const id = msg.carId;
        _tracked.add(id);
        _carBufs[id]      = [];
        _carLastState[id] = null;
        _carMissing[id]   = 0;
        aiWorker.postMessage(msg);
        break;
    }

    case Q_.DeleteCar: {
        // Remove tracking
        const id = msg.carId;
        _tracked.delete(id);
        delete _carBufs[id];
        delete _carLastState[id];
        delete _carMissing[id];
        aiWorker.postMessage(msg);
        break;
    }

    default:
        // Forward everything else (CreateCar, TestDeterminism, etc.) directly
        aiWorker.postMessage(msg);
        break;
    }
}

_sharedFns['postToWorker'] = postToWorkerFn;


// === BOOTSTRAP: init AI sim worker and collect path points ===
// Init non-realtime sim (no mountain track parts needed)
aiWorker.postMessage({ messageType: Q_.Init, isRealtime: false, trackParts: [] });

// TestDeterminism waits in queue until Ammo loads; reply tells us the sim is ready
aiWorker.postMessage({ messageType: Q_.TestDeterminism });

// After Ammo loads (DeterminismResult arrives), create the bootstrap car.
// We use the best available replay to drive through the track and collect centerline positions.
let _bootstrapStarted = false;
const _origOnMessage = aiWorker.onmessage;
aiWorker.onmessage = function (e) {
    const raw = e.data;
    if (!_bootstrapStarted && raw && raw.messageType === Q_.DeterminismResult) {
        _bootstrapStarted = true;
        console.log('AI bridge: Ammo ready, starting path bootstrap...');

        // Create bootstrap car using pre-recorded WR replay
        aiWorker.postMessage({
            messageType: Q_.CreateCar,
            mountainVertices: [],
            mountainOffset: { x: 0, y: 0, z: 70 },
            trackData: TRACK_DATA,
            carId: BOOTSTRAP_CAR_ID,
            carRecording: BOOTSTRAP_REPLAY,
            carCollisionShapeVertices: CAR_COLLISION_SHAPE_VERTICES,
            carMassOffset: 0.6
        });

        // Start bootstrap car; runs for BOOTSTRAP_FRAMES frames then stops
        aiWorker.postMessage({
            messageType: Q_.StartCar,
            carId: BOOTSTRAP_CAR_ID,
            targetSimulationTimeFrames: BOOTSTRAP_FRAMES
        });

        // Switch to main message handler
        aiWorker.onmessage = _origOnMessage;
        return;
    }
    // Pass through to main handler before bootstrap starts
    _origOnMessage.call(this, e);
};

})();
