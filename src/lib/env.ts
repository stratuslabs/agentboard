/**
 * Read a whole number from the environment, with a floor.
 *
 * `Number(process.env.X || fallback)` gets two cases wrong, and both fail
 * silently. `||` treats a deliberate `0` as unset, so a knob documented as
 * "set to 0 to switch it off" quietly keeps running at its default. `??`
 * fixes that but lets a typo through as `NaN`, and every comparison against
 * `NaN` is false — so `SSE_RECONCILE_MS=30s` disables the safety net it was
 * meant to configure.
 *
 * Anything unparseable or below `min` falls back, loudly enough to find in a
 * log and quietly enough not to take the process down over a typo.
 */
export function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    console.warn(
      `${name}="${raw}" is not an integer >= ${min}; using ${fallback} instead.`
    );
    return fallback;
  }
  return n;
}
