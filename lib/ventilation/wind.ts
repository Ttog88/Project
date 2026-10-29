import { GRID, type RasterOpening, type RasterPlan } from "@/lib/floorplan";
import { CELL_FLUID, CELL_OUTLET, CELL_SOLID, type FaceVelocity, type FlowSetup } from "@/lib/flow";

export type WindConditions = {
  /** 바람이 불어오는 방향(도). 0=북, 90=동, 180=남, 270=서 */
  windDirectionDeg: number;
  /** 풍속(m/s) */
  windSpeed: number;
};

/** 교육용 단순 규칙의 상수. 실제 건물의 풍압계수나 유량계수가 아니다. */
const DISCHARGE_COEFFICIENT = 0.6;
const LEEWARD_SUCTION = 0.5;

/** 창이 바람을 얼마나 정면으로 받는지(풍압계수 비슷한 값). 정면=1, 측면=0, 풍하측은 음수. */
export function windPressure(deg: number, outwardNormal: { east: number; north: number }): number {
  const rad = (deg * Math.PI) / 180;
  const from = { east: Math.sin(rad), north: Math.cos(rad) };
  const c = from.east * outwardNormal.east + from.north * outwardNormal.north;
  return c > 0 ? c : LEEWARD_SUCTION * c;
}

export type FlowSummary = {
  /** 공기가 들어오는 창 id, 흐름이 없으면 null */
  inletId: string | null;
  outletId: string | null;
  /** 들어오는 창의 유입 속도(m/s) */
  inflowSpeed: number;
  /** 단위 깊이당 유량(m²/s) */
  flux: number;
};

export type WindSetup = {
  setup: FlowSetup;
  summary: FlowSummary;
};

/**
 * 창 두 개의 풍압 차이로 유입·유출 창을 정하고, 개방 폭에 따른 유량을 계산한다.
 * 개방률이 클수록, 풍속이 클수록, 두 창의 풍압 차가 클수록 더 많이 흐른다.
 */
export function buildFlowSetup(
  plan: RasterPlan,
  wind: WindConditions,
  steps: { dt: number }
): WindSetup {
  const { nx, ny } = plan;
  const h = GRID.cellMeters;
  const cellType = new Uint8Array(nx * ny);
  const tracked = new Uint8Array(nx * ny);
  for (let c = 0; c < nx * ny; c++) {
    cellType[c] = plan.solid[c] ? CELL_SOLID : CELL_FLUID;
    tracked[c] = plan.solid[c] ? 0 : 1;
  }

  const open = plan.openings.filter((o) => o.widthCells > 0);
  const empty: WindSetup = {
    setup: { nx, ny, cellSize: h, cellType, inletFaces: [], tracked, freshAirCells: [], dt: steps.dt },
    summary: { inletId: null, outletId: null, inflowSpeed: 0, flux: 0 },
  };
  if (open.length < 2 || wind.windSpeed <= 0) return empty;

  const [first, second] = open;
  const p1 = windPressure(wind.windDirectionDeg, first.outwardNormal);
  const p2 = windPressure(wind.windDirectionDeg, second.outwardNormal);
  const deltaCp = Math.abs(p1 - p2);
  if (deltaCp < 1e-9) return empty;

  const inlet: RasterOpening = p1 > p2 ? first : second;
  const outlet: RasterOpening = p1 > p2 ? second : first;
  const wIn = inlet.widthCells * h;
  const wOut = outlet.widthCells * h;
  const wEff = 1 / Math.sqrt(1 / (wIn * wIn) + 1 / (wOut * wOut));
  const flux = DISCHARGE_COEFFICIENT * wEff * Math.sqrt(deltaCp) * wind.windSpeed;
  const inflowSpeed = flux / wIn;

  const inletFaces: FaceVelocity[] = inlet.outerCells.map((cell) =>
    outerFace(inlet.side, cell, nx, ny, inflowSpeed)
  );
  const freshAirCells = inlet.outerCells.map((cell) => cell.y * nx + cell.x);
  for (const cell of inlet.outerCells) tracked[cell.y * nx + cell.x] = 0;
  for (const cell of outlet.outerCells) {
    cellType[cell.y * nx + cell.x] = CELL_OUTLET;
    tracked[cell.y * nx + cell.x] = 0;
  }

  return {
    setup: { nx, ny, cellSize: h, cellType, inletFaces, tracked, freshAirCells, dt: steps.dt },
    summary: { inletId: inlet.id, outletId: outlet.id, inflowSpeed, flux },
  };
}

/** 바깥 경계에 닿는 셀의 바깥쪽 면에 실내 방향 속도를 지정한다. */
function outerFace(
  side: RasterOpening["side"],
  cell: { x: number; y: number },
  nx: number,
  ny: number,
  speed: number
): FaceVelocity {
  switch (side) {
    case "west":
      return { axis: "u", index: cell.y * (nx + 1), value: speed };
    case "east":
      return { axis: "u", index: cell.y * (nx + 1) + nx, value: -speed };
    case "north":
      return { axis: "v", index: cell.x, value: speed };
    case "south":
      return { axis: "v", index: ny * nx + cell.x, value: -speed };
  }
}
