import type { Block, Reply, Request, SimMeta } from './protocol'

export type { Block, SimMeta }

/** A failed command. `usage` marks a mistake in the command itself (shown as a message, not a crash). */
export class SimError extends Error {
  usage: boolean
  constructor(message: string, usage: boolean) {
    super(message)
    this.usage = usage
  }
}

type Pending = { resolve: (reply: Reply) => void; reject: (err: Error) => void; onProgress?: (done: number, total: number) => void }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function start() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const reply = e.data
    const p = pending.get(reply.id)
    if (!p) return
    if (reply.type === 'progress') {
      p.onProgress?.(reply.done, reply.total)
      return
    }
    pending.delete(reply.id)
    if (reply.type === 'error') p.reject(new SimError(reply.message, reply.usage))
    else p.resolve(reply)
  }
  worker.onerror = (e) => stopSim(new SimError(e.message || 'The simulator failed to start.', false))
  return worker
}

function request(msg: { type: 'describe' } | { type: 'run'; argv: string[] }, onProgress?: Pending['onProgress']) {
  return new Promise<Reply>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject, onProgress })
    start().postMessage({ ...msg, id } satisfies Request)
  })
}

/** Units, classes, roles, checkpoints and option defaults, from the simulator's own data. */
export async function describeSim(): Promise<SimMeta> {
  const reply = await request({ type: 'describe' })
  if (reply.type !== 'meta') throw new SimError('Unexpected reply from the simulator.', false)
  return reply.meta
}

/** Run one command line (as the simulator's CLI takes it) and return its document. Commands queue. */
export async function runSim(argv: string[], onProgress?: (done: number, total: number) => void) {
  const reply = await request({ type: 'run', argv }, onProgress)
  if (reply.type !== 'done') throw new SimError('Unexpected reply from the simulator.', false)
  return { doc: reply.doc, text: reply.text, seconds: reply.seconds }
}

/** Stop everything in flight (a whole-cast run cannot be interrupted any other way). The next call starts afresh. */
export function stopSim(reason: Error = new SimError('Stopped.', true)) {
  worker?.terminate()
  worker = null
  for (const p of pending.values()) p.reject(reason)
  pending.clear()
}
