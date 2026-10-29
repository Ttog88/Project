import { CELL_SOLID } from "./solver";

export type VelocityField = {
  nx: number;
  ny: number;
  /** 셀 중심 속도(m/s) */
  u: Float32Array;
  v: Float32Array;
  /** 고체 셀이면 1 */
  solid: Uint8Array;
  cellSize: number;
};

export type Particle = { x: number; y: number; age: number };

/** 시드가 같으면 같은 순서의 수를 내는 간단한 난수 생성기(화면 재현성용). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function isSolid(field: VelocityField, x: number, y: number): boolean {
  const i = Math.floor(x);
  const j = Math.floor(y);
  if (i < 0 || j < 0 || i >= field.nx || j >= field.ny) return true;
  return field.solid[j * field.nx + i] === CELL_SOLID;
}

/** 셀 중심 속도를 쌍선형 보간한다. 고체 셀의 속도는 0으로 본다. */
export function sampleVelocity(field: VelocityField, x: number, y: number) {
  const { nx, ny } = field;
  const gx = Math.min(Math.max(x - 0.5, 0), nx - 1 - 1e-9);
  const gy = Math.min(Math.max(y - 0.5, 0), ny - 1 - 1e-9);
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gy);
  const fx = gx - i0;
  const fy = gy - j0;
  const lerp = (arr: Float32Array) =>
    (arr[j0 * nx + i0] * (1 - fx) + arr[j0 * nx + i0 + 1] * fx) * (1 - fy) +
    (arr[(j0 + 1) * nx + i0] * (1 - fx) + arr[(j0 + 1) * nx + i0 + 1] * fx) * fy;
  return { u: lerp(field.u), v: lerp(field.v) };
}

function spawn(field: VelocityField, random: () => number): Particle {
  for (let tries = 0; tries < 200; tries++) {
    const x = random() * field.nx;
    const y = random() * field.ny;
    if (!isSolid(field, x, y)) return { x, y, age: Math.floor(random() * 60) };
  }
  return { x: 1, y: 1, age: 0 };
}

export function createParticles(
  field: VelocityField,
  count: number,
  random: () => number
): Particle[] {
  return Array.from({ length: count }, () => spawn(field, random));
}

/**
 * 입자를 계산된 속도장을 따라 한 스텝 이동한다.
 * `timeScale`은 시각화를 위해 실제 시간보다 빠르게 보이게 하는 배율이다.
 * 이동 후 고체 셀에 들어가거나 수명이 다한 입자는 새 위치에서 다시 시작한다.
 */
export function advanceParticles(
  field: VelocityField,
  particles: Particle[],
  dtSeconds: number,
  timeScale: number,
  random: () => number
) {
  const k = (dtSeconds * timeScale) / field.cellSize;
  for (let n = 0; n < particles.length; n++) {
    const p = particles[n];
    const { u, v } = sampleVelocity(field, p.x, p.y);
    // 중간점 이동으로 벽 근처에서 한 번에 크게 건너뛰는 일을 줄인다.
    const mx = p.x + u * k * 0.5;
    const my = p.y + v * k * 0.5;
    const mid = isSolid(field, mx, my) ? { u, v } : sampleVelocity(field, mx, my);
    const nx = p.x + mid.u * k;
    const ny = p.y + mid.v * k;
    p.age++;
    if (isSolid(field, nx, ny) || p.age > 240) {
      particles[n] = spawn(field, random);
      particles[n].age = 0;
    } else {
      p.x = nx;
      p.y = ny;
    }
  }
}
