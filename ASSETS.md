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

## Asset manifest (planned)

Maintain a thin `public/assets/manifest.json` mapping logical names to file
paths, e.g. `{ "character": "/assets/t-p.optimized.glb" }`, so loaders reference
logical names and we can relocate storage later by editing one file.
