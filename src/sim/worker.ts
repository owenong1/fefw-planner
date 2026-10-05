// Runs simulator commands off the main thread. This is the browser's front end to
// engine/commands.js, as the simulator's cli.js is the terminal's: it supplies the
// data, the whole-cast runner and the visuals template, and posts back the document.
import { assembleCast, unitJob } from './engine/castjob.js'
import { CommandError, describe, runCommand, tableText } from './engine/commands.js'
import { createContext } from './engine/search.js'
import template from './engine/visuals.template.html?raw'
import type { Block, CastReply, CastRequest, Reply, Request } from './protocol'
import { loadSimData } from './rawData'

type Job = { name: string }
type Progress = (done: number, total: number) => void

const data = loadSimData()
const post = (reply: Reply) => self.postMessage(reply)

/** Finished cast runs, newest last. A run takes several minutes, and `all`, `classes` and `visuals` share them. */
const castCache: { key: string; roles: string[]; jobs: Job[] }[] = []
const CACHE_SIZE = 4

function searchCast(names: string[], opts: unknown, roles: string[], progress: Progress): Promise<Job[]> {
  const threads = Math.min(names.length, 8, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))
  if (typeof Worker === 'undefined' || threads <= 1) {
    // No nested workers here (older Safari): search the units one after another in this worker.
    const ctx = createContext(data, opts as object)
    const jobs: Job[] = []
    for (const name of names) {
      jobs.push(unitJob(ctx, data.characters.get(name), opts, roles) ?? { name })
      progress(jobs.length, names.length)
    }
    return Promise.resolve(jobs)
  }
  return new Promise((resolve, reject) => {
    const jobs: Job[] = []
    let next = 0
    const pool = Array.from({ length: threads }, () => new Worker(new URL('./castWorker.ts', import.meta.url), { type: 'module' }))
    const stop = () => pool.forEach((w) => w.terminate())
    const send = (w: Worker, msg: CastRequest) => w.postMessage(msg)
    for (const w of pool) {
      const give = () => {
        if (next < names.length) send(w, { type: 'job', name: names[next++] })
      }
      w.onmessage = (e: MessageEvent<CastReply>) => {
        if (e.data.type === 'error') {
          stop()
          reject(new Error(`${e.data.name}: ${e.data.message}`))
          return
        }
        jobs.push(e.data.job)
        progress(jobs.length, names.length)
        if (jobs.length === names.length) {
          stop()
          resolve(jobs)
        } else give()
      }
      w.onerror = (e) => {
        stop()
        reject(new Error(e.message || 'A search worker failed to start.'))
      }
      send(w, { type: 'init', opts, roles })
      give()
    }
  })
}

async function runCast(_data: unknown, opts: unknown, roles: string[], progress: Progress) {
  const key = JSON.stringify(opts)
  let hit = castCache.find((c) => c.key === key && roles.every((r) => c.roles.includes(r)))
  if (!hit) {
    hit = { key, roles, jobs: await searchCast([...data.characters.keys()], opts, roles, progress) }
    castCache.push(hit)
    if (castCache.length > CACHE_SIZE) castCache.shift()
  }
  return assembleCast(data, hit.jobs)
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const msg = e.data
  if (msg.type === 'describe') {
    post({ id: msg.id, type: 'meta', meta: describe(data) })
    return
  }
  const t0 = performance.now()
  try {
    const doc = await runCommand(msg.argv, {
      data,
      runCast,
      progress: (done: number, total: number) => post({ id: msg.id, type: 'progress', done, total }),
      template: () => template,
      visualsOut: 'visuals.html',
    })
    const text = (doc as Block[]).filter((b) => b.t !== 'file').map((b) => (b.t === 'table' ? tableText(b) : b.t === 'text' ? b.text : '')).join('\n')
    post({ id: msg.id, type: 'done', doc, text, seconds: (performance.now() - t0) / 1000 })
  } catch (err) {
    post({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err), usage: err instanceof CommandError })
  }
}
