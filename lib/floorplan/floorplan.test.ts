import { describe, expect, test } from "vitest";

import {
  GRID,
  addFurniture,
  checkPlacement,
  createSampleLayout,
  placeFurniture,
  rasterize,
  removeFurniture,
  type Layout,
} from "@/lib/floorplan";

const closed = { A: 0, B: 0 } as const;
const open = { A: 1, B: 1 } as const;
const at = (solid: Uint8Array, x: number, y: number) => solid[y * GRID.nx + x];
const find = (layout: Layout, id: string) => layout.furniture.find((f) => f.id === id)!;

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

  test("처음 배치된 가구는 모두 유효한 위치이다", () => {
    const layout = createSampleLayout();
    for (const f of layout.furniture) {
      expect(checkPlacement(layout, f, f.id)).toEqual({ ok: true });
    }
  });
});

describe("가구 이동·크기 변경: 유효한 경우", () => {
  test("빈 공간으로 옮기면 이동하고 고체 영역도 따라 바뀐다", () => {
    const layout = createSampleLayout();
    const result = placeFurniture(layout, "table", { x: 40, y: 28, w: 8, h: 6 });
    expect(result.status).toBe("moved");
    expect(find(result.layout, "table")).toMatchObject({ x: 40, y: 28 });
    expect(at(rasterize(layout, closed).solid, 38, 20)).toBe(1);
    expect(at(rasterize(result.layout, closed).solid, 38, 20)).toBe(0);
    expect(at(rasterize(result.layout, closed).solid, 42, 30)).toBe(1);
  });

  test("빈 공간에서 크기를 바꾸면 그대로 반영된다", () => {
    const layout = createSampleLayout();
    const result = placeFurniture(layout, "table", { x: 36, y: 18, w: 12, h: 8 });
    expect(result.status).toBe("moved");
    expect(find(result.layout, "table")).toMatchObject({ w: 12, h: 8 });
  });

  test("같은 값이면 바뀌지 않는다", () => {
    const layout = createSampleLayout();
    const result = placeFurniture(layout, "table", find(layout, "table"));
    expect(result.status).toBe("unchanged");
    expect(result.layout).toBe(layout);
  });

  test("다른 가구와 경계만 맞닿는 것은 허용한다", () => {
    const layout = createSampleLayout();
    // 소파(x 28~41, y 5~10) 바로 아래(y=11)와 바로 옆(x=42)에 맞닿게 놓는다.
    const below = placeFurniture(layout, "table", { x: 30, y: 11, w: 8, h: 6 });
    expect(below.status).toBe("moved");
    const beside = placeFurniture(layout, "table", { x: 42, y: 5, w: 6, h: 6 });
    expect(beside.status).toBe("moved");
  });

  test("벽과 맞닿는 것도 허용한다", () => {
    const layout = createSampleLayout();
    // 안쪽 벽(x=24)과 외벽(y=2)에 닿는 위치
    expect(placeFurniture(layout, "desk", { x: 18, y: 2, w: 6, h: 4 }).status).toBe("moved");
  });
});

describe("가구 이동·크기 변경: 거부", () => {
  test("다른 가구와 겹치는 위치로는 이동할 수 없고 마지막 유효 상태가 유지된다", () => {
    const layout = createSampleLayout();
    const result = placeFurniture(layout, "table", { x: 30, y: 6, w: 8, h: 6 });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("furniture");
    expect(result.layout).toBe(layout);
    expect(find(result.layout, "table")).toMatchObject({ x: 36, y: 18 });
  });

  test("벽과 겹치는 위치로는 이동할 수 없다", () => {
    const layout = createSampleLayout();
    const inner = placeFurniture(layout, "table", { x: 22, y: 5, w: 6, h: 4 });
    expect(inner.status).toBe("rejected");
    expect(inner.reason).toBe("wall");
    expect(inner.layout).toBe(layout);
  });

  test("아파트 바깥 영역으로는 이동할 수 없다", () => {
    const layout = createSampleLayout();
    for (const rect of [
      { x: 100, y: 100, w: 8, h: 6 },
      { x: -3, y: 2, w: 8, h: 6 },
      { x: 52, y: 20, w: 8, h: 6 },
      { x: 20, y: 38, w: 8, h: 6 },
    ]) {
      const result = placeFurniture(layout, "table", rect);
      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("outside");
      expect(result.layout).toBe(layout);
    }
  });

  test("방문 개구부와 창문 개구부를 침범할 수 없다", () => {
    const layout = createSampleLayout();
    const door = placeFurniture(layout, "table", { x: 23, y: 20, w: 3, h: 3 });
    expect(door).toMatchObject({ status: "rejected", reason: "opening" });
    // 창 A는 서쪽 외벽(x 0~1, y 14~29), 창 B는 남쪽 외벽(x 34~49, y 40~41)
    const windowA = placeFurniture(layout, "table", { x: 0, y: 18, w: 4, h: 4 });
    expect(windowA).toMatchObject({ status: "rejected", reason: "opening" });
    const windowB = placeFurniture(layout, "table", { x: 38, y: 38, w: 4, h: 4 });
    expect(windowB).toMatchObject({ status: "rejected", reason: "opening" });
  });

  test("크기를 키우다가 다른 가구·벽·개구부와 겹치면 감지한다", () => {
    const layout = createSampleLayout();
    // 식탁(x 36~43, y 18~23)을 위쪽(y 8)부터 키우면 소파(y 5~10)와 겹친다.
    const intoSofa = placeFurniture(layout, "table", { x: 36, y: 8, w: 8, h: 16 });
    expect(intoSofa).toMatchObject({ status: "rejected", reason: "furniture" });
    // 책상(x 16~21, y 4~7)을 오른쪽으로 키우면 안쪽 벽(x=24)과 겹친다.
    const intoWall = placeFurniture(layout, "desk", { x: 16, y: 4, w: 10, h: 4 });
    expect(intoWall).toMatchObject({ status: "rejected", reason: "wall" });
    // 침대를 아래로 키우면 옷장과 겹친다(침대 y 4~17, 옷장 y 32~35).
    const intoWardrobe = placeFurniture(layout, "bed", { x: 4, y: 4, w: 10, h: 30 });
    expect(intoWardrobe).toMatchObject({ status: "rejected", reason: "furniture" });
    // 식탁을 왼쪽으로 키워 방문 개구부(x=24, y 18~25)까지 닿으면 침범으로 본다.
    const intoDoor = placeFurniture(layout, "table", { x: 22, y: 18, w: 22, h: 6 });
    expect(intoDoor).toMatchObject({ status: "rejected", reason: "opening" });
  });

  test("허용 크기를 벗어나는 변경은 거부한다", () => {
    const layout = createSampleLayout();
    expect(placeFurniture(layout, "table", { x: 36, y: 18, w: 1, h: 6 })).toMatchObject({
      status: "rejected",
      reason: "size",
    });
    expect(placeFurniture(layout, "table", { x: 36, y: 18, w: 8, h: 31 })).toMatchObject({
      status: "rejected",
      reason: "size",
    });
  });

  test("이동과 크기 변경은 같은 판정을 쓴다", () => {
    const layout = createSampleLayout();
    const table = find(layout, "table");
    const cases = [
      { ...table, x: 30, y: 6 }, // 이동만
      { ...table, y: 8, h: 16 }, // 크기 변경만
      { ...table, x: 22, w: 22 }, // 이동 + 크기 변경
      { ...table, x: 40, y: 28 }, // 유효한 이동
      { ...table, w: 12, h: 8 }, // 유효한 크기 변경
    ];
    for (const rect of cases) {
      const check = checkPlacement(layout, rect, "table");
      const result = placeFurniture(layout, "table", rect);
      if (check.ok) expect(result.status).toBe("moved");
      else expect(result).toMatchObject({ status: "rejected", reason: check.reason });
    }
  });
});

describe("가구 추가", () => {
  test("빈 공간에 새 가구가 추가되고 고유 ID가 붙는다", () => {
    const layout = createSampleLayout();
    const result = addFurniture(layout, "desk");
    expect(result.status).toBe("added");
    if (result.status !== "added") return;
    expect(result.layout.furniture).toHaveLength(layout.furniture.length + 1);
    expect(result.furniture.id).toBe("desk-2");
    expect(layout.furniture.some((f) => f.id === result.furniture.id)).toBe(false);
    expect(checkPlacement(layout, result.furniture)).toEqual({ ok: true });
  });

  test("같은 종류를 여러 번 추가해도 ID가 겹치지 않는다", () => {
    let layout = createSampleLayout();
    for (let i = 0; i < 3; i++) {
      const result = addFurniture(layout, "desk");
      expect(result.status).toBe("added");
      layout = result.layout;
    }
    const ids = layout.furniture.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["desk-2", "desk-3", "desk-4"]));
  });

  test("지정한 위치에 추가하면 그 점이 가구의 중앙이 된다", () => {
    const layout = createSampleLayout();
    const result = addFurniture(layout, "table", { x: 50, y: 30 });
    expect(result.status).toBe("added");
    if (result.status !== "added") return;
    expect(result.furniture).toMatchObject({ x: 46, y: 27, w: 8, h: 6 });
  });

  test("지정한 위치가 유효하지 않으면 추가하지 않는다", () => {
    const layout = createSampleLayout();
    const onFurniture = addFurniture(layout, "table", { x: 34, y: 8 });
    expect(onFurniture).toMatchObject({ status: "rejected", reason: "furniture" });
    expect(onFurniture.layout).toBe(layout);
    const outside = addFurniture(layout, "table", { x: 1, y: 1 });
    expect(outside).toMatchObject({ status: "rejected", reason: "outside" });
  });

  test("공간이 부족하면 추가를 거부하고 배치는 그대로이다", () => {
    let layout = createSampleLayout();
    let added = 0;
    // 가장 큰 가구(침대)로 실내를 가득 채운다.
    for (;;) {
      const result = addFurniture(layout, "bed");
      if (result.status === "rejected") {
        expect(result.reason).toBe("nospace");
        expect(result.layout).toBe(layout);
        break;
      }
      layout = result.layout;
      added++;
      expect(added).toBeLessThan(60);
    }
    expect(added).toBeGreaterThan(0);
  });

  test("추가한 가구는 고체 셀 마스크에 반영되고, 기존 가구처럼 이동·크기 변경이 가능하다", () => {
    const layout = createSampleLayout();
    const added = addFurniture(layout, "shelf", { x: 50, y: 30 });
    expect(added.status).toBe("added");
    if (added.status !== "added") return;
    const f = added.furniture;
    const before = rasterize(layout, closed).solid;
    const after = rasterize(added.layout, closed).solid;
    expect(at(before, f.x + 1, f.y + 1)).toBe(0);
    expect(at(after, f.x + 1, f.y + 1)).toBe(1);

    const moved = placeFurniture(added.layout, f.id, { ...f, x: f.x - 6 });
    expect(moved.status).toBe("moved");
    const resized = placeFurniture(moved.layout, f.id, { ...find(moved.layout, f.id), w: 8 });
    expect(resized.status).toBe("moved");
    expect(find(resized.layout, f.id).w).toBe(8);
    // 겹치는 위치로는 추가된 가구도 갈 수 없다.
    expect(placeFurniture(resized.layout, f.id, { x: 36, y: 18, w: 6, h: 12 }).status).toBe("rejected");
  });
});

describe("가구 삭제", () => {
  test("선택한 가구가 목록에서 사라지고 다른 가구는 그대로이다", () => {
    const layout = createSampleLayout();
    const result = removeFurniture(layout, "table");
    expect(result.status).toBe("removed");
    if (result.status !== "removed") return;
    expect(result.removed.id).toBe("table");
    expect(result.layout.furniture).toHaveLength(layout.furniture.length - 1);
    expect(result.layout.furniture.some((f) => f.id === "table")).toBe(false);
    for (const f of layout.furniture.filter((f) => f.id !== "table")) {
      expect(find(result.layout, f.id)).toEqual(f);
    }
    // 원래 배치는 바뀌지 않는다.
    expect(layout.furniture.some((f) => f.id === "table")).toBe(true);
  });

  test("삭제하면 그 가구가 차지하던 고체 셀만 비워진다", () => {
    const layout = createSampleLayout();
    const table = find(layout, "table");
    const result = removeFurniture(layout, "table");
    const before = rasterize(layout, closed).solid;
    const after = rasterize(result.layout, closed).solid;
    expect(at(before, table.x + 1, table.y + 1)).toBe(1);
    expect(at(after, table.x + 1, table.y + 1)).toBe(0);
    const changed = before.reduce((n, v, c) => n + (v !== after[c] ? 1 : 0), 0);
    expect(changed).toBe(table.w * table.h);
  });

  test("없는 ID를 삭제해도 배치는 그대로이다", () => {
    const layout = createSampleLayout();
    const result = removeFurniture(layout, "nothing");
    expect(result.status).toBe("unchanged");
    expect(result.layout).toBe(layout);
  });

  test("삭제로 비워진 자리에는 다른 가구가 놓일 수 있고, 남은 가구의 충돌 규칙은 유지된다", () => {
    const layout = createSampleLayout();
    // 소파가 있을 때는 식탁이 소파 자리로 갈 수 없다.
    expect(placeFurniture(layout, "table", { x: 30, y: 6, w: 8, h: 6 }).status).toBe("rejected");
    const { layout: withoutSofa } = removeFurniture(layout, "sofa");
    expect(placeFurniture(withoutSofa, "table", { x: 30, y: 6, w: 8, h: 6 }).status).toBe("moved");
    // 다른 가구(수납장)와의 겹침은 여전히 거부된다.
    expect(placeFurniture(withoutSofa, "table", { x: 48, y: 8, w: 8, h: 6 })).toMatchObject({
      status: "rejected",
      reason: "furniture",
    });
  });

  test("삭제 뒤에도 가구를 추가할 수 있고 ID는 현재 목록 안에서 고유하다", () => {
    const layout = createSampleLayout();
    const { layout: after } = removeFurniture(layout, "desk");
    const added = addFurniture(after, "desk");
    expect(added.status).toBe("added");
    const ids = added.layout.furniture.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
