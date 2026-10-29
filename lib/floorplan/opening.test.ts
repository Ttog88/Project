import { describe, expect, test } from "vitest";

import {
  GRID,
  OPENNESS_LEVELS,
  OPENNESS_STEP_PERCENT,
  createSampleLayout,
  describeOpening,
  openCellsFor,
  rasterize,
} from "@/lib/floorplan";

const LENGTH = 16; // 기본 평면도의 창 A·B 길이(칸)

describe("개방률의 격자 적용", () => {
  test("0·5·25·50·75·100% 설정이 열린 칸 수와 적용 개방률로 바뀐다", () => {
    const expected = [
      // 설정, 열린 칸, 적용 %
      [0, 0, 0],
      [5, 1, 6], // 16 × 0.05 = 0.8 → 1칸 = 6.25%
      [25, 4, 25],
      [50, 8, 50],
      [75, 12, 75],
      [100, 16, 100],
    ] as const;
    for (const [setting, cells, applied] of expected) {
      const r = describeOpening(LENGTH, setting / 100);
      expect(r.settingPercent, `설정 ${setting}%`).toBe(setting);
      expect(r.openCells).toBe(cells);
      expect(r.appliedPercent).toBe(applied);
      expect(r.lengthCells).toBe(LENGTH);
      expect(r.widthMeters).toBeCloseTo(cells * GRID.cellMeters, 9);
    }
  });

  test("설정 55%는 9/16칸(1.5 m), 적용 56%로 구분된다", () => {
    const r = describeOpening(LENGTH, 0.55);
    expect(r.settingPercent).toBe(55);
    expect(r.openCells).toBe(9);
    expect(r.appliedPercent).toBe(56);
    expect(r.widthMeters).toBeCloseTo(1.5, 9);
  });

  test("서로 다른 설정이 같은 열린 칸 수가 되는 범위를 알려 준다", () => {
    // 길이 16칸: 10·15%는 2칸, 35·40%는 6칸, 60·65%는 10칸, 85·90%는 14칸
    for (const [from, to, cells] of [
      [10, 15, 2],
      [35, 40, 6],
      [60, 65, 10],
      [85, 90, 14],
    ] as const) {
      for (const p of [from, to]) {
        const r = describeOpening(LENGTH, p / 100);
        expect(r.openCells).toBe(cells);
        expect(r.sameSettings).toEqual({ fromPercent: from, toPercent: to });
      }
    }
    // 열린 칸 수가 하나뿐인 설정에는 안내가 없다.
    for (const p of [0, 5, 20, 25, 50, 55, 75, 95, 100]) {
      expect(describeOpening(LENGTH, p / 100).sameSettings, `${p}%`).toBeNull();
    }
  });

  test("짧은 창에서는 양수 설정도 0칸(닫힘)이 될 수 있고 그 범위를 알려 준다", () => {
    const r = describeOpening(4, 0.05);
    expect(r.openCells).toBe(0);
    expect(r.appliedPercent).toBe(0);
    expect(r.sameSettings).toEqual({ fromPercent: 0, toPercent: 10 });
  });

  test("열린 칸 수는 설정이 커질수록 줄지 않고 0부터 창 길이까지 이어진다", () => {
    let previous = 0;
    for (let p = 0; p <= 100; p += OPENNESS_STEP_PERCENT) {
      const cells = describeOpening(LENGTH, p / 100).openCells;
      expect(cells).toBeGreaterThanOrEqual(previous);
      expect(cells - previous).toBeLessThanOrEqual(2);
      previous = cells;
    }
    expect(previous).toBe(LENGTH);
  });

  test("자동 탐색의 단계(0·50·100%)는 서로 다른 열린 칸 수가 된다", () => {
    const cells = OPENNESS_LEVELS.map((level) => openCellsFor(LENGTH, level));
    expect(cells).toEqual([0, 8, 16]);
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe("rasterize와의 일치", () => {
  test("표시되는 열린 칸 수는 고체 마스크에 실제로 뚫리는 칸 수와 같다", () => {
    const layout = createSampleLayout();
    for (let p = 0; p <= 100; p += OPENNESS_STEP_PERCENT) {
      const plan = rasterize(layout, { A: p / 100, B: 0 });
      expect(plan.openings[0].widthCells, `${p}%`).toBe(describeOpening(LENGTH, p / 100).openCells);
      expect(plan.openings[0].outerCells).toHaveLength(plan.openings[0].widthCells);
    }
  });

  test("같은 열린 칸 수의 설정은 같은 고체 마스크를, 다른 칸 수는 다른 마스크를 만든다", () => {
    const layout = createSampleLayout();
    const mask = (a: number) => Array.from(rasterize(layout, { A: a, B: 0.5 }).solid);
    expect(mask(0.1)).toEqual(mask(0.15));
    expect(mask(0.35)).toEqual(mask(0.4));
    expect(mask(0.05)).not.toEqual(mask(0.1));
    expect(mask(0.15)).not.toEqual(mask(0.2));
  });

  test("기존 0·50·100% 개구부는 이전과 같은 폭이다", () => {
    const layout = createSampleLayout();
    const widths = ([0, 0.5, 1] as const).map((o) => rasterize(layout, { A: o, B: o }).openings.map((x) => x.widthCells));
    expect(widths).toEqual([
      [0, 0],
      [8, 8],
      [16, 16],
    ]);
  });
});
