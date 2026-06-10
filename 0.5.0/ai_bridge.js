// ai_bridge.js — provides global API for ai_env.js, runs separate non-realtime AI sim worker
// loaded as non-module script before main.bundle.js and ai_env.js

(function () {

// === SHARED EVENT SYSTEM ===
const _listeners   = {};
const _sharedFns   = {};
const _sharedVals  = {};
const _lastEvtArgs = {};  // replay to late-registering listeners

window.calledSharedEventListeners = new Set();

window.addSharedEventListener = function (event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
    // if event already fired, call cb immediately with the last args
    if (calledSharedEventListeners.has(event)) {
        cb.apply(null, _lastEvtArgs[event] || []);
    }
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
    _lastEvtArgs[event] = args;
    calledSharedEventListeners.add(event);
    (_listeners[event] || []).forEach(function (cb) { cb.apply(null, args); });
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
    // bridge-only types (intercepted, never forwarded to sim)
    AI_fromSim_controlsrequested:    100,
    AI_fromSim_carTimeExpired:       101,
    AI_fromEnv_updateControls:       200,
    AI_fromEnv_makeRecordingString:  201,
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
window.points = [];  // populated after bootstrap; ai_env.js reads points.length

let _kdRoot = null;

function _buildKD(items, depth) {
    if (items.length === 0) return null;
    const key = ['x', 'y', 'z'][depth % 3];
    items.sort(function (a, b) { return a.pt[key] - b.pt[key]; });
    const mid = items.length >> 1;
    return {
        pt:    items[mid].pt,
        idx:   items[mid].idx,
        left:  _buildKD(items.slice(0, mid),      depth + 1),
        right: _buildKD(items.slice(mid + 1),     depth + 1)
    };
}

function _kdSearch(node, q, depth, best) {
    if (!node) return;
    const key = ['x', 'y', 'z'][depth % 3];
    const dx = q.x - node.pt.x, dy = q.y - node.pt.y, dz = q.z - node.pt.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best.d2) { best.d2 = d2; best.idx = node.idx; }
    const diff = q[key] - node.pt[key];
    const near = diff <= 0 ? node.left  : node.right;
    const far  = diff <= 0 ? node.right : node.left;
    _kdSearch(near, q, depth + 1, best);
    if (diff * diff < best.d2) _kdSearch(far, q, depth + 1, best);
}

// treeNearest(carPos, k) -> [[pointIndex, squaredDistance]]
window.treeNearest = function (carPos, k) {
    const best = { d2: Infinity, idx: 0 };
    _kdSearch(_kdRoot, carPos, 0, best);
    return [[best.idx, best.d2]];
};

// getProgress(pointIdx, sqDist) -> integer track progress index
window.getProgress = function (pointIdx, sqDist) {
    return pointIdx;
};


// === TRACK DATA (Summer1) ===
const TRACK_DATA = "4pdXVdtzriDEerE9ylBIAheAEa3RxOAmSATJwTflf6snVf1KNa6GMz8NDp2Vte0nnbLaV10h1veiig234ZWj2tVD7bmPkPNvPe24bSr3WrquSapV1Wl1X6SSPutyEXeHrBZoaeijwdQdGEkegVYgT6x5NhTBQrOo9VAASPAZ9s4giwZooSwyaeD6JNlkyGBOeHRNCaANOR7gBwQbjKOQPU2u6FcIYDR2V0hAec35ckcDeq6drtlhzqRpfE4HolDwth2XgoJeBTTcwRB5wXAzN3GjNGclDfvSl3HEoCH7swKhpafjjd2uyFFSjSN6Ge7DR0aaqnfr1XRGJhHg7AcKN5bR3veLvuGFwTrePe1W1diC7j9se5wkR2DJZWsDQdo11kAq1gYdIGRm5e5Ry4MhEmxFOylELHcfjJ40bNCWsReJn2ZniZbIozJEfzeeyF5gZYIXfjceOWzhp6UNOp3VGFlunCk692FebWC0kYekehY73UJnMNSEUVpZAfxJ2Pby6R2zhY3F8KRpC1k206IgLkaWkc4g7EW49ZTlVD4CCv0sYlo4yJz4AwpR1cvrOoq2e8SVOmQivDzzSFf6aXT1ZZ1v7iVL2fQbfhYwJgAP0LevM3EUfskaDV3unKyLGWw4RWz81mezfP5p6nMqo0g6QDi3PLy3oeRmo8dvyvYsNE28m2fsfz98njOGPPJJKdcSCfL5fXOf03n4f861ERIYmDevEXpf8eVq9vYeS25BRPupXMpcy9MhBvtXw3dLuGMeUIwPYdfaS6xJqsvabVqlJH1vFcmkBSYxJsvuotVjZvpkrQlqxtSYZxrT6kEDPg96z73ibn3JZ0szBazbRxnr0pHFlTFE7O58aOQN6DxGU5Q12Jim9F9naeXdscQ1an3yHa7m5vRpOa7mEtun6qGsS8ApQg01gkjwbKw7ew3FsKwMfo3oZCIOd6IwkqeSqi23bm2wGJ7L8iVuDCNCm029LDkHfsZfavYqWol2jPpoMTNmXS5jExfwqhJz22tmGY45sByAVBTQEPFiGhdZdEugGBbcK4IIsRwDMTNwGSVL719XEwTfRXYPf4fBcEfsFIVxeGVbmddbtPfWlhrR77nfqOYk1XdxsMKMehxNg67aHp3J3QmIATh9KjXezU5Q2RWfM3y3hVIS9Mxrr5Yn9d3oMAW05gzPe1ZeR1y4KxWA1CERv6f8erKQ95EsXzHt3jOxKFfqZ3IFlFOd8XDyNnnZZvYesh2ecBgHMEXaX4oxCUfbS5h6ug8pl92vE0ce1NVVQvBqto3ycF7xXLRsVMVPv81HGpAO01vq2a0rMPcrPvWJqDyK9A3AfZByVptK3tul5PlmqULKMTWP79hcvr00XVHe1gA0PIq4Gpb23qakhqoN5QiFdGh6cWuhymq0BycWrt3fyEkF8E2wbI11ofhkoqXwVYPfXhB2GjvEkNGpL3LgxalqDPeh5HnlWGjbXlePBL278wbXBRf5RwyPVnEosNpBbSeQiVlKGhipWmfwoCXM9wwgyJBhs5pCD8MER2vQIJqK8DjWMfXeD6TpZbQ2nrFVtuRbZFkZDCfa8N2DzgyTI9d8qzwbcvzHKJoIrB9f0gQp0b0GNEsKceg10zWFThunfDqKXRLZ4fiwyPJiJfeSqeefRXwbhHstYMDzsHt8YveHjy1DhgFWrZHaOSnBBnJwBJdmfGBLq6zmq0hXFwW9tZaQLACg37giA585jx46yRKXEBrzCf8DHmOgCTsA9Cged3ZgHuTpWkjASvEnTac9FRN1OJGxHdGpjJBccAR3X2nHSXtHnChB7qxUKTdnqRaB9Fe8A6u57sb3YTx8PVePpzmhvC";

// === CAR COLLISION SHAPE VERTICES (from ai_env.js) ===
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
const BOOTSTRAP_REPLAY = "eNpjYgCBBh4GTgaGEwwMKTAEYU9gBJE57CA1TDApIAAArTUF6g";
const BOOTSTRAP_CAR_ID = -999;
const BOOTSTRAP_FRAMES = 8000; // WR is ~2500 frames; 8000 gives full coverage + buffer for slow-start
const STATES_PER_BATCH = 100;
const EXPIRY_THRESHOLD = 5;

// Mutable so we can swap in a fresh worker after bootstrap frees its Ammo.js heap.
let aiWorker = new Worker('simulation_worker.bundle.js');

// Captured from the main game's Init message; reused when we restart the worker.
let _capturedTrackParts       = [];
let _capturedMountainVertices = [];

// Intercept the main game's Worker to capture real trackParts from its Init message,
// then use those parts to properly init aiWorker (avoids "no physics model" crash).
let _aiWorkerInitted = false;
const _OrigWorker = window.Worker;
window.Worker = function (url, opts) {
    const w = new _OrigWorker(url, opts);
    const _origPost = w.postMessage.bind(w);
    w.postMessage = function (msg) {
        if (msg && msg.messageType === Q_.Init && !_aiWorkerInitted) {
            _aiWorkerInitted = true;
            _capturedTrackParts       = msg.trackParts       || [];
            _capturedMountainVertices = msg.mountainVertices || [];
            aiWorker.postMessage({
                messageType:      Q_.Init,
                isRealtime:       false,
                trackParts:       _capturedTrackParts,
                mountainVertices: _capturedMountainVertices
            });
            aiWorker.postMessage({ messageType: Q_.TestDeterminism });
        }
        return _origPost(msg);
    };
    return w;
};

// per-car state
const _carBufs      = {};  // id -> state[]
const _carLastState = {};  // id -> last seen state
const _carMissing   = {};  // id -> consecutive misses while NOT paused
const _carPaused    = {};  // id -> bool: waiting for controls, don't fire another batch
const _tracked      = new Set();

// bootstrap state
let _bPositions = [];
let _bDone      = false;
let _bCarSeen   = false;


function _finalizeBootstrap() {
    if (_bDone) return;
    _bDone = true;

    // Sample path every ~0.5m
    const sampled = [];
    let last = null;
    for (let i = 0; i < _bPositions.length; i++) {
        const pos = _bPositions[i];
        if (!last) {
            sampled.push(pos);
            last = pos;
        } else {
            const dx = pos.x - last.x, dy = pos.y - last.y, dz = pos.z - last.z;
            if (dx * dx + dy * dy + dz * dz >= 0.25) {
                sampled.push(pos);
                last = pos;
            }
        }
    }

    // Populate global points array (same reference ai_env.js holds)
    for (let i = 0; i < sampled.length; i++) window.points.push(sampled[i]);

    // Compute total arc length so reward scaling uses real meters regardless of point density.
    let totalLen = 0;
    for (let i = 1; i < sampled.length; i++) {
        const dx = sampled[i].x - sampled[i-1].x;
        const dy = sampled[i].y - sampled[i-1].y;
        const dz = sampled[i].z - sampled[i-1].z;
        totalLen += Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    window._trackTotalLength = totalLen;

    // Build KD-tree
    const items = sampled.map(function (pt, idx) { return { pt: pt, idx: idx }; });
    _kdRoot = _buildKD(items, 0);

    console.log('AI bridge: bootstrap done, path points:', window.points.length, 'track length ~' + totalLen.toFixed(0) + 'm');

    // The bootstrap worker has created track physics bodies in Ammo.js that are never freed
    // when DeleteCar runs. Terminate it entirely and start a fresh worker so the WASM heap
    // is clean before AI cars start creating their own physics bodies.
    aiWorker.terminate();
    aiWorker = new _OrigWorker('simulation_worker.bundle.js');

    // Attach the normal AI message handler immediately (no TestDeterminism round-trip needed
    // from our side — just wait for the worker to confirm its Init via DeterminismResult).
    aiWorker.onmessage = function (e) {
        if (e.data && e.data.messageType === Q_.DeterminismResult) {
            // Swap to the real handler before firing events so any early postToWorker
            // calls from ai_env.js land on a live listener.
            aiWorker.onmessage = _mainOnMessage;
            _fireEvent('onAmmoLoaded');
            _fireEvent('onCommunicatorReady', 'AI_Init');
        } else {
            _mainOnMessage.call(this, e);
        }
    };

    aiWorker.postMessage({
        messageType:      Q_.Init,
        isRealtime:       false,
        trackParts:       _capturedTrackParts,
        mountainVertices: _capturedMountainVertices
    });
    aiWorker.postMessage({ messageType: Q_.TestDeterminism });
}


// === MAIN WORKER MESSAGE HANDLER ===
aiWorker.onmessage = function (e) {
    const raw = e.data;
    if (!raw || raw.messageType !== Q_.UpdateResult) {
        if (raw && raw.messageType === Q_.DeterminismResult) {
            _fireEvent('onWorkerMessage', raw);
        }
        return;
    }

    const states = raw.carStates || [];

    // --- bootstrap collection ---
    if (!_bDone) {
        const bStates = states.filter(function (s) { return s.id === BOOTSTRAP_CAR_ID; });
        if (bStates.length > 0) {
            _bCarSeen = true;
            for (let i = 0; i < bStates.length; i++) {
                const p = bStates[i].position;
                _bPositions.push({ x: p.x, y: p.y, z: p.z });
            }
            if (bStates[bStates.length - 1].finishFrames !== null) {
                _finalizeBootstrap();
            }
        } else if (_bCarSeen) {
            _finalizeBootstrap();
        }
        return;  // ignore AI car states until bootstrap is done
    }

    // --- normal AI car routing ---
    const seenIds = new Set();
    for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const id = s.id;
        if (!_tracked.has(id)) continue;
        seenIds.add(id);
        _carMissing[id] = 0;
        _carLastState[id] = s;
        // accumulate state regardless of pause flag; states arriving while
        // paused are pre-pause in-flight frames — still valid for next batch
        _carBufs[id].push(s);
    }

    _tracked.forEach(function (id) {
        // only count misses when the car is running (not waiting for controls)
        if (!_carPaused[id]) {
            if (!seenIds.has(id)) {
                _carMissing[id] = (_carMissing[id] || 0) + 1;
                if (_carMissing[id] >= EXPIRY_THRESHOLD) {
                    // car reached targetSimulationTime or was deleted by the sim
                    const lastState = _carLastState[id];
                    _tracked.delete(id);
                    delete _carBufs[id];
                    delete _carLastState[id];
                    delete _carMissing[id];
                    delete _carPaused[id];
                    if (lastState) {
                        _fireEvent('onWorkerMessage', {
                            messageType: Q_.AI_fromSim_carTimeExpired,
                            carID: id,
                            lastState: lastState,
                            hasFinished: false
                        });
                    }
                }
            }
        }

        // fire batch when buffer is full AND we're not already waiting on controls
        if (!_carPaused[id] && _carBufs[id] && _carBufs[id].length >= STATES_PER_BATCH) {
            _fireBatch(id);
        }
    });
};


function _fireBatch(id) {
    // Pause the car in the sim so it doesn't race ahead during inference
    aiWorker.postMessage({ messageType: Q_.PauseCar, carId: id, isPaused: true });
    _carPaused[id] = true;

    const batch = _carBufs[id].splice(0, STATES_PER_BATCH);
    const statesPerId = {};
    statesPerId[id] = batch;
    _fireEvent('onWorkerMessage', {
        messageType: Q_.AI_fromSim_controlsrequested,
        statesPerId: statesPerId
    });
}


// === postToWorker function exposed to ai_env.js ===
function postToWorkerFn(msg) {
    switch (msg.messageType) {

    case Q_.AI_fromEnv_updateControls: {
        const id = msg.carId;
        // Apply controls, then resume the car
        aiWorker.postMessage({
            messageType: Q_.ControlCar,
            carId:  id,
            up:    msg.newControls.up,
            right: msg.newControls.right,
            down:  msg.newControls.down,
            left:  msg.newControls.left,
            reset: msg.newControls.reset
        });
        aiWorker.postMessage({ messageType: Q_.PauseCar, carId: id, isPaused: false });
        _carPaused[id] = false;

        // if leftover states already filled the next batch, fire it now
        if (_tracked.has(id) && _carBufs[id] && _carBufs[id].length >= STATES_PER_BATCH) {
            _fireBatch(id);
        }
        break;
    }

    case Q_.AI_fromEnv_makeRecordingString:
        // Stub: return empty recording immediately
        setTimeout(function () {
            _fireEvent('onWorkerMessage', {
                messageType: Q_.AI_fromSim_recordingStringResult,
                carRecording: '',
                totalReward:   msg.totalReward   || 0,
                progressIndex: msg.progressIndex || 0,
                startTime:     msg.startTime     || 0
            });
        }, 0);
        break;

    case Q_.StartCar: {
        const id = msg.carId;
        _tracked.add(id);
        _carBufs[id]      = [];
        _carLastState[id] = null;
        _carMissing[id]   = 0;
        _carPaused[id]    = false;
        aiWorker.postMessage(msg);
        break;
    }

    case Q_.DeleteCar: {
        const id = msg.carId;
        _tracked.delete(id);
        delete _carBufs[id];
        delete _carLastState[id];
        delete _carMissing[id];
        delete _carPaused[id];
        aiWorker.postMessage(msg);
        break;
    }

    default:
        aiWorker.postMessage(msg);
        break;
    }
}

_sharedFns['postToWorker'] = postToWorkerFn;


// === BOOTSTRAP STARTUP ===
// Init + TestDeterminism are sent to aiWorker once the main game's Worker fires its own
// Init message (captured by the Worker override above), so we have the real trackParts.

let _bootstrapStarted = false;
const _mainOnMessage  = aiWorker.onmessage;  // captures the handler defined above

aiWorker.onmessage = function (e) {
    const raw = e.data;
    if (!_bootstrapStarted && raw && raw.messageType === Q_.DeterminismResult) {
        _bootstrapStarted = true;
        console.log('AI bridge: Ammo ready, starting path bootstrap...');

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

        aiWorker.postMessage({
            messageType: Q_.StartCar,
            carId: BOOTSTRAP_CAR_ID,
            targetSimulationTimeFrames: BOOTSTRAP_FRAMES
        });

        aiWorker.onmessage = _mainOnMessage;
        return;
    }
    _mainOnMessage.call(this, e);
};

})();
