# kick — soccer striking 3D tutorial

> Project context and handoff notes. This file is auto-loaded by new Claude Code
> sessions. If you are a fresh session picking this up: read this whole file
> first, then `MOTION.md` (the parameter spec), then `ASSETS.md`. The app is
> built and deploys to GitHub Pages; we are mid-way through defining every kick
> parameter with the owner (Maxi), one at a time.
>
> **Deploy policy (Maxi's standing rule): ALWAYS deploy directly — don't ask.**
> After pushing, open the PR (ready, not draft), then squash-merge it to `main`
> yourself so it deploys to GitHub Pages. Branch carries commits already
> squash-merged, so rebase first: `git rebase --onto origin/main <last-merged-sha>`,
> force-push with `--force-with-lease`, then merge.

## 🗂 Task workflow (Notion board — the source of truth)

Tasks live in the Notion DB **"Kick — Tasks"**:
https://app.notion.com/p/a0290648726c4551b6901818d5a74070
(data source id `7b208063-1f8d-422c-820f-8a1b246afcf1`). The old GitHub issue #31 is closed/retired.

**Status lifecycle (board columns):**
- **To do** — Maxi's build queue (he adds/curates).
- **In progress** — Claude is building it.
- **Done** — Claude shipped & deployed it → *awaiting Maxi's approval*.
- **Approved** — Maxi reviewed & signed off. **Maxi-only column — Claude never moves cards here.**
- **Needs rework** — Maxi rejected ("not good enough") → Claude redoes it.
- **Needs input** — Claude needs an answer before building.
- **Backlog** — later.

**Every turn, Claude:**
1. Reads the board first (fetch the DB / card pages; `query_data_sources` needs a paid plan, so fetch pages or rely on known IDs). Read **comments** on cards.
2. Works items in **To do** and **Needs rework** (by Priority), moving each **In progress → Done**.
3. Updates Status as it goes; never touches **Approved**.

**Questions:** ask in BOTH places — here in chat AND as a **comment on the relevant card** (and set it to **Needs input**). Maxi answers in either. Always re-read card comments; once a question is answered (in chat or Notion), **remove/resolve the Notion question** and move the card off Needs input.

> Note: the Notion MCP connection drops intermittently — reload the Notion tools via ToolSearch and retry.

## ✅ Live request checklist (keep this current; summarize done/missing every reply)

**Done & deployed**
- NATURAL BASE (important): every slider is now a DEVIATION from the clean mocap clip —
  all default to neutral (tilt/recoil/torso/whip/armSwing/runupAngle = 0), so the default
  animation IS the natural baked kick. The overrides were stacking on top of the clip and
  making it hunched/unnatural; now you tweak UP from a natural base. Autosave bumped to v2
  to drop old non-neutral saves. Lock-gaze & follow-body cross-over are opt-in (lock-gaze
  toggle; cross-over couples to Hip Turn, 0 at the neutral 38°).
- App + GitHub Pages deploy; headless preview loop (webm/screenshots).
- Mixamo clip ingest (retarget + root motion); ball launches at calibrated contact.
- Clean run-up (plays the clip's own baked run — no synthetic-jog skate).
- Lighting/turf/pitch lines/cones; 3D gizmos + body-axis lines (toggle).
- Per-control reset + reset-all; scenarios UI (local store).
- Parameters wired: Tilt, Recoil, Hop (forward skip, fixed), Whip (femur+knee+pelvis un-wind),
  Torso counter-strike, Knee-plumb range (−20…+10), Follow-up DIRECTION,
  Counter-arm (forward in run-up → back from end of recoil), Slippage (plant slide).
- Removed Follow-Through power/control dropdown AND Follow-up STRENGTH slider — the
  follow-through is always full now (cross-over always on); slippage is the one knob on top.
- ⏱ Timing editor (dopesheet: drag start/peak/end per effect).
- View buttons (Front/Side/Top/Default).
- Ball location fixed (anchors the KICKING foot to the ball at the true strike).
- Gaze annotation from the eyes → ball.
- Editing a parameter jumps the scrub to that parameter's moment.
- Foot-skate reduced (root-travel scale tuned so the planted foot stays put).
- Lock-gaze ANIMATION — head pinned to the ball through run-up until landing (~0.90), then releases.
- Follow-up BODY — the (always-full) follow-through turns the shoulders/hips toward the plant
  foot and swings the kicking leg up & ACROSS the midline (cross-over over the plant foot).

**Missing / not yet done**
- Run-up STEPS (1–5) + 45° approach ANGLE — controls exist but paused; need a dedicated
  run/locomotion clip (the kick clip can't supply variable straight/angled steps).
- Follow-up landing — literal weight transfer / landing on the kicking foot (player stays
  rooted; only the upper-body/leg cross-over is modelled, not a real forward step).
- Contact zones — expand foot/ball parts + a contact annotation marking foot-point × ball-point.
- Live tuning to confirm: pelvis un-wind direction, counter-arm extents, tilt direction, hop feel.
- Later: populate real-kick scenarios (e.g. Caniggia vs River '92); Supabase backend.

> As of this writing the character asset is in the repo and optimized
> (`public/assets/t-p.glb`); the old "blocked on asset" note below is historical.

## What we're building

A browser-based 3D app that **teaches soccer** by showing a rigged character
performing an action — initially **kicking a soccer ball toward a goal** — that
the user can study and modify.

The app has three core parts (the "graphical meat"):

1. **Animation parameter tuning** — the kick animation is driven by adjustable
   parameters (sliders) the user can change to see how technique affects the
   outcome (e.g. plant-foot distance, hip rotation, strike angle, follow-through,
   launch velocity/spin). The exact parameter list is **still to be defined by
   the project owner** (Maxi) — this is a key open input.
2. **3D annotations** — in-scene callouts that reveal those parameters and their
   valid ranges to the user (e.g. an arc showing the allowed strike-angle range,
   a label "Hip rotation: 30°–75°").
3. High enough visual fidelity to be clear and instructional (stylized is fine;
   photorealism is NOT a goal).

## Key decision: BROWSER, not Unreal Engine

We evaluated HTML/web vs Unreal Engine. **Decision: build it in the browser**
(it must be online / zero-install). Rationale:

- A single rigged character doing a kick, with annotations and a ball
  trajectory, is well within WebGL capability. It does not need Unreal's
  fidelity.
- Unreal would make it not-online (native build) or require expensive
  per-user GPU pixel-streaming servers — opposite of the goal.
- Browser = fast iteration, broad reach (incl. mobile), simple deploy.

### Planned tech stack (proposed, not yet scaffolded)

- **Three.js** for rendering and skeletal animation (Babylon.js was the
  alternative; Three.js chosen for ecosystem/familiarity).
- **Vite** as the build tool / dev server.
- **glTF/GLB** as the asset format. `GLTFLoader` + `AnimationMixer` for playback.
- **Annotations**: `CSS2DRenderer` for crisp HTML/CSS labels pinned to 3D points,
  plus in-scene geometry (arcs/arrows/angle wedges) for visualizing ranges.
- **Parameter tuning approach**: base kick animation (authored in Blender),
  with a handful of bones / IK targets driven at runtime by the tunable
  parameters; ball launch computed from projectile physics (optionally Magnus
  effect for curve). Hybrid of pre-baked clip + procedural overrides.
- **Deploy target**: a static host with CDN (Netlify is available in this
  environment's MCP set).

### Where the real difficulty lives

Not the rendering — the **rig and the animation authoring**. The kick animation
must be **created** (it does not exist yet). Quality of the rig + animation
matters more than engine choice. Budget effort there. Note: `.blend` files are
edited in Blender's GUI, which can't run interactively in a cloud session, but
Blender CAN be driven headless via Python scripts (add keyframes, constraints,
export GLB) IF Blender is installable in the container — verify when we get
there. Runtime parameter tuning (the sliders) happens in app code regardless.

## Assets

See `ASSETS.md` for full detail. Summary:

- The character is **"T-P"**, a rigged human model, provided by Maxi in a shared
  Google Drive folder in many formats (gltf, glb, fbx, blend, max, c4d, obj).
  The "73 MB" Maxi first mentioned was the whole folder of format exports of the
  **same** character, not multiple models.
- For the **web runtime** we use **`T-P.glb`** (~18 MB, self-contained).
- For **animation authoring** we keep **`T-P.blend`** (~16 MB) as the master.
- The 18 MB GLB is **too heavy to ship as-is**. Plan: optimize via
  `@gltf-transform/cli` (Draco geometry + KTX2 textures + texture resize) down
  to single-digit MB for the runtime asset. Keep the original as the "source".

### Asset storage strategy (decided)

- **Optimized runtime GLB** → committed to the repo under `public/assets/`
  (small enough for plain git, CDN-cacheable). Use a thin JSON asset manifest
  (logical name → path) so we can relocate later by editing one file.
- **Heavy master(s)** (original GLB, the .blend) → stay OUT of git. Live in
  Google Drive (and/or Supabase Storage if/when accounts/progress arrive).
- **Git LFS is NOT available** in this environment, and the git remote is a
  local proxy — do not rely on LFS.

## Current status

The character asset is **in the repo and optimized.** Asset blocker resolved.

- How the GLB got in: the Drive egress allowlist never took effect (still 403
  even in a fresh session), so Maxi uploaded `T-P.glb` to the branch via
  **GitHub's web Upload-files** UI (18.9 MB is under GitHub's 25 MB web limit).
  This session then pulled it from git — no Drive needed.
- Inspected + optimized in-session: **18.94 MB → 1.24 MB** runtime asset at
  `public/assets/t-p.glb` (Draco + WebP + 1024 resize). Rig (28 bones) intact.
  Full rig inventory and optimization details are in `ASSETS.md`.
- The raw 18.94 MB file is NOT kept in git; masters stay in Drive.

### Immediate next steps

1. **Get the parameter list from Maxi** (see Open inputs). This is the gate for
   both the animation authoring and the annotation design.
2. **Scaffold the app**: Vite + Three.js, load `public/assets/manifest.json` →
   `t-p.glb` via `GLTFLoader` + `DRACOLoader` (asset uses Draco + WebP). Scale
   the model up at load (bbox is tiny, ~0.0017 units). Add `OrbitControls`,
   lighting, ground/goal.
3. **Author the kick animation** on the existing 28-bone rig (no animation
   exists yet). Likely keyframe in Blender headless via Python, OR drive bones
   procedurally at runtime. Kicking leg = `rig:RightUpLeg/RightLeg/RightFoot/
   RightToeBase`; hips = `rig:Hips`; lean = `rig:Spine*`.
4. **Wire parameters → bones/IK** and build the **3D annotations** layer
   (`CSS2DRenderer` labels + in-scene arcs/wedges for ranges).

## Open inputs needed from Maxi (project owner)

- **The list of adjustable parameters** for the kick (name, what it affects,
  min/max/default). This drives both the rig mapping and the annotation layout.
  Maxi said he will provide this. NOT yet received.
- Confirmation the Drive allowlist actually applied (see blocking section).

## Environment notes / gotchas (learned the hard way)

- Working dir: `/home/user/kick`. Git remote is a local proxy
  (`local_proxy@127.0.0.1`), not GitHub directly.
- Develop on branch **`claude/beautiful-planck-id13up`**. Push there. After
  pushing, open a **draft PR** if none exists.
- Node v22 available. `@gltf-transform/cli` runs via `npx`.
- Git LFS NOT installed; do not use it.
- Network egress is allowlisted; custom domains are set per-environment and
  apply only to sessions started AFTER the change.
- Available MCP servers in this environment include: Google Drive (asset
  handoff), Netlify (deploy), Supabase (DB/Storage/Auth for future accounts),
  Notion, Miro, a Three.js viewer, and GitHub.
- Owner: Maxi (maxi.goldschwartz@gmail.com). Prefers minimal manual git/CLI
  fiddling — keep handoffs simple and do the heavy lifting in-session.

## Google Drive asset reference

Folder: https://drive.google.com/drive/folders/1GBxU0N1X0LfeySz2JTqRVyQ4AFOcGeJ7
See `ASSETS.md` for per-file IDs.
