// THE landmark schema (brief 18.1 Task 1): the one vocabulary of points the
// pipeline speaks. Estimator-specific indexing (MediaPipe 33, COCO-WholeBody
// 133) is mapped to THIS in the python worker; retarget, measured rest,
// cycles and distill consume only these names. Per point: [x, y, score]
// (image-normalized; score 0 = the estimator does not provide this point).
//
// L/R pairs are (2k+1, 2k+2) by construction — the worker's flip-TTA and
// any mirror logic swap pairs mechanically.

export const SCHEMA = [
  'nose',                      // 0
  'earL', 'earR',              // 1 2
  'shoulderL', 'shoulderR',    // 3 4
  'elbowL', 'elbowR',          // 5 6
  'wristL', 'wristR',          // 7 8
  'hipL', 'hipR',              // 9 10
  'kneeL', 'kneeR',            // 11 12
  'ankleL', 'ankleR',          // 13 14
  'heelL', 'heelR',            // 15 16
  'bigtoeL', 'bigtoeR',        // 17 18
  'smalltoeL', 'smalltoeR',    // 19 20
];

export const S = Object.fromEntries(SCHEMA.map((nm, i) => [nm, i]));
export const N_POINTS = SCHEMA.length;

// bones for skeleton drawing (explorer/QA)
export const SCHEMA_BONES = [
  [S.earL, S.earR], [S.nose, S.earL], [S.nose, S.earR],
  [S.shoulderL, S.shoulderR], [S.hipL, S.hipR],
  [S.shoulderL, S.hipL], [S.shoulderR, S.hipR],
  [S.shoulderL, S.elbowL], [S.elbowL, S.wristL],
  [S.shoulderR, S.elbowR], [S.elbowR, S.wristR],
  [S.hipL, S.kneeL], [S.kneeL, S.ankleL], [S.ankleL, S.heelL],
  [S.heelL, S.bigtoeL], [S.ankleL, S.bigtoeL],
  [S.hipR, S.kneeR], [S.kneeR, S.ankleR], [S.ankleR, S.heelR],
  [S.heelR, S.bigtoeR], [S.ankleR, S.bigtoeR],
];
