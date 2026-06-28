# Striking Architecture — 3D Rig & Motion Specification

> Canonical definition of the kick's biomechanics and the adjustable parameters.
> Rewritten from Maxi's stage-by-stage walkthrough (the "heart of the app" pass).
> The parameter system (`src/kick/parameters.js`), the procedural overrides
> (`src/main.js`), and the launch model (`src/kick/animation.js`) implement
> against this document.
>
> **Status legend:** ✅ implemented · 🟡 partial / first-pass · ⬜ not yet built ·
> ❓ open question (see §Open questions).

---

## 0. Conventions

- **Sides.** Canonical kick is **right-footed**. Kicking leg = **RIGHT**, plant /
  support leg = **LEFT**. The **non-kicking foot IS the plant foot** — "toward the
  non-kicking foot" and "toward the planting foot" mean the **same** direction.
  Everything mirrors for a left-footer (`footedness`).
- **World.** Model faces the goal along **−Z**. Player's left = **−X**, right =
  **+X** (verified from shoulder positions). The ball sits at the origin.
- **Bone-local axes (verified).** Legs: local **X** = sagittal swing (+ = forward
  /flexion/plantarflex), local **Z** = lateral (ab/adduction). Hips: **Y** = yaw.
  Spine: **X** = forward bend, **Y** = axial twist, **Z** = lateral tilt.
  Arms: **Z** = abduction.
- **Timeline.** Normalized clip time `0 → 1`. The anchor is **contact `c`**
  (calibrated from the imported clip as the peak forward foot-speed, currently
  `c ≈ 0.38`). Stage boundaries are expressed as fractions of `c`.
- All numeric ranges are first-pass; tune against slow-motion footage.

---

## 1. Stage timeline (chronological)

| Stage | Window (× c) | One-line summary |
|---|---|---|
| **Pre-run-up** | `0 → 0.12c` | stance / hold |
| **Run-up** | `0.12c → 0.78c` | the strides, angled approach |
| **Recoil** (cock-back) | `0.78c → 0.92c` | wind + draw the leg back |
| **Hop** | end of recoil (`≈0.92c`) | small plant-hop, a few cm |
| **Kick** (whip) | `0.92c → c` | the strike |
| **Contact** | `c` | foot-point × ball-point (own sub-system) |
| **Follow-up** | `c → 1` | follow-through, slide, cross-over, land |

Sustained states span several stages: **Tilt**, **Lock Ankle**, **Lock Gaze**
(see §9).

---

## 2. Run-up  ✅🟡

| Element | Motion | Range / default | Status |
|---|---|---|---|
| Steps | procedural strides prepended to the clip | 1–5 (def 2) | ✅ `runupSteps` |
| **Approach angle** | diagonal vs the target line, toward the **plant** side | 0°–90° (def **45°**) | ✅ `runupAngle` |
| Stride length | match the imported clip's step | ~1.5 m | ✅ |
| Gait width | feet track close to a **single line** (thighs adducted) | narrow | 🟡 `add≈9°` |
| Spine | forward lean | 5°–10° | ✅ |
| Facing | faces travel direction, squares to goal over last⅓ for a seamless hand-off | — | ✅ |

> The run-up start is `steps × stride` behind the plant point, rotated by
> `runupAngle` toward the plant side. Right-footer → approaches from the left.

## 3. Aim Support (plant foot)  🟡

| Element | Motion | Range / default | Status |
|---|---|---|---|
| Lateral offset | plant foot to the **side** of the ball | **20 cm** | ✅ (calibrated) |
| Depth | toes level with the ball's **front edge** | toe at front edge | ✅ |
| Depth (tunable) | support-foot depth **behind** the ball → power/loft | 0–25 cm | 🟡 `aimSupportDepth` (affects launch only) |
| Support knee | flexion (loaded) | ~10° bent | ⬜ |
| Support toe | points at the goal | 0°–15° open | ⬜ |

## 4. Recoil — the cock-back  ✅

Peaks at the top of the backswing (`≈0.92c`), released by contact.

| Element | Motion | Range | Status |
|---|---|---|---|
| Pelvis | **winds toward the kicking foot** (pivot at the plant hip) | scales w/ recoil | ✅ |
| Kicking femur | pulls **back** (hip extension) | = `recoil` | ✅ |
| Kicking knee | **flexes** (cocks the lower leg) | `1.2 × recoil` | ✅ |

Param: **`recoil`** 0–60° (def 30). One slider; knee & pelvis scale off the
femoral backswing.

## 5. Hop  ⬜❓

A small hop, **no more than a few cm**, coinciding with the **end of recoil**.
When the hop ends, the kick begins. *(Vertical CoM rise vs. small forward gather —
see Open questions.)*

## 6. Kick — the whip  🟡

The strike, from end-of-recoil to contact. **Tilt is still active here.**

| Element | Motion | Status |
|---|---|---|
| **Lock ankle** | plantarflexion held rigid (instep presented) | ✅ `lockAnkle` 0–40° |
| **Whip** | kicking **femur drives forward** *and* **knee extends forward** simultaneously | 🟡 `whip` (knee only today; add hip drive) |
| **Pelvis** | **un-winds** — rotates back **toward the non-kicking/plant foot** (powers the strike, carries into follow-up) | ⬜ |
| **Torso counter-strike** | as the knee comes forward the **torso bends forward** over the ball — keeps the ball **down**, adds power | ⬜ new param |
| **Knee plumb vs ball** | the kicking knee's vertical plumb, **20 cm behind → 10 cm ahead** of the ball (behind = lofted, ahead = low) | 🟡 `kneeAim` (re-range to −20…+10 cm) |
| Tilt | whole-body lean still engaged | ✅ |

## 7. Contact — Points  🟡❓

Its own sub-system: **which part of the foot** meets **which part of the ball**.

| Param | Options (first-pass) | Effect |
|---|---|---|
| Foot zone | instep/laces · inside · outside · (toe?) | drive / curl / trivela |
| Ball zone | center · below-center (loft) · off-center/side (spin) | loft & spin |

Maps to launch elevation / azimuth / spin in `computeLaunch`. **Proposed:** a
contact annotation marking the exact foot-point and ball-point.

## 8. Follow-up  🟡

After contact you can **stop the foot at the ball (no follow-up)** or **continue**.
With a strong follow-up:

- the **plant foot leaves the ground** and **slides forward** (barely/not touching);
- the **kicking foot crosses** the planting foot;
- **landing** is on the **kicking foot first** (all weight on it) — with a weak
  follow-up the **planting foot** lands first;
- **hips rotate toward the planting foot, up to 90°**.

| Param | Motion | Range | Status |
|---|---|---|---|
| **Follow-up (angle / strength)** | *one coupled control*: ball leaves along the follow-through line toward the non-kicking foot **and** hips rotate toward the plant foot, leg crosses over, weight transfers | 0°–90° | 🟡 (ball azimuth + leg sweep done; cross-over, weight, plant-foot lift ⬜) |
| **Slippage (forward slide)** | plant foot slides forward during/after the strike | 0–1 m | ⬜ new param |

## 9. Sustained states

| State | Motion | When | Status |
|---|---|---|---|
| **Tilt** | whole-body **rigid lean toward the plant foot**, pivot at the plant foot | ramps end-of-run-up → peak at contact → vertical by end | ✅ `tilt` 0–30° |
| **Lock Ankle** | plantarflexion held | windup → through contact | ✅ |
| **Lock Gaze** | **eyes stay on the ball through contact and all the way until landing**; only after landing does the gaze rise toward the goal | run-up → landing | ⬜ |

> **Gaze consequence:** because the head stays locked on the ball while the body
> rotates toward the plant foot, the **shoulder axis keeps rotating** toward the
> plant foot through the follow-up. This is a *result*, not a separate control.

---

## 10. Master parameter list (the sliders)

| Param | Stage | Range / default | Status |
|---|---|---|---|
| `footedness` | all | right / left | ✅ |
| `runupSteps` | run-up | 1–5 (2) | ✅ |
| `runupAngle` | run-up | 0–90° (45) | ✅ |
| `aimSupportDepth` | plant | 0–25 cm (12) | 🟡 launch-only |
| `tilt` | sustained | 0–30° (15) | ✅ |
| `recoil` | recoil | 0–60° (30) | ✅ |
| `hipTurn` | recoil/kick | 0–60° (38) | ❓ likely folds into recoil + follow-up |
| `lockAnkle` | kick | 0–40° (25) | ✅ |
| `kneeAim` (knee plumb) | kick | **−20…+10 cm** | 🟡 re-range |
| `torsoBend` (counter-strike) | kick | new | ⬜ |
| `whip` (femur+knee drive) | kick | 0–1 (0.75) | 🟡 add hip drive |
| `footZone` × `ballZone` | contact | enums | 🟡 expand |
| `followUp` (angle/strength) | follow-up | 0–90° (0) | 🟡 |
| `slippage` (forward slide) | follow-up | 0–1 m | ⬜ |
| `followThrough` (power/control) | — | toggle | ❓ replace with `followUp` strength (0 = stop) |

---

## 11. Open questions

1. **Hop** — vertical CoM rise (stamp), or a small *forward* gather onto the
   plant foot? Fixed few-cm detail, or its own slider?
2. **Hip Turn** — now that the pelvis is stage-driven (winds in recoil, un-winds
   in the kick toward the plant foot, continues in follow-up), should the
   standalone `hipTurn` slider be **retired** (its job split between `recoil` and
   `followUp`), or kept as an independent "peak rotation magnitude"?
3. **Follow-up coupling** — is it truly **one** control that sets *both* the
   ball's azimuth *and* the body follow-through magnitude (cross-over, weight,
   hip rotation)? Or should **ball direction** and **follow-through strength** be
   two separate sliders that happen to share a default?
4. **Follow-Through toggle** — replace the power/control toggle with the
   continuous `followUp` strength (0 = stop foot at ball = control, high = power)?
5. **Torso counter-strike** — its own slider (degrees of forward bend at
   contact), and is it coupled to `whip`/power or independent?
6. **Contact zones** — expand foot (laces/instep/inside/outside/toe) and ball
   (center/under-for-loft/side-for-curl/under-for-chip)? Add the contact
   annotation (mark foot-point & ball-point)?

---

*Ranges are first-pass values to be validated against real slow-motion footage
(e.g. Caniggia vs. River, March 1992) via the planned pose-estimation pipeline.*
