// Which table and which shapes does `npm run move` judge? (pure, testable)
// capture emits BOTH views (profile primary + -front); one of them is the
// natural capture, the other a reinterpretation. The engine report must
// play the NATURAL table on a body of the SAME view — a front table forced
// onto biped-1 while tagged profile makes the engine switch to the profile
// body (basic_kick_1, 2026-10-13).
export const SHAPES_FOR_VIEW = { front: ["biped-1", "biped-2"], profile: ["biped-profile"] };

/**
 * @param sourceView  view from the clip's MOTION_SOURCES line, or null
 * @param tables      [{ name, view, reinterpreted }] candidates that exist
 * @param shapeOverride  --shape value, or null
 * @returns { table, view, shapes, why }
 */
export function resolveMove(sourceView, tables, shapeOverride = null) {
  const natural = tables.filter((t) => !t.reinterpreted);
  let pick = null, why;
  if (sourceView && natural.some((t) => t.view === sourceView)) {
    pick = natural.find((t) => t.view === sourceView);
    why = `MOTION_SOURCES says view: ${sourceView}, and ${pick.name} is the natural (non-reinterpreted) ${sourceView} table`;
  } else if (natural.length) {
    pick = natural[0];
    why = `${pick.name} is the natural capture (the other is reinterpreted)${sourceView ? ` — MOTION_SOURCES view: ${sourceView} had no matching natural table` : ""}`;
  } else {
    pick = tables[0];
    why = `no natural table found — fell back to ${pick?.name}`;
  }
  const view = pick?.view === "profile" ? "profile" : "front";
  const shapes = shapeOverride ? [shapeOverride] : SHAPES_FOR_VIEW[view];
  why += shapeOverride ? `; --shape ${shapeOverride} overrides` : `; ${view} table → ${shapes.join(" + ")}`;
  return { table: pick?.name, view, shapes, why };
}
