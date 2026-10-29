import {
  GRID,
  describeOpening,
  type RasterOpening,
  type RasterPlan,
  type WindowSide,
} from "@/lib/floorplan";
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
/** 풍압 차이가 이 값보다 작으면 같은 값으로 본다. */
const PRESSURE_EPSILON = 1e-9;

export type CompassVector = { east: number; north: number };

/**
 * 풍향(바람이 불어오는 방향, 0=북·90=동·180=남·270=서)을 "바람이 오는 쪽"을 가리키는 단위 벡터로 바꾼다.
 * 계산(windPressure)과 화면(나침반)이 풍향을 같은 기준으로 읽도록 이 함수 하나만 쓴다.
 */
export function windFromVector(deg: number): CompassVector {
  const rad = (deg * Math.PI) / 180;
  return { east: Math.sin(rad), north: Math.cos(rad) };
}

/** 공기가 실제로 이동하는 방향의 단위 벡터. 바람이 오는 쪽의 반대이다. */
export function windTravelVector(deg: number): CompassVector {
  const from = windFromVector(deg);
  return { east: -from.east, north: -from.north };
}

/** 창이 바람을 얼마나 정면으로 받는지(풍압계수 비슷한 값). 정면=1, 측면=0, 풍하측은 음수. */
export function windPressure(deg: number, outwardNormal: CompassVector): number {
  const from = windFromVector(deg);
  const c = from.east * outwardNormal.east + from.north * outwardNormal.north;
  return c > 0 ? c : LEEWARD_SUCTION * c;
}

export type WindowRole = "inlet" | "outlet" | "none";

/** 창 하나의 배치, 개방률, 풍압, 모델 유량, Solver 적용 유량을 한곳에 모은 기록. */
export type WindowFlow = {
  id: string;
  label: string;
  side: WindowSide;
  /** 외벽을 따라 창이 시작하는 칸 */
  start: number;
  /** 100% 개방 시 창의 길이(칸) */
  lengthCells: number;
  /** 사용자가 설정한 개방률(%) */
  settingPercent: number;
  /** 격자에서 실제로 열린 칸 수 */
  openCells: number;
  /** 격자에 실제로 적용된 개방률(%) */
  appliedPercent: number;
  /** 실제 열린 폭(m) */
  widthMeters: number;
  /** 풍압 값(외벽 방향과 풍향으로 정해지는 단순 규칙). 같은 외벽의 창은 같다. */
  pressure: number;
  /** 유입·유출·흐름 없음(닫힘 포함) */
  role: WindowRole;
  /** 모델이 계산한 유량(m²/s, 단위 깊이당). 실내로 들어오면 +, 나가면 −, 흐름 없음·닫힘은 0 */
  modelFlux: number;
  /** 유입 창의 유입 속도(m/s). 경계조건으로 지정되는 값. 유입 창이 아니면 0 */
  inflowSpeed: number;
  /** Solver 결과에서 개구부 단면을 지나는 유량을 측정한 값(m²/s). 부호는 modelFlux와 같다. */
  appliedFlux: number;
};

export type FlowSummary = {
  /** 이전 단일 유입·유출 표기와의 호환용. 첫 번째 유입·유출 창 id, 없으면 null */
  inletId: string | null;
  outletId: string | null;
  /** 첫 번째 유입 창의 유입 속도(m/s) */
  inflowSpeed: number;
  /** 모든 유입 창의 모델 유량 합(m²/s, 단위 깊이당) */
  flux: number;
  inletIds: string[];
  outletIds: string[];
  /** 열린 창 전체의 유입량과 유출량이 같아지도록 정한 공통 실내 압력. 통과 흐름이 없으면 null */
  interiorPressure: number | null;
  /** 창 순서대로의 창별 기록(닫힌 창 포함) */
  windows: WindowFlow[];
};

export type WindSetup = {
  setup: FlowSetup;
  summary: FlowSummary;
};

/**
 * 열린 창들의 유입량과 유출량이 같아지는 공통 실내 압력을 구한다.
 * 창 i의 유량은 폭 × sign(풍압 − 압력) × sqrt(|풍압 − 압력|)에 비례하고, 압력이 높아지면 합이 줄어드는
 * 단조 함수이므로 이분법으로 구한다(같은 입력이면 항상 같은 값).
 */
function solveInteriorPressure(widths: number[], pressures: number[]): number {
  const net = (p: number) =>
    pressures.reduce((sum, cp, i) => {
      const d = cp - p;
      return sum + widths[i] * Math.sign(d) * Math.sqrt(Math.abs(d));
    }, 0);
  let lo = Math.min(...pressures);
  let hi = Math.max(...pressures);
  for (let i = 0; i < 200 && hi - lo > 0; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (net(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function summarize(windows: WindowFlow[], interiorPressure: number | null): FlowSummary {
  const inlets = windows.filter((w) => w.role === "inlet");
  const outlets = windows.filter((w) => w.role === "outlet");
  return {
    inletId: inlets[0]?.id ?? null,
    outletId: outlets[0]?.id ?? null,
    inflowSpeed: inlets[0]?.inflowSpeed ?? 0,
    flux: inlets.reduce((sum, w) => sum + w.modelFlux, 0),
    inletIds: inlets.map((w) => w.id),
    outletIds: outlets.map((w) => w.id),
    interiorPressure,
    windows,
  };
}

/**
 * 창마다 풍압을 구하고, 열린 창 전체로 공통 실내 압력을 정해, 창별 유입·유출과 모델 유량을 개별 계산한다.
 * - 유입 창: 모델 유량 ÷ 열린 폭 = 유입 속도를 개구부 바깥 경계에 실내 방향으로 지정한다.
 * - 유출 창: 개구부 바깥 끝을 압력 고정 경계로 둔다. 유량 분배는 Solver가 정한다.
 * 열린 창이 2개 미만이거나 풍속이 0이거나 열린 창의 풍압이 모두 같으면 통과 흐름이 없다.
 * 창이 2개이면 이전의 직렬 오리피스 식과 수식이 같다.
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

  const windows: WindowFlow[] = plan.openings.map((o) => {
    const applied = describeOpening(o.lengthCells, o.openness);
    return {
      id: o.id,
      label: o.label,
      side: o.side,
      start: o.start,
      lengthCells: o.lengthCells,
      settingPercent: applied.settingPercent,
      openCells: applied.openCells,
      appliedPercent: applied.appliedPercent,
      widthMeters: applied.widthMeters,
      pressure: windPressure(wind.windDirectionDeg, o.outwardNormal),
      role: "none",
      modelFlux: 0,
      inflowSpeed: 0,
      appliedFlux: 0,
    };
  });
  const noFlow: WindSetup = {
    setup: { nx, ny, cellSize: h, cellType, inletFaces: [], tracked, freshAirCells: [], dt: steps.dt },
    summary: summarize(windows, null),
  };

  const open = plan.openings.map((o, i) => (o.widthCells > 0 ? i : -1)).filter((i) => i >= 0);
  if (open.length < 2 || wind.windSpeed <= 0) return noFlow;
  const pressures = open.map((i) => windows[i].pressure);
  if (Math.max(...pressures) - Math.min(...pressures) < PRESSURE_EPSILON) return noFlow;

  const interior = solveInteriorPressure(
    open.map((i) => windows[i].widthMeters),
    pressures
  );
  for (const i of open) {
    const w = windows[i];
    const d = w.pressure - interior;
    if (Math.abs(d) < PRESSURE_EPSILON) continue;
    w.modelFlux = Math.sign(d) * DISCHARGE_COEFFICIENT * w.widthMeters * Math.sqrt(Math.abs(d)) * wind.windSpeed;
    w.role = d > 0 ? "inlet" : "outlet";
    if (w.role === "inlet") w.inflowSpeed = w.modelFlux / w.widthMeters;
  }

  const inletFaces: FaceVelocity[] = [];
  const freshAirCells: number[] = [];
  for (const i of open) {
    const w = windows[i];
    const opening = plan.openings[i];
    if (w.role === "inlet") {
      for (const cell of opening.outerCells) {
        inletFaces.push(outerFace(opening.side, cell, nx, ny, w.inflowSpeed));
        freshAirCells.push(cell.y * nx + cell.x);
        tracked[cell.y * nx + cell.x] = 0;
      }
    } else if (w.role === "outlet") {
      for (const cell of opening.outerCells) {
        cellType[cell.y * nx + cell.x] = CELL_OUTLET;
        tracked[cell.y * nx + cell.x] = 0;
      }
    }
  }

  return {
    setup: { nx, ny, cellSize: h, cellType, inletFaces, tracked, freshAirCells, dt: steps.dt },
    summary: summarize(windows, interior),
  };
}

/**
 * Solver 결과에서 창마다 개구부 단면(바깥 끝 셀과 그 안쪽 셀 사이의 면)을 지나는 유량을 측정한다.
 * 실내로 들어오는 방향이 +이고 단위는 m²/s(단위 깊이당)이다. 모델 유량(modelFlux)과 비교하는 데 쓴다.
 */
export function appliedWindowFluxes(
  openings: RasterOpening[],
  faces: { u: Float64Array; v: Float64Array },
  nx: number
): Record<string, number> {
  const h = GRID.cellMeters;
  const result: Record<string, number> = {};
  for (const o of openings) {
    let sum = 0;
    for (const c of o.outerCells) {
      switch (o.side) {
        case "west":
          sum += faces.u[c.y * (nx + 1) + c.x + 1];
          break;
        case "east":
          sum -= faces.u[c.y * (nx + 1) + c.x];
          break;
        case "north":
          sum += faces.v[(c.y + 1) * nx + c.x];
          break;
        case "south":
          sum -= faces.v[c.y * nx + c.x];
          break;
      }
    }
    result[o.id] = sum * h;
  }
  return result;
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
