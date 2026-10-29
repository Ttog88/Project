import {
  rasterize,
  type Layout,
  type WindowOpenness,
} from "@/lib/floorplan";
import { FlowSimulation, type VelocityField } from "@/lib/flow";
import {
  createFlowClassifier,
  generateCombinations,
  planWindowCombinations,
  type SearchPlan,
} from "./search-plan";
import { appliedWindowFluxes, buildFlowSetup, type FlowSummary, type WindConditions } from "./wind";

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
      // 창별로 모델 유량과 Solver 결과에서 측정한 적용 유량을 함께 담는다.
      const applied = appliedWindowFluxes(plan.openings, sim.faceVelocities(), plan.nx);
      const flow: FlowSummary = {
        ...summary,
        windows: summary.windows.map((w) => ({ ...w, appliedFlux: applied[w.id] ?? 0 })),
      };
      return {
        conditions,
        residual: snap.residual,
        weak,
        weakShare: share,
        tracer: snap.tracer,
        flow,
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

/**
 * Solver를 돌리지 않고 결과를 만든다. 통과 흐름이 없는 조건에서는 속도가 0이고 추적 물질이 처음 그대로이므로
 * simulateVentilation과 같은 결과(잔류율 100%)가 나온다. 계산을 생략하는 조합에 쓴다.
 */
export function evaluateWithoutFlow(layout: Layout, conditions: Conditions): VentilationResult {
  return prepare(layout, conditions).finish();
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
  /** 잔류율이 낮은 순서의 순위(1부터). 0이면 탐색 조합에 없어 따로 계산한 현재 조건이다. */
  rank: number;
  /** 통과 흐름이 없어 계산을 생략한 조합(잔류율 100%로 정해짐) */
  skipped: boolean;
};

export type SearchOutcome = {
  entries: CombinationEntry[];
  top: CombinationEntry[];
  current: CombinationEntry;
  /** 실제로 쓴 탐색 계획(단계, 탐색한 창, 고정한 창, 조합 수) */
  plan: SearchPlan;
  /** 평가한 조합 중 Solver로 계산한 수와 계산을 생략한 수(둘의 합이 평가 조합 수) */
  computedCount: number;
  skippedCount: number;
  /** 현재 조건이 탐색 조합에 없어 따로 계산했는지 */
  currentComputedSeparately: boolean;
};

export const TOP_COUNT = 3;

/** 현재 조건과 이 값(퍼센트 포인트)보다 작게 차이 나면 유의한 차이로 보지 않는다. */
export const MEANINGFUL_DIFFERENCE = 0.005;

/**
 * 창 개방률 조합을 같은 조건으로 모두 평가해 잔류율이 낮은 순으로 정렬한다.
 * 조합과 단계는 탐색 계획(planWindowCombinations)을 따른다. 기본은 모든 창을 5단계로 탐색하고,
 * 계산 대상이 많으면 단계를 줄이며, 그래도 많으면 windowIds로 탐색할 창을 골라야 한다.
 * 통과 흐름이 없는 조합은 계산하지 않아도 결과가 정해지므로 Solver를 돌리지 않는다(평가 조합 수에는 포함).
 * 같은 풍향·풍속·가구·초기 농도·계산 시간을 쓰므로 같은 입력이면 항상 같은 결과가 나온다.
 */
export async function searchWindowCombinations(
  layout: Layout,
  base: Conditions,
  options: {
    /** 단계를 직접 정한다(단계를 줄이는 정책을 쓰지 않음). 예: [0, 0.5, 1] */
    levels?: readonly number[];
    /** 탐색할 창. 나머지 창은 현재 개방률로 고정한다. */
    windowIds?: readonly string[];
    onProgress?: (done: number, total: number) => void;
    signal?: { cancelled: boolean };
  } = {}
): Promise<SearchOutcome | null> {
  const plan = planWindowCombinations(layout, base, {
    levels: options.levels,
    windowIds: options.windowIds,
  });
  if (plan.status !== "ok") {
    throw new Error("탐색할 조합이 너무 많습니다. 탐색할 창을 선택하세요.");
  }
  const ids = layout.windows.map((w) => w.id);
  const classify = createFlowClassifier(layout, base);
  const combos = generateCombinations(layout, base, plan.searchedIds, plan.levels);
  const same = (o: WindowOpenness) => ids.every((id) => o[id] === base.windowOpenness[id]);
  // 현재 조건이 탐색 조합에 없으면 따로 한 번 더 계산한다.
  const currentOffGrid = !combos.some(same);
  const total = combos.length + (currentOffGrid ? 1 : 0);

  const evaluate = async (windowOpenness: WindowOpenness) => {
    const conditions = { ...base, windowOpenness };
    if (!classify(windowOpenness)) {
      return { result: evaluateWithoutFlow(layout, conditions), skipped: true };
    }
    const result = await simulateVentilationAsync(layout, conditions, options.signal);
    return result ? { result, skipped: false } : null;
  };

  const results: { windowOpenness: WindowOpenness; result: VentilationResult; skipped: boolean }[] = [];
  let computed = 0;
  let skipped = 0;
  for (const windowOpenness of combos) {
    const evaluated = await evaluate(windowOpenness);
    if (!evaluated) return null;
    if (evaluated.skipped) {
      skipped++;
      if (skipped % 25 === 0) await yieldToBrowser();
    } else {
      computed++;
    }
    results.push({ windowOpenness, ...evaluated });
    options.onProgress?.(results.length, total);
  }

  const openSum = (o: WindowOpenness) => Object.values(o).reduce<number>((s, v) => s + v, 0);
  // 잔류율과 열린 정도의 합이 같으면 창 순서(레이아웃에 놓인 순서)대로 개방률이 작은 쪽을 먼저 둔다.
  const byWindowOrder = (a: WindowOpenness, b: WindowOpenness) => {
    for (const id of ids) {
      const diff = a[id] - b[id];
      if (diff) return diff;
    }
    return 0;
  };
  const sorted = [...results].sort(
    (a, b) =>
      a.result.residual - b.result.residual ||
      openSum(a.windowOpenness) - openSum(b.windowOpenness) ||
      byWindowOrder(a.windowOpenness, b.windowOpenness)
  );
  const entries: CombinationEntry[] = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
  let current = entries.find((e) => same(e.windowOpenness));
  if (!current) {
    const evaluated = await evaluate(base.windowOpenness);
    if (!evaluated) return null;
    current = { windowOpenness: base.windowOpenness, ...evaluated, rank: 0 };
    options.onProgress?.(total, total);
  }
  return {
    entries,
    top: entries.slice(0, TOP_COUNT),
    current,
    plan,
    computedCount: computed,
    skippedCount: skipped,
    currentComputedSeparately: currentOffGrid,
  };
}
