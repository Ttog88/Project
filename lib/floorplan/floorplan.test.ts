import { describe, expect, test } from "vitest";

import { GRID, createSampleLayout, placeFurniture, rasterize } from "@/lib/floorplan";

const closed = { A: 0, B: 0 } as const;
const open = { A: 1, B: 1 } as const;
const at = (solid: Uint8Array, x: number, y: number) => solid[y * GRID.nx + x];

describe("가상 평면도", () => {
  test("창문 2개가 서로 다른 외벽에 있다", () => {
    const { windows } = createSampleLayout();
    expect(windows).toHaveLength(2);
    expect(new Set(windows.map((w) => w.side)).size).toBe(2);
  });

  test("벽과 가구는 고체 셀이 되고 방문 틈은 비어 있다", () => {
    const layout = createSampleLayout();
    const { solid } = rasterize(layout, closed);
    expect(at(solid, 0, 0)).toBe(1);
    expect(at(solid, 24, 5)).toBe(1);
    expect(at(solid, 24, layout.door.y + 2)).toBe(0);
    const bed = layout.furniture.find((f) => f.id === "bed")!;
    expect(at(solid, bed.x + 1, bed.y + 1)).toBe(1);
  });

  test("창은 닫으면 벽이고, 열면 그 폭만큼 외벽이 뚫린다", () => {
    const layout = createSampleLayout();
    const a = layout.windows[0];
    const wallY = a.start + a.length / 2;
    expect(at(rasterize(layout, closed).solid, 0, wallY)).toBe(1);
    expect(at(rasterize(layout, open).solid, 0, wallY)).toBe(0);
    const widths = ([0, 0.5, 1] as const).map(
      (o) => rasterize(layout, { A: o, B: 0 }).openings[0].widthCells
    );
    expect(widths).toEqual([0, 8, 16]);
  });
});

describe("가구 편집", () => {
  test("가구를 옮기면 고체 영역도 따라 바뀐다", () => {
    const layout = createSampleLayout();
    const moved = placeFurniture(layout, "table", { x: 40, y: 28, w: 8, h: 6 });
    expect(at(rasterize(layout, closed).solid, 38, 20)).toBe(1);
    expect(at(rasterize(moved, closed).solid, 38, 20)).toBe(0);
    expect(at(rasterize(moved, closed).solid, 42, 30)).toBe(1);
  });

  test("크기를 바꿀 수 있고 허용 범위로 제한된다", () => {
    const layout = createSampleLayout();
    const bigger = placeFurniture(layout, "table", { x: 36, y: 18, w: 12, h: 8 });
    expect(bigger.furniture.find((f) => f.id === "table")).toMatchObject({ w: 12, h: 8 });
    const tiny = placeFurniture(layout, "table", { x: 36, y: 18, w: 0, h: 0 });
    expect(tiny.furniture.find((f) => f.id === "table")).toMatchObject({ w: 2, h: 2 });
  });

  test("실내 밖은 안쪽으로 맞추고, 안쪽 벽과 겹치면 변경하지 않는다", () => {
    const layout = createSampleLayout();
    const edge = placeFurniture(layout, "table", { x: 100, y: 100, w: 8, h: 6 });
    expect(edge.furniture.find((f) => f.id === "table")).toMatchObject({ x: 50, y: 34 });
    const blocked = placeFurniture(layout, "table", { x: 22, y: 5, w: 6, h: 4 });
    expect(blocked).toBe(layout);
  });
});
