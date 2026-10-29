import { describe, expect, test } from "vitest";

import {
  CELL_FLUID,
  CELL_OUTLET,
  CELL_SOLID,
  FlowSimulation,
  advanceParticles,
  createParticles,
  seededRandom,
  type FlowSetup,
} from "@/lib/flow";

/** 왼쪽에서 들어와 오른쪽으로 나가는 통로. 가운데에 장애물이 있다. */
function channel(inletSpeed: number): FlowSetup {
  const nx = 30;
  const ny = 12;
  const cellType = new Uint8Array(nx * ny);
  // 위·아래 벽
  for (let i = 0; i < nx; i++) {
    cellType[i] = CELL_SOLID;
    cellType[(ny - 1) * nx + i] = CELL_SOLID;
  }
  // 장애물
  for (let j = 3; j < 8; j++) for (let i = 12; i < 15; i++) cellType[j * nx + i] = CELL_SOLID;
  // 오른쪽 끝은 유출 셀, 왼쪽 끝은 유입
  for (let j = 1; j < ny - 1; j++) cellType[j * nx + nx - 1] = CELL_OUTLET;
  const tracked = new Uint8Array(nx * ny);
  const freshAirCells: number[] = [];
  const inletFaces = [];
  for (let j = 1; j < ny - 1; j++) {
    inletFaces.push({ axis: "u" as const, index: j * (nx + 1), value: inletSpeed });
    freshAirCells.push(j * nx);
    for (let i = 1; i < nx - 1; i++) {
      if (cellType[j * nx + i] === CELL_FLUID) tracked[j * nx + i] = 1;
    }
  }
  return { nx, ny, cellSize: 0.2, cellType, inletFaces, tracked, freshAirCells, dt: 0.2 };
}

describe("Stable Fluids Solver", () => {
  test("벽과 장애물 면의 속도는 계산 내내 정확히 0이다", () => {
    const setup = channel(1);
    const sim = new FlowSimulation(setup);
    sim.step(60);
    const { u, v } = sim.faceVelocities();
    const { nx, ny, cellType } = setup;
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const a = cellType[j * nx + i - 1];
        const b = cellType[j * nx + i];
        if (a === CELL_SOLID || b === CELL_SOLID) expect(u[j * (nx + 1) + i]).toBe(0);
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = cellType[(j - 1) * nx + i];
        const b = cellType[j * nx + i];
        if (a === CELL_SOLID || b === CELL_SOLID) expect(v[j * nx + i]).toBe(0);
      }
    }
  });

  test("유입이 있으면 추적 물질 잔류율이 줄고, 유입이 없으면 그대로이다", () => {
    const flowing = new FlowSimulation(channel(1));
    flowing.step(150);
    const withFlow = flowing.snapshot().residual;
    expect(withFlow).toBeLessThan(0.6);

    const still = new FlowSimulation(channel(0));
    still.step(150);
    expect(still.snapshot().residual).toBeCloseTo(1, 6);
  });

  test("잔류율은 시간이 지나도 늘지 않는다", () => {
    const sim = new FlowSimulation(channel(1));
    let previous = 1;
    for (let k = 0; k < 10; k++) {
      sim.step(10);
      const r = sim.snapshot().residual;
      expect(r).toBeLessThanOrEqual(previous + 1e-9);
      previous = r;
    }
  });

  test("같은 입력은 같은 결과를 낸다", () => {
    const run = () => {
      const sim = new FlowSimulation(channel(1));
      sim.step(80);
      return sim.snapshot();
    };
    const a = run();
    const b = run();
    expect(a.residual).toBe(b.residual);
    expect(Array.from(a.u)).toEqual(Array.from(b.u));
  });
});

describe("입자", () => {
  test("계산된 속도장을 따라 움직이되 고체 셀 안에는 들어가지 않는다", () => {
    const setup = channel(1);
    const sim = new FlowSimulation(setup);
    sim.step(80);
    const snap = sim.snapshot();
    const field = {
      nx: snap.nx,
      ny: snap.ny,
      u: snap.u,
      v: snap.v,
      solid: Uint8Array.from(setup.cellType, (t) => (t === CELL_SOLID ? 1 : 0)),
      cellSize: setup.cellSize,
    };
    const random = seededRandom(7);
    const particles = createParticles(field, 200, random);
    const startX = particles.reduce((s, p) => s + p.x, 0) / particles.length;
    for (let n = 0; n < 150; n++) {
      advanceParticles(field, particles, 1 / 60, 3, random);
      for (const p of particles) {
        const cell = Math.floor(p.y) * field.nx + Math.floor(p.x);
        expect(field.solid[cell]).toBe(0);
      }
    }
    const endX = particles.reduce((s, p) => s + p.x, 0) / particles.length;
    expect(endX).not.toBeCloseTo(startX, 1);
  });
});
