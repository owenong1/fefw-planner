// One of the pool of workers a whole-cast run (`all`, `classes`, `visuals`) is shared out over.
// The browser counterpart of the worker half of the simulator's cast.js.
import { unitJob } from './engine/castjob.js'
import { createContext } from './engine/search.js'
import type { CastReply, CastRequest } from './protocol'
import { loadSimData } from './rawData'

const data = loadSimData()
let ctx: ReturnType<typeof createContext>
let opts: unknown
let roles: string[] = []

self.onmessage = (e: MessageEvent<CastRequest>) => {
  const msg = e.data
  if (msg.type === 'init') {
    opts = msg.opts
    roles = msg.roles
    ctx = createContext(data, opts as object)
    return
  }
  let reply: CastReply
  try {
    reply = { type: 'done', job: unitJob(ctx, data.characters.get(msg.name), opts, roles) ?? { name: msg.name } }
  } catch (err) {
    reply = { type: 'error', name: msg.name, message: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(reply)
}
