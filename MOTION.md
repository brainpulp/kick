# Striking Architecture — 3D Rig & Motion Specification

> Source spec provided by Maxi (project owner). This is the canonical definition
> of the kick's biomechanics and the adjustable parameters. The app's parameter
> system (`src/kick/parameters.js`) and procedural animation
> (`src/kick/animation.js`) implement against this document.

## Rig mapping (spec joints → actual T-P bones)

The spec is written in anatomical terms. Our rig (`public/assets/t-p.glb`) uses
Mixamo-style `rig:` bone names. Mapping used by the animation code:

| Spec joint            | T-P bone(s)                                              | Notes |
|-----------------------|---------------------------------------------------------|-------|
| Pelvis (root)         | `rig:Hips`                                               | axial Y rotation + translation |
| Lumbar/thoracic spine | `rig:Spine`, `rig:Spine1`, `rig:Spine2`                  | lateral flexion, flexion, axial rotation (distribute across the 3) |
| Neck / head           | `rig:Neck`, `rig:Head`                                   | flexion (look down) |
| Shoulder L/R          | `rig:LeftArm` / `rig:RightArm`                           | upper-arm bone = glenohumeral joint (flex/abduct) |
| (clavicle)            | `rig:LeftShoulder` / `rig:RightShoulder`                 | minor; usually left at rest |
| Elbow L/R             | `rig:LeftForeArm` / `rig:RightForeArm`                   | flexion |
| Hip L/R               | `rig:LeftUpLeg` / `rig:RightUpLeg`                       | flex/extend, abduct, rotate |
| Knee L/R              | `rig:LeftLeg` / `rig:RightLeg`                           | flex/extend |
| Ankle L/R             | `rig:LeftFoot` / `rig:RightFoot`                         | plantar/dorsiflexion |
| Toe L/R               | `rig:LeftToeBase` / `rig:RightToeBase`                   | contact frame |

**Canonical motion:** right-footed instep drive. Kicking leg = RIGHT, support
leg = LEFT, counter arm = LEFT. Mirror for a left-footed kicker.

> NOTE: bone-local rotation axes depend on how the rig was authored. The
> animation code keeps per-bone axis/sign constants in one place so they can be
> tuned against the visual without touching the timeline logic.

---

## 0. Conventions

- **Angle convention:** 0° = anatomical neutral standing pose; flexion /
  extension / abduction measured as deviation from neutral.
- **Reference line:** the **target line** runs from the ball to its destination.
  Approach angle, foot orientation, and hip rotation are measured relative to it.
- All ranges are **proposed first-pass values** from general instep-kick
  biomechanics, to be validated against slow-motion footage (the forward half of
  the Kick Fingerprinting loop).

## ⚠️ List order ≠ strict timeline

The 13 pedagogical steps are a learning order, not chronological. For animation:
- **Hop** occurs at the end of the **Runup** (penultimate stride), before plant.
- **Lock Ankle / Tilt / Swing Arm / Lock Gaze** are *sustained states*.
- **Hip Turn → Whip → Points → Follow-Through** is one continuous chain.

See Section 14 for the chronological timeline used for keyframing.

---

## 1. Runup
| Joint / body | Motion | Proposed range |
|---|---|---|
| Whole body | Approach angle vs target line | 30°–45° diagonal |
| Whole body | Strides | 3–5 |
| Spine | Forward lean | 5°–10° |
| Hips/knees | Running gait | normal sprint |
| Penultimate stride | Lengthened for plant | ~110–130% normal |

## 2. Aim Support (plant foot)
| Joint / body | Motion | Proposed range |
|---|---|---|
| Support foot | Lateral offset from ball | 10–20 cm to the side |
| Support foot | Depth vs ball | level → 10–25 cm **behind** |
| Support foot | Toe vs target line | 0°–15° open |
| Support (L) knee | Flexion (loaded) | 15°–25° |
| Support (L) hip | Flexion | 10°–20° |

> Foot further behind ball → more hip rotation room → more power. Level/ahead →
> compact, low strike.

## 3. Tilt
| Joint / body | Motion | Proposed range |
|---|---|---|
| Spine | Lateral flexion away from kicking leg | 10°–20° |
| Head | Counter-tilts, stays level | 0°–10° |

## 4. Pre-Load (backswing)
| Joint / body | Motion | Proposed range |
|---|---|---|
| Kicking (R) hip | Extension (thigh back) | 20°–30° past neutral |
| Kicking (R) knee | Flexion (heel to glute) | 90°–110° |
| Pelvis | Counter-rotation (windup) | up to −15° |

## 5. Hip Turn
| Joint / body | Motion | Proposed range |
|---|---|---|
| Pelvis | Axial rotation toward target | 30°–45° |
| Kicking (R) hip | Begins flexion | −25° → +flexion |
| Spine | Mild axial counter then release | ±15° |

## 6. Swing Arm
| Joint / body | Motion | Proposed range |
|---|---|---|
| Counter (L) shoulder | Abduction | 45°–90° |
| Counter (L) shoulder | Extension | 10°–30° |
| Counter (L) elbow | Flexion | 20°–60° |
| Kicking-side (R) arm | Tucks as counterweight | shoulder ~0°–20°, back |

## 7. Lock Ankle (sustained through Points)
| Joint / body | Motion | Proposed range |
|---|---|---|
| Kicking (R) ankle | Plantarflexion (instep presented) | 20°–30° |
| Kicking (R) ankle | Rigidity at contact | locked, 0° during contact |

## 8. Knee Aim
| Joint / body | Motion | Proposed range |
|---|---|---|
| Kicking (R) knee | Horizontal pos at contact | over / ahead of ball center |
| Kicking (R) knee | Flexion as it passes ball | 20°–40° |
| Kicking (R) knee | Pointing direction | at target line |

> Knee over ball → low. Knee behind / leaning back → lofted.

## 9. Lock Gaze (sustained)
| Joint / body | Motion | Proposed range |
|---|---|---|
| Neck | Flexion (look at ball) | 15°–30° |
| Head | No yaw through contact | ~0° |

## 10. Points (contact event, 1–2 frames)
| Parameter | Description | Example values |
|---|---|---|
| Foot contact zone | Where on foot | instep/laces (drive), inside (curl), outside (trivela) |
| Ball contact point | Where on ball | center (power), below (lift), off-center (spin) |
| Foot–ball angle | Approach to ball surface | drive ~0° square; curl 20°–40° across |

## 11. Hop (during end of Runup)
| Joint / body | Motion | Proposed range |
|---|---|---|
| Whole body | CoM rise (penultimate stride) | 3–8 cm |
| Both knees | Synchronized flex→extend | rhythm beat |

## 12. Whip (acceleration)
| Joint / body | Motion | Proposed range |
|---|---|---|
| Kicking (R) knee | Rapid extension | 90°–110° → 10°–20° at contact |
| Kicking (R) knee | Peak angular velocity | just before/at contact |
| Kicking (R) hip | Continued flexion | toward 30°–45° |

## 13. Follow-Through
**Power variant**
| Joint / body | Motion | Proposed range |
|---|---|---|
| Kicking (R) hip | Continued flexion (thigh rises) | 40°–60° |
| Kicking (R) knee | Full extension then slight re-flex | →~0°, settle |
| Whole body | Lands on kicking foot, weight fwd | CoM fwd ~20–40 cm |
| Kicking foot | Travels past ball | finishes ahead of ball spot |

**Control / Precision variant**
| Joint / body | Motion | Proposed range |
|---|---|---|
| Kicking (R) knee | Extension halts near contact | ~30°–40° flexion |
| Whole body | Stays over support foot | minimal CoM travel |
| Foot toe direction | Points at target (steering) | aligned to target line |

---

## 14. Suggested Chronological Timeline (keyframing)

Normalized 0.0 → 1.0 where 1.0 = contact.

| t | Phase | Active steps |
|---|---|---|
| 0.00–0.55 | Approach | Runup (lean, gait, angle) |
| 0.55–0.70 | Penultimate stride | Hop |
| 0.70–0.80 | Plant | Aim Support, Tilt begins |
| 0.78–0.88 | Windup | Pre-Load (max backswing), Lock Ankle engages |
| 0.85–0.95 | Power transfer | Hip Turn, Swing Arm peaks |
| 0.90–0.99 | Drive | Whip (knee extends), Knee Aim, Lock Gaze held |
| 1.00 | Contact | Points (1–2 frames) |
| 1.00–1.30 | Recovery | Follow-Through (+ landing) |

---

## 15. Parameters exposed as rig "handles" (the sliders)

Highest-value adjustable parameters for the tuning system:

- **Aim Support** — support-foot depth (behind ↔ ahead) → ball height
- **Tilt** — lateral lean → ground clearance / lift
- **Hip Turn** — pelvic rotation magnitude → power
- **Knee Aim** — knee position over ball → low vs lofted
- **Lock Ankle** — plantarflexion angle → contact surface
- **Points** — foot zone × ball zone → spin / direction / power
- **Whip** — knee extension velocity → power
- **Follow-Through** — power vs control variant toggle

---

*All ranges are proposed first-pass values from general instep-kick
biomechanics, to be validated and tuned against real slow-motion footage via
pose estimation (the Kick Fingerprinting reverse pipeline).*
