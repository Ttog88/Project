import {
  GRID,
  WALL_THICKNESS,
  type Furniture,
  type Layout,
  type Rect,
  type WindowDef,
} from "./types";

export const FURNITURE_MIN = 2;
export const FURNITURE_MAX = 30;

/** 가구가 놓일 수 있는 실내 영역(외벽 안쪽). */
const INTERIOR: Rect = {
  x: WALL_THICKNESS,
  y: WALL_THICKNESS,
  w: GRID.nx - 2 * WALL_THICKNESS,
  h: GRID.ny - 2 * WALL_THICKNESS,
};

export type FurnitureKind = "bed" | "sofa" | "desk" | "table" | "shelf";

/** 추가할 수 있는 가구의 종류와 기본 크기(셀). */
export const FURNITURE_CATALOG: { kind: FurnitureKind; label: string; w: number; h: number }[] = [
  { kind: "bed", label: "침대", w: 10, h: 14 },
  { kind: "sofa", label: "소파", w: 14, h: 6 },
  { kind: "desk", label: "책상", w: 6, h: 4 },
  { kind: "table", label: "식탁", w: 8, h: 6 },
  { kind: "shelf", label: "수납장", w: 6, h: 12 },
];

export type PlacementReason =
  /** 허용 크기(최소·최대)를 벗어남 */
  | "size"
  /** 아파트 실내 밖(외부 영역)으로 나감 */
  | "outside"
  /** 벽과 겹침 */
  | "wall"
  /** 창문·방문 개구부를 침범함 */
  | "opening"
  /** 다른 가구와 겹침 */
  | "furniture";

export type PlacementCheck = { ok: true } | { ok: false; reason: PlacementReason };

/** 두 사각형이 면적을 공유하는지. 경계만 맞닿는 것은 겹침이 아니다. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 창이 뚫린 외벽 구간(벽 두께 × 창 길이). 닫혀 있어도 가구가 막아서는 안 되는 자리이다. */
function windowZone(def: WindowDef): Rect {
  const t = WALL_THICKNESS;
  switch (def.side) {
    case "west":
      return { x: 0, y: def.start, w: t, h: def.length };
    case "east":
      return { x: GRID.nx - t, y: def.start, w: t, h: def.length };
    case "north":
      return { x: def.start, y: 0, w: def.length, h: t };
    case "south":
      return { x: def.start, y: GRID.ny - t, w: def.length, h: t };
  }
}

function isWithin(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * 가구 배치의 유일한 충돌 판정이다. 이동, 크기 변경, 새 가구 추가가 모두 이 함수를 쓴다.
 * `ignoreId`는 자기 자신과의 겹침을 무시하기 위한 것이다.
 */
export function checkPlacement(layout: Layout, rect: Rect, ignoreId?: string): PlacementCheck {
  const values = [rect.x, rect.y, rect.w, rect.h];
  if (!values.every(Number.isInteger)) return { ok: false, reason: "size" };
  if (rect.w < FURNITURE_MIN || rect.h < FURNITURE_MIN) return { ok: false, reason: "size" };
  if (rect.w > FURNITURE_MAX || rect.h > FURNITURE_MAX) return { ok: false, reason: "size" };

  if (overlaps(rect, layout.door) || layout.windows.some((w) => overlaps(rect, windowZone(w)))) {
    return { ok: false, reason: "opening" };
  }
  if (!isWithin(rect, INTERIOR)) return { ok: false, reason: "outside" };
  if (layout.walls.some((wall) => overlaps(rect, wall))) return { ok: false, reason: "wall" };
  if (layout.furniture.some((f) => f.id !== ignoreId && overlaps(rect, f))) {
    return { ok: false, reason: "furniture" };
  }
  return { ok: true };
}

export type PlacementResult = {
  layout: Layout;
  /** moved: 위치·크기가 바뀜 / unchanged: 같은 값 / rejected: 충돌로 거부(마지막 유효 상태 유지) */
  status: "moved" | "unchanged" | "rejected";
  reason?: PlacementReason;
};

/**
 * 가구의 위치·크기를 바꾼다. 충돌하면 바꾸지 않고 그대로 돌려준다(마지막 유효 상태 유지).
 * 좌표와 크기는 가장 가까운 정수 셀로 맞춘다.
 */
export function placeFurniture(layout: Layout, id: string, next: Rect): PlacementResult {
  const current = layout.furniture.find((f) => f.id === id);
  if (!current) return { layout, status: "unchanged" };
  const rect: Rect = {
    x: Math.round(next.x),
    y: Math.round(next.y),
    w: Math.round(next.w),
    h: Math.round(next.h),
  };
  if (
    rect.x === current.x &&
    rect.y === current.y &&
    rect.w === current.w &&
    rect.h === current.h
  ) {
    return { layout, status: "unchanged" };
  }
  const check = checkPlacement(layout, rect, id);
  if (!check.ok) return { layout, status: "rejected", reason: check.reason };
  const furniture: Furniture[] = layout.furniture.map((f) => (f.id === id ? { ...f, ...rect } : f));
  return { layout: { ...layout, furniture }, status: "moved" };
}

export type RemoveFurnitureResult =
  | { layout: Layout; status: "removed"; removed: Furniture }
  | { layout: Layout; status: "unchanged" };

/** 가구를 삭제한다. 없는 ID면 배치를 그대로 돌려준다. 삭제하면 그 자리의 고체 영역도 사라진다. */
export function removeFurniture(layout: Layout, id: string): RemoveFurnitureResult {
  const removed = layout.furniture.find((f) => f.id === id);
  if (!removed) return { layout, status: "unchanged" };
  return {
    layout: { ...layout, furniture: layout.furniture.filter((f) => f.id !== id) },
    status: "removed",
    removed,
  };
}

export type AddFurnitureResult =
  | { layout: Layout; status: "added"; furniture: Furniture }
  | { layout: Layout; status: "rejected"; reason: PlacementReason | "nospace" };

/** 같은 종류의 기존 가구와 겹치지 않는 고유 ID와 이름표를 만든다. */
function nextIdentity(layout: Layout, kind: FurnitureKind, baseLabel: string) {
  const ids = new Set(layout.furniture.map((f) => f.id));
  let n = 2;
  while (ids.has(`${kind}-${n}`)) n++;
  return { id: `${kind}-${n}`, label: `${baseLabel} ${n}` };
}

/**
 * 가구를 새로 추가한다.
 * - `at`(셀 좌표)이 있으면 그 점이 가구의 중앙이 되도록 놓는다. 그 자리가 유효하지 않으면 추가하지 않는다.
 * - `at`이 없으면 실내에서 처음으로 맞는 빈 공간을 찾는다. 없으면 추가하지 않는다.
 */
export function addFurniture(
  layout: Layout,
  kind: FurnitureKind,
  at?: { x: number; y: number }
): AddFurnitureResult {
  const spec = FURNITURE_CATALOG.find((c) => c.kind === kind)!;
  const make = (x: number, y: number): Furniture => ({
    ...nextIdentity(layout, kind, spec.label),
    x,
    y,
    w: spec.w,
    h: spec.h,
  });

  if (at) {
    const rect = {
      x: Math.round(at.x - spec.w / 2),
      y: Math.round(at.y - spec.h / 2),
      w: spec.w,
      h: spec.h,
    };
    const check = checkPlacement(layout, rect);
    if (!check.ok) return { layout, status: "rejected", reason: check.reason };
    const furniture = make(rect.x, rect.y);
    return { layout: { ...layout, furniture: [...layout.furniture, furniture] }, status: "added", furniture };
  }

  for (let y = INTERIOR.y; y + spec.h <= INTERIOR.y + INTERIOR.h; y++) {
    for (let x = INTERIOR.x; x + spec.w <= INTERIOR.x + INTERIOR.w; x++) {
      if (checkPlacement(layout, { x, y, w: spec.w, h: spec.h }).ok) {
        const furniture = make(x, y);
        return {
          layout: { ...layout, furniture: [...layout.furniture, furniture] },
          status: "added",
          furniture,
        };
      }
    }
  }
  return { layout, status: "rejected", reason: "nospace" };
}
