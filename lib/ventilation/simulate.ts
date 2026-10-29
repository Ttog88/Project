import {
  OPENNESS_LEVELS,
  rasterize,
  type Layout,
  type WindowOpenness,
} from "@/lib/floorplan";
import { FlowSimulation, type VelocityField } from "@/lib/flow";
import { buildFlowSetup, type FlowSummary, type WindConditions } from "./wind";

/** 모든 조합에 같은 계산 시간과 시간 간격을 쓴다. */
export const SIMULATION = { dt: 0.2, seconds: 60 } as const;
const TOTAL_STEPS = Math.round(SIMULATION.seconds / SIMULATION.dt);
const STEPS_PER_CHUNK = 25;

export type Conditions = WindConditions & { windowOpenness: WindowOpenness };

export type VentilationResult = {
  conditions: Conditions;
  /** 계산 시간이 끝난 뒤 남은 추적 물질 비율(0~1). 낮을수록 환기에 유리하다. */
  residual: number;
  /** 환기 취약 후보 셀(1). 같은 격자 크기의 마스크 */
  weak: Uint8Array;
  /** 환기 취약 후보가 실내 계산 셀에서 차지하는 비율(0~1) */
  weakShare: number;
  field: VelocityField;
  /** 셀별 남은 추적 물질 농도(0~1) */
  tracer: Float32Array;
  flow: FlowSummary;
};

/** 환기 취약 후보: 남은 농도가 절반 이상이거나 실내 평균보다 뚜렷하게 높은 구역. */
function findWeakZones(tracer: Float32Array, tracked: Uint8Array): { weak: Uint8Array; share: number } {
  let sum = 0;
  let count = 0;
  for (let c = 0; c < tracer.length; c++) {
    if (tracked[c]) {
      sum += tracer[c];
      count++;
    }
  }
  const mean = count ? sum / count : 0;
  const weak = new Uint8Array(tracer.length);
  let weakCount = 0;
  for (let c = 0; c < tracer.length; c++) {
    if (!tracked[c]) continue;
    if (tracer[c] >= 0.5 || (tracer[c] > 0.02 && tracer[c] > mean * 1.25)) {
      weak[c] = 1;
      weakCount++;
    }
  }
  return { weak, share: count ? weakCount / count : 0 };
}

type Prepared = {
  sim: FlowSimulation;
  finish: () => VentilationResult;
};

function prepare(layout: Layout, conditions: Conditions): Prepared {
  const plan = rasterize(layout, conditions.windowOpenness);
  const { setup, summary } = buildFlowSetup(plan, conditions, { dt: SIMULATION.dt });
  const sim = new FlowSimulation(setup);
  return {
    sim,
    finish: () => {
      const snap = sim.snapshot();
      const { weak, share } = findWeakZones(snap.tracer, setup.tracked);
      return {
        conditions,
        residual: snap.residual,
        weak,
        weakShare: share,
        tracer: snap.tracer,
        flow: summary,
        field: {
          nx: snap.nx,
          ny: snap.ny,
          u: snap.u,
          v: snap.v,
          solid: plan.solid,
          cellSize: setup.cellSize,
        },
      };
    },
  };
}

/** 주어진 평면도와 조건으로 유동장·추적 물질 수송을 계산한다. */
export function simulateVentilation(layout: Layout, conditions: Conditions): VentilationResult {
  const run = prepare(layout, conditions);
  run.sim.step(TOTAL_STEPS);
  return run.finish();
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 계산 중간에 화면이 멈추지 않도록 일정 스텝마다 제어권을 돌려주는 버전. */
export async function simulateVentilationAsync(
  layout: Layout,
  conditions: Conditions,
  signal?: { cancelled: boolean }
): Promise<VentilationResult | null> {
  const run = prepare(layout, conditions);
  for (let done = 0; done < TOTAL_STEPS; done += STEPS_PER_CHUNK) {
    if (signal?.cancelled) return null;
    run.sim.step(Math.min(STEPS_PER_CHUNK, TOTAL_STEPS - done));
    await yieldToBrowser();
  }
  return signal?.cancelled ? null : run.finish();
}

export type CombinationEntry = {
  windowOpenness: WindowOpenness;
  result: VentilationResult;
  /** 잔류율이 낮은 순서의 순위(1부터) */
  rank: number;
};

export type SearchOutcome = {
  entries: CombinationEntry[];
  top: CombinationEntry[];
  current: CombinationEntry;
};

export const TOP_COUNT = 3;

/** 현재 조건과 이 값(퍼센트 포인트)보다 작게 차이 나면 유의한 차이로 보지 않는다. */
export const MEANINGFUL_DIFFERENCE = 0.005;

/**
 * 두 창의 개방률 3단계 조합(기본 9개)을 같은 조건으로 모두 계산해 잔류율이 낮은 순으로 정렬한다.
 * 같은 풍향·풍속·가구·초기 농도·계산 시간을 쓰므로 같은 입력이면 항상 같은 결과가 나온다.
 */
export async function searchWindowCombinations(
  layout: Layout,
  base: Conditions,
  options: {
    onProgress?: (done: number, total: number) => void;
    signal?: { cancelled: boolean };
  } = {}
): Promise<SearchOutcome | null> {
  const ids = layout.windows.map((w) => w.id);
  const combos: WindowOpenness[] = [{ A: 0, B: 0 }];
  combos.length = 0;
  const build = (index: number, acc: Partial<WindowOpenness>) => {
    if (index === ids.length) {
      combos.push({ ...(acc as WindowOpenness) });
      return;
    }
    for (const level of OPENNESS_LEVELS) build(index + 1, { ...acc, [ids[index]]: level });
  };
  build(0, {});

  const results: { windowOpenness: WindowOpenness; result: VentilationResult }[] = [];
  for (const windowOpenness of combos) {
    const result = await simulateVentilationAsync(layout, { ...base, windowOpenness }, options.signal);
    if (!result) return null;
    results.push({ windowOpenness, result });
    options.onProgress?.(results.length, combos.length);
  }

  const openSum = (o: WindowOpenness) => Object.values(o).reduce<number>((s, v) => s + v, 0);
  const sorted = [...results].sort(
    (a, b) =>
      a.result.residual - b.result.residual ||
      openSum(a.windowOpenness) - openSum(b.windowOpenness) ||
      a.windowOpenness.A - b.windowOpenness.A ||
      a.windowOpenness.B - b.windowOpenness.B
  );
  const entries = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
  const same = (o: WindowOpenness) => ids.every((id) => o[id] === base.windowOpenness[id]);
  const current = entries.find((e) => same(e.windowOpenness))!;
  return { entries, top: entries.slice(0, TOP_COUNT), current };
}
