// All page bodies use the root's existing width measurement, shared with the header.
// The body has no card-specific measurements or timers.
export function pageBodyLayout(width = 960) {
  // Thresholds concern usable body width, not chrome plus padding. Derive it
  // from the one root measurement; do not measure every card independently.
  const compact = width - 28 < 320, tight = width - 16 < 240;
  const padding = tight ? 6 : compact ? 8 : 14;
  const graphWidth = width - 2 * padding - (compact ? 8 + 14 : 20 + 32);
  return { compact, tight, graphHidden: graphWidth < 220, padding };
}
