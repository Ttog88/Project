import { GRID, type Furniture, type Layout, type Rect } from "./types";

export const FURNITURE_MIN = 2;
export const FURNITURE_MAX = 30;

/** 가구가 놓일 수 있는 실내 영역(외벽 안쪽). */
const INTERIOR: Rect = { x: 2, y: 2, w: GRID.nx - 4, h: GRID.ny - 4 };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clampRect(r: Rect): Rect {
  const w = Math.min(Math.max(Math.round(r.w), FURNITURE_MIN), FURNITURE_MAX);
  const h = Math.min(Math.max(Math.round(r.h), FURNITURE_MIN), FURNITURE_MAX);
  const x = Math.min(Math.max(Math.round(r.x), INTERIOR.x), INTERIOR.x + INTERIOR.w - w);
  const y = Math.min(Math.max(Math.round(r.y), INTERIOR.y), INTERIOR.y + INTERIOR.h - h);
  return { x, y, w, h };
}

/**
 * 가구의 위치·크기를 바꾼다. 실내 영역 밖으로 나가면 안쪽으로 맞추고,
 * 벽과 겹치게 되면 변경하지 않는다(가구끼리 겹치는 것은 허용).
 */
export function placeFurniture(layout: Layout, id: string, next: Rect): Layout {
  const current = layout.furniture.find((f) => f.id === id);
  if (!current) return layout;
  const rect = clampRect(next);
  if (layout.walls.some((wall) => overlaps(rect, wall) && !isExterior(wall))) return layout;
  if (
    rect.x === current.x &&
    rect.y === current.y &&
    rect.w === current.w &&
    rect.h === current.h
  ) {
    return layout;
  }
  const furniture: Furniture[] = layout.furniture.map((f) =>
    f.id === id ? { ...f, ...rect } : f
  );
  return { ...layout, furniture };
}

function isExterior(wall: Rect): boolean {
  return wall.x === 0 || wall.y === 0 || wall.x + wall.w === GRID.nx || wall.y + wall.h === GRID.ny;
}
