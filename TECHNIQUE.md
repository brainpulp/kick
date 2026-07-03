# TECHNIQUE.md — the pose-constraint architecture (the rethink)

> Status: PROPOSED — awaiting Maxi's approval. This replaces the "mocap clip +
> additive slider offsets" model as the source of truth for the kick.

## Why the current approach can't teach

Teaching a strike is millimetric: the coach specifies WHERE body parts must be
relative to the ball at specific moments. The current model can't do that:

- Every slider is a **relative nudge** ("rotate the femur +N° on top of the
  clip"). The result depends on what the clip was doing, so no parameter is
  ever an exact, verifiable position.
- Overrides stack and interact (recoil × whip × torso × tilt), so changing one
  changes the meaning of the others.
- The mocap actor's habits are baked in and non-negotiable — we can only
  distort them, which looks wrong and still isn't precise.

## The flip: poses are the truth, mocap is seasoning

The kick becomes a sequence of **checkpoints** — the moments a coach actually
teaches — each defined by **exact, ball-relative measurements**:

| # | Checkpoint    | ~clip time | Teaching constraints (all exact, in cm/deg) |
|---|---------------|-----------|----------------------------------------------|
| 1 | Approach      | 0.00–0.28 | last-stride length, approach angle, tempo |
| 2 | Plant         | 0.28      | plant toe: depth behind ball, lateral offset, toe yaw; knee flex; pelvis height |
| 3 | Backswing top | 0.33      | kicking thigh extension angle, knee flex (heel-to-butt), pelvis wind-up, trunk lean |
| 4 | **Contact**   | 0.375     | foot zone × ball zone (exact contact point), ankle lock angle, knee-plumb offset vs ball, hip line, trunk lean, gaze |
| 5 | Follow        | 0.50      | leg sweep height/direction, hip un-wind, shoulder line |
| 6 | Landing       | 0.70      | landing foot position, weight-transfer distance, body attitude |

Per frame at runtime, the pipeline is:

1. **Mocap layer** (optional, per-part, per-phase "influence" dial 0–100%) —
   supplies rhythm, weight, secondary motion.
2. **Constraint solver** — analytic two-bone IK for each leg (hip–knee–ankle;
   the knee pole vector IS the knee-plumb parameter), foot-orientation solve
   (toe yaw + ankle lock are absolute angles), pelvis/trunk chain solve (hip
   line, lean), head look-at (gaze). Solved EVERY frame to the interpolated
   checkpoint targets — so a parameter is **enforced**, not suggested.
3. **Timing** — the existing dopesheet drives the phase interpolation
   (checkpoint → checkpoint easing), so WHEN remains fully editable.

A parameter like "plant depth 12 cm" is then literally true — measurable in
the scene, annotatable ("valid range 5–20 cm"), and independent of every other
parameter. That is the property teaching needs.

## The editor (how Maxi authors technique)

- Scrub to a checkpoint → drag **3D handles** (plant-toe target, knee pole,
  hip line, trunk lean, contact point) directly in the scene; numbers update
  live; every value also editable as a number.
- **Save as a Technique Profile** (JSON): the full set of checkpoint values +
  timing. Profiles are the scenarios ("textbook instep drive", "Caniggia '92").
- Each checkpoint carries its **annotations** (label, valid range, camera) —
  the teaching layer reads straight from the constraint values.
- A live **measurement HUD** shows every teaching quantity at the current
  frame, with in/out-of-range coloring (the verification harness we already
  use headlessly, surfaced in the UI).

## What survives from today

- The rig, scene, ball flight, contact zones editor, dopesheet, view buttons,
  annotations layer — all reused.
- The mocap clip stays as the style layer (and as the default profile's
  starting values — we measure ITS checkpoint values and seed from them, so
  the default still looks like the natural kick).
- Slider names/definitions Maxi already specified map 1:1 onto checkpoint
  constraints — same vocabulary, now exact.

## Build order (each phase ships + deploys separately)

1. **Leg IK core** — analytic 2-bone IK both legs + foot orientation solve;
   plant-foot constraints (depth/lateral/yaw) and contact constraints
   (knee-plumb, ankle lock, contact point) enforced exactly; measured-from-clip
   defaults. *This alone delivers the millimetric control for the money
   moments (plant + contact).*
2. **Pelvis/trunk/gaze solve** — hip line, wind-up/un-wind, lean, look-at.
3. **Checkpoint editor** — draggable handles + numeric panel + profile
   save/load (replaces the current flat slider list, grouped by checkpoint).
4. **Measurement HUD + annotation ranges** per checkpoint.
5. **Profiles/scenarios** (then real kicks; later Supabase).

## Open decisions (Maxi)

- A: Default mocap influence — keep it high (looks natural, constraints
  correct it) or low (pure constraint pose, more "diagram-like")?
- B: Should checkpoints be editable only at their moment (simpler UI) or as an
  always-visible list (spreadsheet-style)?
- C: The character asset ("mannequin"): keep T-P for now, or invest in a
  higher-fidelity rigged model before the editor phase?
