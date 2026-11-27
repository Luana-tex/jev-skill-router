export default function Loading() {
  return <div role="status" className="grid gap-4">
    <p>Loading local analytics…</p><div className="skeleton-block" aria-hidden="true" />
    <div className="metrics" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-block" key={index} />)}</div>
    <div className="skeleton-block" aria-hidden="true" />
  </div>;
}
