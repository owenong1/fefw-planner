// Whole-cast runs (`all`, `classes`, `visuals`): every unit is searched and
// its leading paths rolled, which takes ten seconds or more per unit, so the units
// are shared out over worker threads. The caller stays synchronous: it sleeps
// on a shared counter and collects each unit's result as it arrives.

import { Worker, MessageChannel, receiveMessageOnPort, isMainThread, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { loadData } from './load.js';
import { createContext } from '../../src/sim/engine/search.js';
import { unitJob, assembleCast } from '../../src/sim/engine/castjob.js';

/**
 * Run unitJob() for every unit and return assembleCast()'s rows.
 * `progress(done, total)` is called as units finish.
 */
export function runCast(data, opts, roles, progress = () => {}) {
  const names = [...data.characters.keys()];
  const threads = Math.min(names.length, 8, Math.max(1, availableParallelism() - 1));
  const jobs = [];
  if (threads <= 1) {
    const ctx = createContext(data, opts);
    for (const name of names) {
      jobs.push(unitJob(ctx, data.characters.get(name), opts, roles) || { name });
      progress(jobs.length, names.length);
    }
  } else {
    // shared[0]: next unit to take, shared[1]: units finished.
    const shared = new Int32Array(new SharedArrayBuffer(8));
    const pool = Array.from({ length: threads }, () => {
      const { port1, port2 } = new MessageChannel();
      const worker = new Worker(new URL(import.meta.url), { workerData: { cast: { names, opts, roles, shared, port: port2 } }, transferList: [port2] });
      return { worker, port: port1 };
    });
    let idle = 0;
    try {
      while (jobs.length < names.length) {
        const before = jobs.length;
        Atomics.wait(shared, 1, before, 250);
        for (const { port } of pool) {
          for (let m = receiveMessageOnPort(port); m; m = receiveMessageOnPort(port)) {
            if (m.message.error) throw new Error(`${m.message.name || 'worker'}: ${m.message.error}`);
            jobs.push(m.message);
          }
        }
        idle = jobs.length === before ? idle + 1 : 0;
        if (idle > 1200) throw new Error('The cast run stopped making progress (a worker thread may have failed to start).');
        progress(jobs.length, names.length);
      }
    } finally {
      for (const { worker } of pool) worker.terminate();
    }
  }
  return assembleCast(data, jobs);
}

if (!isMainThread && workerData && workerData.cast) {
  const { names, opts, roles, shared, port } = workerData.cast;
  let name = null;
  try {
    const data = loadData();
    const ctx = createContext(data, opts);
    for (let i = Atomics.add(shared, 0, 1); i < names.length; i = Atomics.add(shared, 0, 1)) {
      name = names[i];
      port.postMessage(unitJob(ctx, data.characters.get(name), opts, roles) || { name });
      Atomics.add(shared, 1, 1);
      Atomics.notify(shared, 1);
    }
  } catch (err) {
    port.postMessage({ name, error: err.message });
    Atomics.add(shared, 1, 1);
    Atomics.notify(shared, 1);
  }
}
