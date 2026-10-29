import { openCellsFor } from "./opening";
import {
  GRID,
  WALL_THICKNESS,
  type Layout,
  type Rect,
  type WindowDef,
  type WindowOpenness,
  type WindowSide,
} from "./types";

/** 창이 바깥을 향하는 방향(동쪽, 북쪽이 양수인 지리 좌표). */
export const OUTWARD_NORMAL: Record<WindowSide, { east: number; north: number }> = {
  west: { east: -1, north: 0 },
  east: { east: 1, north: 0 },
  north: { east: 0, north: 1 },
  south: { east: 0, north: -1 },
};

export type Cell = { x: number; y: number };

export type RasterOpening = {
  id: WindowDef["id"];
  label: string;
  side: WindowSide;
  /** 외벽을 따라 창이 시작하는 칸 */
  start: number;
  /** 100% 개방 시 창의 길이(칸) */
  lengthCells: number;
  /** 사용자가 설정한 개방률(0~1) */
  openness: number;
  outwardNormal: { east: number; north: number };
  /** 벽을 뚫은 개구부 셀(바깥쪽 끝 셀 포함). 닫혀 있으면 비어 있다. */
  cells: Cell[];
  /** 바깥 경계에 닿는 셀 */
  outerCells: Cell[];
  /** 개구부 폭(셀) */
  widthCells: number;
};

export type RasterPlan = {
  nx: number;
  ny: number;
  /** 1이면 벽 또는 가구(유동이 통과할 수 없는 고체 셀) */
  solid: Uint8Array;
  openings: RasterOpening[];
};

function fill(solid: Uint8Array, r: Rect) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x >= 0 && x < GRID.nx && y >= 0 && y < GRID.ny) solid[y * GRID.nx + x] = 1;
    }
  }
}

function openingCells(def: WindowDef, widthCells: number) {
  const offset = def.start + Math.floor((def.length - widthCells) / 2);
  const cells: Cell[] = [];
  const outerCells: Cell[] = [];
  for (let k = 0; k < widthCells; k++) {
    for (let d = 0; d < WALL_THICKNESS; d++) {
      let cell: Cell;
      if (def.side === "west") cell = { x: d, y: offset + k };
      else if (def.side === "east") cell = { x: GRID.nx - 1 - d, y: offset + k };
      else if (def.side === "north") cell = { x: offset + k, y: d };
      else cell = { x: offset + k, y: GRID.ny - 1 - d };
      cells.push(cell);
      if (d === 0) outerCells.push(cell);
    }
  }
  return { cells, outerCells };
}

/** 벽·가구를 고체 셀로 바꾸고, 열린 창을 벽의 개구부로 뚫는다. */
export function rasterize(layout: Layout, openness: WindowOpenness): RasterPlan {
  const solid = new Uint8Array(GRID.nx * GRID.ny);
  for (const wall of layout.walls) fill(solid, wall);
  for (const f of layout.furniture) fill(solid, f);

  const openings: RasterOpening[] = layout.windows.map((def) => {
    const setting = openness[def.id] ?? 0;
    const widthCells = openCellsFor(def.length, setting);
    const { cells, outerCells } = openingCells(def, widthCells);
    for (const c of cells) solid[c.y * GRID.nx + c.x] = 0;
    return {
      id: def.id,
      label: def.label,
      side: def.side,
      start: def.start,
      lengthCells: def.length,
      openness: setting,
      outwardNormal: OUTWARD_NORMAL[def.side],
      cells,
      outerCells,
      widthCells,
    };
  });

  return { nx: GRID.nx, ny: GRID.ny, solid, openings };
}
