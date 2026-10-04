// Extractor-convention FK over the rig rest geometry (bone LEAVING a joint
// rotates by that joint's accumulated theta) — the TABLE's ghost skeleton.
// Shared by engine-report, engine-fidelity and (inline copy) the engine
// explorer page. Position rung (19.2 review finding): theta-space ladders
// can read 0.05 while positions diverge — FK sign/pivot errors live here.
export function fkExt(th, rigJoints, rigParent) {
  const KIDS = {};
  for (const nm of Object.keys(rigParent)) (KIDS[rigParent[nm] ?? "_root"] ??= []).push(nm);
  const BONE_NAME = (p, c) => {
    if (p === "pelvis" && c === "chest") return "chest";
    if (p === "chest" && c === "neck") return "neck";
    if (/^(hip|knee|ankle|shoulder|elbow)[LR]$/.test(p) && !/^(hip|shoulder)/.test(c)) return p;
    return null;                                     // pelvis→hip etc: rigid
  };
  const out = {};
  const walk = (name, accIn) => {
    const j = rigJoints[name], p = rigParent[name];
    if (p == null) { out[name] = [j[0], j[1]]; for (const k of KIDS[name] ?? []) walk(k, 0); return; }
    const pj = rigJoints[p];
    const bn = BONE_NAME(p, name);
    const a = accIn + (bn ? (th[bn] ?? 0) : 0);
    const dx = j[0] - pj[0], dy = j[1] - pj[1];
    out[name] = [out[p][0] + dx * Math.cos(a) - dy * Math.sin(a),
                 out[p][1] + dx * Math.sin(a) + dy * Math.cos(a)];
    for (const k of KIDS[name] ?? []) walk(k, a);
  };
  for (const k of KIDS["_root"] ?? []) walk(k, 0);
  return out;
}

// pelvis-normalized position RMS between the table ghost and the engine's
// actual joints, per frame — shape units
export function posRms(frames, meta, posKey = "lockP") {
  const names = meta.jointNames;
  const pi = names.indexOf("pelvis");
  const perJoint = Object.fromEntries(names.map((n) => [n, 0]));
  for (const f of frames) {
    const ghost = fkExt(f.s1 ?? {}, meta.rigJoints, meta.rigParent);
    const g0 = ghost.pelvis ?? [0, 0];
    const e0 = f[posKey]?.[pi] ?? [0, 0];
    names.forEach((nm, i) => {
      const g = ghost[nm], e = f[posKey]?.[i];
      if (!g || !e) return;
      perJoint[nm] += ((g[0] - g0[0]) - (e[0] - e0[0])) ** 2 + ((g[1] - g0[1]) - (e[1] - e0[1])) ** 2;
    });
  }
  for (const nm of names) perJoint[nm] = Math.sqrt(perJoint[nm] / frames.length);
  const vals = Object.values(perJoint);
  return { perJoint, all: Math.sqrt(vals.reduce((a, v) => a + v * v, 0) / vals.length) };
}
