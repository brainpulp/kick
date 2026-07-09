import * as THREE from 'three';

// The ball and a simple goal. The ball sits at the world origin; the player is
// positioned so the kicking foot meets it. Target line points toward -Z (goal).
export const BALL_RADIUS = 0.11; // ~22 cm regulation ball
export const GOAL_DISTANCE = 16; // m down the target line (-Z)

export function createField(scene) {
  // Ball: a proper soccer ball — classic black pentagons on white, drawn onto an
  // equirectangular canvas texture (pentagons placed at the 12 icosahedron
  // vertices). Reads instantly as a football and gives the surface real detail so
  // the contact point is legible.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 48, 36),
    new THREE.MeshStandardMaterial({ map: soccerTexture(), roughness: 0.42, metalness: 0.0 })
  );
  ball.position.set(0, BALL_RADIUS, 0);
  ball.castShadow = true;
  scene.add(ball);

  // Goal at -Z.
  const goal = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const postR = 0.06;
  const goalW = 7.32, goalH = 2.44; // regulation
  const mkPost = (x) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, goalH, 12), postMat);
    p.position.set(x, goalH / 2, 0);
    p.castShadow = true;
    return p;
  };
  goal.add(mkPost(-goalW / 2), mkPost(goalW / 2));
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, goalW, 12), postMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, goalH, 0);
  bar.castShadow = true;
  goal.add(bar);

  // Net: a faint translucent plane behind the frame.
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(goalW, goalH),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
  );
  net.position.set(0, goalH / 2, -0.6);
  goal.add(net);

  goal.position.set(0, 0, -GOAL_DISTANCE);
  scene.add(goal);

  // A thin target line on the pitch from ball to goal, for orientation.
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, GOAL_DISTANCE),
    new THREE.MeshBasicMaterial({ color: 0xddf3e2, transparent: true, opacity: 0.25 })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.002, -GOAL_DISTANCE / 2);
  scene.add(line);

  // Stationary reference markers — fixed cones on the pitch so the character's
  // locomotion (root travel) is easy to read against the world.
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7518, roughness: 0.6 });
  const mkCone = (x, z) => { // 20% smaller than before
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.096, 0.256, 16), coneMat);
    c.position.set(x, 0.128, z);
    c.castShadow = true;
    scene.add(c);
    return c;
  };
  // The two cones the player runs through by the end of the kick.
  mkCone(-1.2, 0.4);
  mkCone(1.2, 0.4);

  return { ball, goal };
}

// Procedural soccer-ball texture: white base + black pentagons at the icosahedron
// vertices, with faint seams. Equirectangular (u = longitude, v = latitude).
function soccerTexture() {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, W, H);

  // 12 icosahedron vertices in spherical coords (lon, lat).
  const verts = [[0, 90], [0, -90]];
  for (let i = 0; i < 5; i++) {
    const lon = i * 72;
    verts.push([lon, 26.565]);        // upper ring
    verts.push([lon + 36, -26.565]);  // lower ring (offset 36°)
  }
  const toXY = (lon, lat) => [((((lon % 360) + 360) % 360) / 360) * W, (0.5 - lat / 180) * H];

  // Pentagon (or its polar smear) at each vertex, drawn a few times across the
  // horizontal wrap so it survives the seam and the poles.
  for (const [lon, lat] of verts) {
    const rLat = (Math.abs(lat) > 80) ? 0.5 : 0.055;             // pole vs body radius (in v)
    const ry = rLat * H;
    const rx = Math.min(W * 0.16, ry / Math.max(0.18, Math.cos(lat * Math.PI / 180))); // counter equirect stretch
    for (const dx of [-W, 0, W]) {
      const [cx0, cy] = toXY(lon, lat); const cx = cx0 + dx;
      g.fillStyle = '#1b1b1b';
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + k * (2 * Math.PI / 5);
        const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.fill();
    }
  }
  // Faint seams (great-circle-ish) so the white panels read as panels, not blank.
  g.strokeStyle = 'rgba(120,120,120,0.25)'; g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    for (let x = 0; x <= W; x += 8) { const y = H / 2 + Math.sin((x / W) * Math.PI * 2 + i) * H * 0.18; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}
