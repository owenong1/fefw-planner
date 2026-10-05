/** One piece of a command's output. The terminal prints these as text; SimDoc renders them. */
export type Block =
  | { t: 'text'; text: string; /** Only makes sense in a terminal (names a follow-up command line). */ cli?: boolean }
  | { t: 'table'; cols: { h: string; right: boolean }[]; rows: string[][] }
  | { t: 'file'; name: string; text: string }

/** What the form needs to offer every option (commands.js `describe`). */
export type SimMeta = {
  units: { name: string; level: number; class: string; joinsAt: string | null }[]
  classes: { name: string; tier: string }[]
  roles: { id: string; label: string }[]
  routes: string[]
  checkpoints: { id: string; label: string }[]
  defaults: { runs: number; maxGap: number; detours: number; top: number }
}

export type Request = { id: number; type: 'describe' } | { id: number; type: 'run'; argv: string[] }

export type Reply =
  | { id: number; type: 'meta'; meta: SimMeta }
  | { id: number; type: 'progress'; done: number; total: number }
  /** `text` is the document exactly as the simulator's terminal front end prints it. */
  | { id: number; type: 'done'; doc: Block[]; text: string; seconds: number }
  /** `usage` marks a mistake in the command (unknown unit, bad option) as opposed to a crash. */
  | { id: number; type: 'error'; message: string; usage: boolean }

/** Coordinator → cast worker. */
export type CastRequest = { type: 'init'; opts: unknown; roles: string[] } | { type: 'job'; name: string }
/** Cast worker → coordinator: unitJob()'s result, or { name } alone when the unit has no chapter in range. */
export type CastReply = { type: 'done'; job: { name: string } } | { type: 'error'; name: string; message: string }
