import * as THREE from 'three';

// The ball and a simple goal. The ball sits at the world origin; the player is
// positioned so the kicking foot meets it. Target line points toward -Z (goal).
export const BALL_RADIUS = 0.11; // ~22 cm regulation ball
export const GOAL_DISTANCE = 16; // m down the target line (-Z)

export function createField(scene) {
  // Ball: white sphere with a few dark pentagon-ish patches faked via a second
  // dotted material would be overkill; keep it clean and readable.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
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
