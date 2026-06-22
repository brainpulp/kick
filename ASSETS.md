# Assets

Source of truth for the character and related 3D assets. Heavy masters live in
Google Drive (and/or Supabase Storage later), NOT in git. Only the optimized
runtime asset(s) belong in this repo under `public/assets/`.

## Character: "T-P" (rigged human)

Provided by Maxi in a shared Google Drive folder, exported in many formats. All
formats are the **same character** — the early "73 MB" figure was the total of
all these exports, not multiple distinct models.

**Drive folder:**
https://drive.google.com/drive/folders/1GBxU0N1X0LfeySz2JTqRVyQ4AFOcGeJ7

| File         | Size     | Google Drive file ID                 | Use |
| ------------ | -------- | ------------------------------------ | --- |
| `T-P.glb`    | ~18.9 MB | `1RKMW6fHW_aGvfqaptTmOUcu0vIpW6UGn`  | **RUNTIME source** — self-contained (geometry + textures + rig). Download this, optimize it, commit the optimized result. |
| `T-P.blend`  | ~16.9 MB | `1hfRLTD4ASaYZpa1HrUXQWS6YIRlSoiyy`  | **ANIMATION authoring master** — where the kick animation gets created in Blender, then re-exported to GLB. |
| `T-P.gltf`   | ~25.3 MB | `1PdIUVNxgBo8luAT0GlIB8AlF1e7vbepi`  | Same as GLB but split (needs `textures/`). Redundant — skip. |
| `T-P.FBX`    | ~18.9 MB | `1UAUuuyeFlSIxJYTxw-Fld914M8EcxNj8`  | Alt interchange. Not needed unless a tool requires it. |
| `T-P.obj`    | ~6.6 MB  | `1CT1u7GmnOa2r04enTKFMGZoUln15E5-u`  | Unrigged geometry. Ignore. |
| `T-P.mtl`    | ~2.8 KB  | `1hB5TI-E0bzetZfj-pNTJlLSvYl1E0W8T`  | OBJ materials. Ignore. |
| `T-P.max`    | ~9.4 MB  | `11Lyjiz4gnYm3MCm2mzGXd8mwoYiKUukX`  | 3ds Max source. Ignore for web. |
| `T-P.c4d`    | ~8.8 MB  | `1KygBJu97Te39WlmULDVbEALeYMy6N9Bk`  | Cinema 4D source. Ignore for web. |
| `textures/`  | folder   | `1pX73eoDwHSjeP2-_6czaVfHioXhNDh8x`  | Textures for the split `.gltf`. Only needed if using the gltf variant. |

### Downloading a Drive file by ID (curl, to disk)

Requires the env network allowlist to include `drive.google.com` and
`*.googleusercontent.com`, AND the session to have been started AFTER that
allowlist change.

```bash
mkdir -p tmp_assets
curl -sSL -o tmp_assets/T-P.glb \
  "https://drive.google.com/uc?export=download&id=1RKMW6fHW_aGvfqaptTmOUcu0vIpW6UGn"
# verify: real GLB starts with ascii "glTF"; ~18 MB; NOT a ~103-byte HTML page
file tmp_assets/T-P.glb
```

Do NOT use the Google Drive MCP `download_file_content` for this — it returns
base64 into the model context, which is impractical for an 18 MB binary.

## Optimization pipeline (planned)

The 18 MB runtime GLB is too heavy to ship. Optimize before committing:

```bash
npx --yes @gltf-transform/cli inspect tmp_assets/T-P.glb   # see what's inside
# typical optimization (tune flags after inspecting):
#  - Draco or Meshopt geometry compression
#  - KTX2 / Basis texture compression (usually the biggest win)
#  - resize textures (1K–2K is plenty for an instructional character)
```

Target: single-digit MB. Commit the optimized GLB to `public/assets/`, keep the
original 18 MB GLB as the master in Drive (not git).

## Asset manifest

`public/assets/manifest.json` maps logical names to file paths so loaders
reference logical names and we can relocate storage later by editing one file.
Current: `{ "character": "/assets/t-p.glb" }`. (In Vite, `public/` is served at
the web root, so `public/assets/t-p.glb` is fetched as `/assets/t-p.glb`.)

## Rig inventory (from the actual T-P.glb)

Inspected the real asset. Findings that drive the kick animation + parameters:

- **Format**: glTF 2.0, exported from Blender (Khronos glTF Blender I/O v1.4.40).
- **Mesh**: single skinned mesh, 8 primitives (one per material), ~66.9k verts.
- **Materials (8)**: `Arms & Hands`, `hair`, `eyelashes`, `eyes`, `face`,
  `Kit` (jersey, has normal map), `Legs`, `Boots` (has normal map). A complete
  uniformed soccer player.
- **Animations**: NONE. The kick must be authored from scratch.
- **Scale gotcha**: scene bbox is tiny (~0.0017 units tall) — the model is
  exported at a very small scale. Scale it up at runtime (or fix in Blender).
- **Skeleton**: 1 skin, **28 bones**, standard humanoid (`rig:` prefix,
  Mixamo-style names):

  ```
  rig:Hips
   ├─ rig:Spine ─ rig:Spine1 ─ rig:Spine2
   │   ├─ rig:Neck ─ rig:Head
   │   ├─ rig:LeftShoulder ─ LeftArm ─ LeftForeArm ─ LeftHand ─ (Index1..3)
   │   └─ rig:RightShoulder ─ RightArm ─ RightForeArm ─ RightHand ─ (Index1..3)
   ├─ rig:LeftUpLeg ─ LeftLeg ─ LeftFoot ─ LeftToeBase
   └─ rig:RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase
  ```

  Bones most relevant to a kick: `rig:Hips` (hip rotation), `rig:Spine/1/2`
  (lean / follow-through), `rig:RightUpLeg → RightLeg → RightFoot → RightToeBase`
  (kicking leg; `Left*` for the plant leg, mirror for a left-footed kick).

## Optimization result (done)

Ran `@gltf-transform/cli optimize` (Draco geometry + WebP textures + resize to
1024) producing the runtime asset committed at `public/assets/t-p.glb`:

- **18.94 MB → 1.24 MB** (~15× smaller).
- Textures: 9 images, all → WebP at ≤1024px (several were 2048²).
- Geometry: Draco-compressed; weld+simplify trimmed verts ~66.9k → ~51.3k.
- Rig preserved: skin + 28 bones + skinning attributes (`JOINTS_0`/`WEIGHTS_0`)
  intact.
- Uses extensions `EXT_texture_webp` + `KHR_draco_mesh_compression` — Three.js
  needs `DRACOLoader` wired into `GLTFLoader`, and WebP is supported by all
  current target browsers.

The **raw 18.94 MB `T-P.glb`** is NOT kept in git (it lived briefly on the
branch via web upload to bootstrap this step). The master originals remain in
Google Drive (see table above). Re-optimize from Drive if the source changes.
