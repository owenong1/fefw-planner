import { Link } from 'react-router'

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <div className="py-20 text-center">
      <h1 className="font-display text-3xl font-bold">No such {what}</h1>
      <p className="mt-2 text-muted">The link may be out of date.</p>
      <Link to="/" className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
        Back to home
      </Link>
    </div>
  )
}
