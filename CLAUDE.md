# kick — soccer striking 3D tutorial

> Project context and handoff notes. This file is auto-loaded by new Claude Code
> sessions. If you are a fresh session picking this up: read this whole file
> first, then read `ASSETS.md`. As of this writing **no application code exists
> yet** — only this documentation and the LICENSE. We are mid-setup, blocked on
> getting the character asset into the build environment (see "Current status").

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

## Current status / what's blocking

We are trying to get `T-P.glb` from Google Drive into the build environment.

- **Network is restricted by an egress allowlist.** Direct `curl` to
  `drive.google.com` returns 403 ("Host not in allowlist").
- Maxi added `drive.google.com` and `*.googleusercontent.com` to the **`kick`
  environment's** Network access (custom allowed domains).
- **BUT** network policy is locked in **at session start**, so the session where
  the change was made could not use it. **A NEW session in the `kick`
  environment is required** for the allowlist to take effect.
- The Google Drive MCP `download_file_content` tool returns base64 into context
  — impractical for an 18 MB binary. Use `curl` to disk instead.

### Immediate next steps for a fresh session

1. Confirm network works now:
   `curl -sS -o /dev/null -w "%{http_code}\n" https://drive.google.com`
   (expect non-403). If still 403, the allowlist didn't apply — tell Maxi; the
   fallback is to have him `git push` the GLB to the branch directly (no LFS,
   plain `git add -f T-P.glb` is acceptable to start).
2. Download the character:
   `curl -sSL -o tmp_assets/T-P.glb "https://drive.google.com/uc?export=download&id=1RKMW6fHW_aGvfqaptTmOUcu0vIpW6UGn"`
   (mkdir `tmp_assets` first). Verify it's a real GLB, not a 103-byte HTML
   denial page (`file` it; check size ~18 MB; magic bytes start with `glTF`).
3. Inspect the rig with `npx --yes @gltf-transform/cli inspect tmp_assets/T-P.glb`
   — report bones/skeleton, mesh count, materials, texture sizes, and whether
   any animation tracks already exist.
4. Optimize to a runtime asset in `public/assets/` (Draco + KTX2 + resize),
   report before/after size.
5. Report rig contents back to Maxi so we can **map the kick's adjustable
   parameters to specific bones / IK targets**.
6. Then scaffold the app (Vite + Three.js + `public/assets/` + asset manifest).

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
