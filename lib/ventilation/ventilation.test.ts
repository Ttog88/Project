import { describe, expect, test } from "vitest";

import { addFurniture, createSampleLayout, placeFurniture } from "@/lib/floorplan";
import {
  MEANINGFUL_DIFFERENCE,
  searchWindowCombinations,
  simulateVentilation,
  windPressure,
  type Conditions,
} from "@/lib/ventilation";

const westWind = (a: 0 | 0.5 | 1, b: 0 | 0.5 | 1, speed = 3): Conditions => ({
  windDirectionDeg: 270,
  windSpeed: speed,
  windowOpenness: { A: a, B: b },
});

describe("풍압", () => {
  test("바람을 정면으로 받는 창이 측면·풍하측 창보다 높다", () => {
    const west = { east: -1, north: 0 };
    const south = { east: 0, north: -1 };
    expect(windPressure(270, west)).toBeCloseTo(1);
    expect(windPressure(270, south)).toBeCloseTo(0);
    expect(windPressure(90, west)).toBeLessThan(0);
  });
});

describe("환기 계산", () => {
  const layout = createSampleLayout();

  test("서풍이면 서쪽 창으로 들어와 남쪽 창으로 나간다", () => {
    const r = simulateVentilation(layout, westWind(1, 1));
    expect(r.flow.inletId).toBe("A");
    expect(r.flow.outletId).toBe("B");
    expect(r.residual).toBeLessThan(1);
  });

  test("동풍이면 흐름 방향이 바뀐다", () => {
    const r = simulateVentilation(layout, { ...westWind(1, 1), windDirectionDeg: 90 });
    expect(r.flow.inletId).toBe("B");
    expect(r.flow.outletId).toBe("A");
  });

  test("창을 모두 닫거나 풍속이 0이면 흐름이 없고 잔류율이 100%이다", () => {
    expect(simulateVentilation(layout, westWind(0, 0)).residual).toBeCloseTo(1, 6);
    const calm = simulateVentilation(layout, westWind(1, 1, 0));
    expect(calm.residual).toBeCloseTo(1, 6);
    expect(calm.flow.inletId).toBeNull();
  });

  test("창을 더 열수록 잔류율이 낮아진다", () => {
    const half = simulateVentilation(layout, westWind(0.5, 0.5)).residual;
    const full = simulateVentilation(layout, westWind(1, 1)).residual;
    expect(full).toBeLessThan(half);
    expect(half).toBeLessThan(1);
  });

  test("벽과 가구 셀에는 유동이 없다", () => {
    const r = simulateVentilation(layout, westWind(1, 1));
    const { solid, u, v } = r.field;
    for (let c = 0; c < solid.length; c++) {
      if (solid[c]) {
        expect(u[c]).toBe(0);
        expect(v[c]).toBe(0);
        expect(r.weak[c]).toBe(0);
      }
    }
  });

  test("가구를 바꾸면 결과가 달라진다", () => {
    const moved = placeFurniture(layout, "table", { x: 26, y: 12, w: 10, h: 12 }).layout;
    const a = simulateVentilation(layout, westWind(1, 1));
    const b = simulateVentilation(moved, westWind(1, 1));
    expect(b.residual).not.toBeCloseTo(a.residual, 4);
  });

  test("환기가 안 되는 조건에서는 실내 전체가 취약 후보로 표시된다", () => {
    const r = simulateVentilation(layout, westWind(0, 0));
    expect(r.weakShare).toBeCloseTo(1, 6);
  });

  test("같은 입력은 같은 결과를 낸다", () => {
    const a = simulateVentilation(layout, westWind(0.5, 1));
    const b = simulateVentilation(layout, westWind(0.5, 1));
    expect(a.residual).toBe(b.residual);
  });
});

describe("창문 개방 조합 탐색", () => {
  const layout = createSampleLayout();

  test("9개 조합을 모두 계산해 잔류율이 낮은 순으로 정렬하고 상위 3개를 고른다", async () => {
    const progress: number[] = [];
    const outcome = await searchWindowCombinations(layout, westWind(0.5, 0), {
      onProgress: (done) => progress.push(done),
    });
    expect(outcome).not.toBeNull();
    const { entries, top, current } = outcome!;
    expect(entries).toHaveLength(9);
    expect(progress.at(-1)).toBe(9);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].result.residual).toBeGreaterThanOrEqual(entries[i - 1].result.residual);
    }
    expect(top).toHaveLength(3);
    expect(top[0].windowOpenness).toEqual({ A: 1, B: 1 });
    expect(current.windowOpenness).toEqual({ A: 0.5, B: 0 });
    expect(current.result.residual - top[0].result.residual).toBeGreaterThan(MEANINGFUL_DIFFERENCE);
  }, 60_000);

  test("두 창을 모두 닫은 조합은 잔류율이 가장 높다(통과 흐름이 없는 조합과 동률)", async () => {
    const outcome = await searchWindowCombinations(layout, westWind(1, 1));
    const closed = outcome!.entries.find((e) => e.windowOpenness.A === 0 && e.windowOpenness.B === 0)!;
    const highest = Math.max(...outcome!.entries.map((e) => e.result.residual));
    expect(closed.result.residual).toBeCloseTo(1, 6);
    expect(closed.result.residual).toBe(highest);
    // 한쪽 창만 열린 조합은 통과 흐름이 없어 같은 값이고, 유효한 조합은 모두 그보다 낮다.
    const flowing = outcome!.entries.filter((e) => e.windowOpenness.A > 0 && e.windowOpenness.B > 0);
    expect(flowing).toHaveLength(4);
    for (const e of flowing) expect(e.result.residual).toBeLessThan(closed.result.residual);
  }, 60_000);

  test("같은 입력으로 두 번 탐색하면 같은 순위와 잔류율이 나온다", async () => {
    const run = async () =>
      (await searchWindowCombinations(layout, westWind(1, 0.5)))!.entries.map((e) => [
        e.windowOpenness,
        e.result.residual,
      ]);
    expect(await run()).toEqual(await run());
  }, 120_000);
});

describe("가구 추가와 유동 계산", () => {
  test("가구를 추가하면 고체 셀 마스크와 유동 결과가 달라진다", () => {
    const layout = createSampleLayout();
    const added = addFurniture(layout, "shelf", { x: 30, y: 21 });
    expect(added.status).toBe("added");
    const before = simulateVentilation(layout, westWind(1, 1));
    const after = simulateVentilation(added.layout, westWind(1, 1));
    const maskDiff = before.field.solid.reduce((n, v, c) => n + (v !== after.field.solid[c] ? 1 : 0), 0);
    expect(maskDiff).toBe(6 * 12);
    expect(after.residual).not.toBeCloseTo(before.residual, 4);
    // 추가된 가구 위에는 유동이 없다.
    for (let c = 0; c < after.field.solid.length; c++) {
      if (after.field.solid[c]) {
        expect(after.field.u[c]).toBe(0);
        expect(after.field.v[c]).toBe(0);
      }
    }
  });
});
