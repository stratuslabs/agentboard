// A page of the consumer's own at the top level, the way a hosted edition has
// /signup and /billing. instrumentation.ts reserves its path, so no
// organization can take the slug and be shadowed by it.
export default function AccountPage() {
  return <main>Account</main>;
}
