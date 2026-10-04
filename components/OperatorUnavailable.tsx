export function OperatorUnavailable() {
  return <section className="p-6" aria-labelledby="connections-pending">
    <h1 id="connections-pending" className="text-xl font-semibold">Available after your connections are set up</h1>
    <p className="mt-3 text-sm text-os-muted">Your workspace is separate. Connected services are not available here yet.</p>
  </section>;
}
