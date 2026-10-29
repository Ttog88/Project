import { OUTWARD_NORMAL, openCellsFor, type Layout, type WindowOpenness } from "@/lib/floorplan";
import { windPressure, type WindConditions } from "./wind";

/** 자동 탐색의 기본 개방률 단계(5단계). */
export const DEFAULT_SEARCH_LEVELS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** 조합이 많으면 5단계 → 3단계 → 2단계 순으로 줄인다. */
const LEVEL_CHAIN: readonly (readonly number[])[] = [DEFAULT_SEARCH_LEVELS, [0, 0.5, 1], [0, 1]];

/** 계산 대상(통과 흐름이 생기는) 조합의 기본 상한. */
export const COMPUTE_LIMIT = 30;

/** 평가 조합 수(계산 생략 포함)의 상한. 결과를 메모리에 모두 담기 때문에 둔 안전 한도이다. */
export const MAX_TOTAL_COMBOS = 1000;

/** 풍압 차이가 이 값보다 작으면 같은 값으로 본다(wind.ts의 규칙과 같다). */
const PRESSURE_EPSILON = 1e-9;

export type SearchBase = WindConditions & { windowOpenness: WindowOpenness };

export type SearchPlan = {
  /** ok: 바로 탐색할 수 있음 / needs-selection: 2단계로도 상한을 넘거나 탐색할 창이 없어 창을 골라야 함 */
  status: "ok" | "needs-selection";
  /** full: 모든 창을 기본 5단계로 모든 조합 평가 / limited: 단계를 줄였거나 일부 창만 탐색 */
  mode: "full" | "limited";
  /** 실제 사용한 개방률 단계 */
  levels: number[];
  /** 기본 5단계에서 단계를 줄였는지(자동 축소) */
  levelsReduced: boolean;
  /** 탐색하는 창(레이아웃 순서) */
  searchedIds: string[];
  /** 현재 개방률로 고정한 창 */
  fixed: { id: string; openness: number }[];
  /** 평가 조합 수(계산을 생략하는 조합 포함) */
  totalCombos: number;
  /** 계산 대상 조합 수: 통과 흐름이 생기는 조합 */
  computeCount: number;
  /** 통과 흐름이 없어 계산을 생략하는 조합 수 */
  skippedCount: number;
  /** 현재 조건이 탐색 조합에 없어 따로 한 번 더 계산해야 하는지 */
  currentOffGrid: boolean;
  /** 모든 창을 5단계로 탐색할 때의 총 조합 수와 계산 대상 수 */
  fullTotal: number;
  fullCompute: number;
  /** 적용한 계산 대상 상한 */
  limit: number;
};

/**
 * 개방률 조합이 통과 흐름을 만드는지 판정한다. 규칙은 경계조건 생성(buildFlowSetup)과 같다.
 *  - 풍속이 0보다 크고, 열린 창(열린 칸 수 > 0)이 2개 이상이며, 열린 창의 풍압이 모두 같지 않다.
 * 두 규칙이 어긋나지 않는지는 테스트가 모든 조합에서 비교한다.
 */
export function createFlowClassifier(layout: Layout, wind: WindConditions) {
  const windows = layout.windows.map((w) => ({
    id: w.id,
    length: w.length,
    pressure: windPressure(wind.windDirectionDeg, OUTWARD_NORMAL[w.side]),
  }));
  return (openness: WindowOpenness): boolean => {
    if (!(wind.windSpeed > 0)) return false;
    let open = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const w of windows) {
      if (openCellsFor(w.length, openness[w.id] ?? 0) > 0) {
        open++;
        if (w.pressure < min) min = w.pressure;
        if (w.pressure > max) max = w.pressure;
      }
    }
    return open >= 2 && max - min >= PRESSURE_EPSILON;
  };
}

/**
 * 탐색할 창의 개방률을 단계별로 조합한 목록. 탐색하지 않는 창은 현재 개방률로 고정한다.
 * 첫 번째 창이 가장 천천히 바뀌는 순서이다.
 */
export function generateCombinations(
  layout: Layout,
  base: SearchBase,
  searchedIds: readonly string[],
  levels: readonly number[]
): WindowOpenness[] {
  const searched = new Set(searchedIds);
  const ids = layout.windows.map((w) => w.id);
  const fixed: WindowOpenness = {};
  for (const id of ids) if (!searched.has(id)) fixed[id] = base.windowOpenness[id] ?? 0;
  const order = ids.filter((id) => searched.has(id));
  const combos: WindowOpenness[] = [];
  const build = (index: number, acc: WindowOpenness) => {
    if (index === order.length) {
      combos.push({ ...acc });
      return;
    }
    for (const level of levels) build(index + 1, { ...acc, [order[index]]: level });
  };
  build(0, fixed);
  return combos;
}

function countCombinations(
  layout: Layout,
  base: SearchBase,
  classify: (o: WindowOpenness) => boolean,
  searchedIds: readonly string[],
  levels: readonly number[]
) {
  // 조합 수가 상한을 한참 넘으면 목록을 만들기 전에 알 수 있다.
  const total = levels.length ** searchedIds.length;
  if (total > MAX_TOTAL_COMBOS * 20) return { total, compute: Infinity };
  let compute = 0;
  for (const combo of generateCombinations(layout, base, searchedIds, levels)) {
    if (classify(combo)) compute++;
  }
  return { total, compute };
}

const sameLevels = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 탐색 계획을 세운다. 조합을 만들고 수를 세어 기본 5단계로 계산 대상이 상한(30개)을 넘으면
 * 3단계, 2단계 순으로 줄이고, 그래도 넘으면 탐색할 창을 고르도록 요구한다(status: needs-selection).
 * `levels`를 직접 주면 단계를 줄이지 않고 그대로 쓴다(이전 9조합 탐색 등).
 */
export function planWindowCombinations(
  layout: Layout,
  base: SearchBase,
  options: { windowIds?: readonly string[]; levels?: readonly number[]; limit?: number } = {}
): SearchPlan {
  const allIds = layout.windows.map((w) => w.id);
  const limit = options.limit ?? COMPUTE_LIMIT;
  const selected = options.windowIds
    ? allIds.filter((id) => options.windowIds!.includes(id))
    : allIds;
  const fixed = allIds
    .filter((id) => !selected.includes(id))
    .map((id) => ({ id, openness: base.windowOpenness[id] ?? 0 }));
  const classify = createFlowClassifier(layout, base);

  const chain = options.levels ? [options.levels] : LEVEL_CHAIN;
  // 단계를 줄여 가며 처음으로 상한 안에 들어오는 단계를 고른다. 끝까지 넘으면 가장 적은 단계를 쓴다.
  let chosen = 0;
  let counts = countCombinations(layout, base, classify, selected, chain[0]);
  while (
    !(counts.compute <= limit && counts.total <= MAX_TOTAL_COMBOS) &&
    chosen < chain.length - 1
  ) {
    chosen++;
    counts = countCombinations(layout, base, classify, selected, chain[chosen]);
  }
  const levels = [...chain[chosen]];
  const fits = counts.compute <= limit && counts.total <= MAX_TOTAL_COMBOS;
  const full = countCombinations(layout, base, classify, allIds, DEFAULT_SEARCH_LEVELS);

  return {
    status: selected.length > 0 && (options.levels !== undefined || fits) ? "ok" : "needs-selection",
    mode:
      selected.length === allIds.length && sameLevels(levels, DEFAULT_SEARCH_LEVELS) ? "full" : "limited",
    levels,
    levelsReduced: !options.levels && chosen > 0,
    searchedIds: selected,
    fixed,
    totalCombos: counts.total,
    computeCount: Number.isFinite(counts.compute) ? counts.compute : counts.total,
    skippedCount: Number.isFinite(counts.compute) ? counts.total - counts.compute : 0,
    currentOffGrid: !selected.every((id) => levels.includes(base.windowOpenness[id] ?? 0)),
    fullTotal: full.total,
    fullCompute: Number.isFinite(full.compute) ? full.compute : full.total,
    limit,
  };
}
