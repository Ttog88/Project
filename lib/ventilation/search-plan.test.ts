import { describe, expect, test } from "vitest";

import {
  createSampleLayout,
  rasterize,
  type Layout,
  type WindowDef,
  type WindowOpenness,
} from "@/lib/floorplan";
import {
  COMPUTE_LIMIT,
  DEFAULT_SEARCH_LEVELS,
  MAX_TOTAL_COMBOS,
  buildFlowSetup,
  createFlowClassifier,
  evaluateWithoutFlow,
  generateCombinations,
  planWindowCombinations,
  searchWindowCombinations,
  simulateVentilation,
  type SearchBase,
} from "@/lib/ventilation";

const win = (id: string, side: WindowDef["side"], start: number, length = 12): WindowDef => ({
  id,
  label: `창 ${id}`,
  side,
  start,
  length,
});
const base = createSampleLayout();
const withWindows = (windows: WindowDef[]): Layout => ({ ...base, windows });
const allOpen = (windows: WindowDef[], openness = 1): WindowOpenness =>
  Object.fromEntries(windows.map((w) => [w.id, openness]));
const conditions = (windows: WindowDef[], openness = allOpen(windows), deg = 270): SearchBase => ({
  windDirectionDeg: deg,
  windSpeed: 3,
  windowOpenness: openness,
});

// 서·남·동·북·서·남 순서로 외벽에 놓인 창(서풍 270°에서 풍압 1, 0, -0.5, 0, 1, 0)
const SIX = [
  win("W1", "west", 6),
  win("W2", "south", 34),
  win("W3", "east", 14),
  win("W4", "north", 6),
  win("W5", "west", 24),
  win("W6", "south", 8),
];
const THREE_LEVELS = [0, 0.5, 1];

/** 기준: 실제 경계조건 생성(buildFlowSetup)으로 센 계산 대상 조합 수. */
function bruteCompute(layout: Layout, base: SearchBase, ids: string[], levels: readonly number[]) {
  let total = 0;
  let compute = 0;
  for (const openness of generateCombinations(layout, base, ids, levels)) {
    total++;
    const plan = rasterize(layout, openness);
    const { summary } = buildFlowSetup(plan, base, { dt: 0.2 });
    if (summary.interiorPressure !== null) compute++;
  }
  return { total, compute };
}

describe("조합 생성과 탐색 계획", () => {
  test("창 2개 기본 5단계는 25조합이고 계산 16개·생략 9개이다", () => {
    const plan = planWindowCombinations(base, conditions(base.windows, { A: 1, B: 0.5 }));
    expect(plan.status).toBe("ok");
    expect(plan.mode).toBe("full");
    expect(plan.levels).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(plan.levels).toEqual([...DEFAULT_SEARCH_LEVELS]);
    expect(plan.levelsReduced).toBe(false);
    expect(plan.totalCombos).toBe(25);
    expect(plan.computeCount).toBe(16);
    expect(plan.skippedCount).toBe(9);
    expect(plan.fullTotal).toBe(25);
    expect(plan.limit).toBe(COMPUTE_LIMIT);
    expect(plan.fixed).toEqual([]);
    expect(plan.currentOffGrid).toBe(false);

    const combos = generateCombinations(base, conditions(base.windows), ["A", "B"], plan.levels);
    expect(combos).toHaveLength(25);
    expect(new Set(combos.map((c) => `${c.A}/${c.B}`)).size).toBe(25);
    // 첫 번째 창이 가장 천천히 바뀐다.
    expect(combos.slice(0, 5).map((c) => c.A)).toEqual([0, 0, 0, 0, 0]);
    expect(combos.slice(0, 5).map((c) => c.B)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  test("탐색하지 않는 창은 현재 개방률로 고정된다(5% 단위 값 포함)", () => {
    const windows = SIX.slice(0, 3);
    const open = { W1: 1, W2: 1, W3: 0.55 };
    const combos = generateCombinations(withWindows(windows), conditions(windows, open), ["W1", "W2"], [0, 1]);
    expect(combos).toHaveLength(4);
    for (const c of combos) expect(c.W3).toBe(0.55);
  });

  test("창 3개는 5단계(125조합, 계산 112)가 상한 30개를 넘어 3단계(27조합, 계산 20)로 줄어든다", () => {
    const windows = SIX.slice(0, 3);
    const plan = planWindowCombinations(withWindows(windows), conditions(windows));
    expect(plan.fullTotal).toBe(125);
    expect(plan.fullCompute).toBe(112);
    expect(plan.levels).toEqual([0, 0.5, 1]);
    expect(plan.levelsReduced).toBe(true);
    expect(plan.mode).toBe("limited");
    expect(plan.totalCombos).toBe(27);
    expect(plan.computeCount).toBe(20);
    expect(plan.skippedCount).toBe(7);
    expect(plan.status).toBe("ok");
  });

  test("창 3~6개에서 5단계 → 3단계 → 2단계 순으로 줄이고, 처음 상한 안에 드는 단계를 고른다", () => {
    for (let n = 3; n <= 6; n++) {
      const windows = SIX.slice(0, n);
      const layout = withWindows(windows);
      const base = conditions(windows);
      const ids = windows.map((w) => w.id);
      const plan = planWindowCombinations(layout, base);

      const chain = [DEFAULT_SEARCH_LEVELS, [0, 0.5, 1], [0, 1]];
      const counts = chain.map((levels) => bruteCompute(layout, base, ids, levels));
      const firstFit = counts.findIndex((c) => c.compute <= COMPUTE_LIMIT && c.total <= MAX_TOTAL_COMBOS);
      if (firstFit >= 0) {
        expect(plan.levels, `창 ${n}개`).toEqual([...chain[firstFit]]);
        expect(plan.status).toBe("ok");
        expect(plan.totalCombos).toBe(counts[firstFit].total);
        expect(plan.computeCount).toBe(counts[firstFit].compute);
        expect(plan.computeCount).toBeLessThanOrEqual(COMPUTE_LIMIT);
        // 더 촘촘한 단계는 모두 상한을 넘었다.
        for (let i = 0; i < firstFit; i++) {
          expect(counts[i].compute > COMPUTE_LIMIT || counts[i].total > MAX_TOTAL_COMBOS).toBe(true);
        }
      } else {
        // 2단계로도 넘으면 창을 골라야 한다.
        expect(plan.status, `창 ${n}개`).toBe("needs-selection");
        expect(plan.levels).toEqual([0, 1]);
      }
      expect(plan.fullTotal).toBe(5 ** n);
      expect(plan.totalCombos).toBe(plan.computeCount + plan.skippedCount);
    }
  }, 60_000);

  test("창 4·5개는 2단계로 줄고, 창 6개는 2단계로도 상한을 넘어 탐색할 창을 골라야 한다", () => {
    const plans = [4, 5, 6].map((n) => {
      const windows = SIX.slice(0, n);
      return planWindowCombinations(withWindows(windows), conditions(windows));
    });
    expect(plans[0]).toMatchObject({ status: "ok", levels: [0, 1], totalCombos: 16 });
    expect(plans[1]).toMatchObject({ status: "ok", levels: [0, 1], totalCombos: 32 });
    expect(plans[1].computeCount).toBeLessThanOrEqual(COMPUTE_LIMIT);
    expect(plans[2]).toMatchObject({ status: "needs-selection", levels: [0, 1], totalCombos: 64 });
    expect(plans[2].computeCount).toBeGreaterThan(COMPUTE_LIMIT);
  });

  test("탐색할 창을 고르면 나머지는 현재 개방률로 고정하고 단계 정책을 다시 적용한다", () => {
    const layout = withWindows(SIX);
    const open = { ...allOpen(SIX), W6: 0.55 };
    const selectedFive = planWindowCombinations(layout, conditions(SIX, open), {
      windowIds: ["W1", "W2", "W3", "W4", "W5"],
    });
    expect(selectedFive.status).toBe("ok");
    expect(selectedFive.mode).toBe("limited");
    expect(selectedFive.searchedIds).toEqual(["W1", "W2", "W3", "W4", "W5"]);
    expect(selectedFive.fixed).toEqual([{ id: "W6", openness: 0.55 }]);
    expect(selectedFive.computeCount).toBeLessThanOrEqual(COMPUTE_LIMIT);
    expect(selectedFive.levels).toEqual([0, 1]);

    const selectedThree = planWindowCombinations(layout, conditions(SIX, open), {
      windowIds: ["W1", "W2", "W3"],
    });
    expect(selectedThree.levels).toEqual([0, 0.5, 1]);
    expect(selectedThree.fixed.map((f) => f.id)).toEqual(["W4", "W5", "W6"]);
    expect(selectedThree.totalCombos).toBe(27);

    // 아무 창도 고르지 않으면 탐색할 수 없다.
    expect(planWindowCombinations(layout, conditions(SIX), { windowIds: [] }).status).toBe("needs-selection");
  });

  test("모든 창을 5단계로 탐색해야만 전체 평가이고, 단계를 직접 정하면 제한 평가이다", () => {
    const explicit = planWindowCombinations(base, conditions(base.windows), { levels: THREE_LEVELS });
    expect(explicit).toMatchObject({ mode: "limited", totalCombos: 9, computeCount: 4, skippedCount: 5 });
    expect(explicit.levelsReduced).toBe(false);
    const subset = planWindowCombinations(base, conditions(base.windows), { windowIds: ["A"] });
    expect(subset.mode).toBe("limited");
    expect(subset.searchedIds).toEqual(["A"]);
    expect(subset.fixed).toEqual([{ id: "B", openness: 1 }]);
  });

  test("현재 개방률이 탐색 단계에 없으면 따로 계산해야 한다고 표시한다", () => {
    const off = planWindowCombinations(base, conditions(base.windows, { A: 0.55, B: 0.5 }));
    expect(off.currentOffGrid).toBe(true);
    expect(planWindowCombinations(base, conditions(base.windows, { A: 0.75, B: 0.25 })).currentOffGrid).toBe(false);
    // 3단계 탐색에서는 25%도 격자 밖이다.
    expect(
      planWindowCombinations(base, conditions(base.windows, { A: 0.25, B: 0.5 }), { levels: THREE_LEVELS })
        .currentOffGrid
    ).toBe(true);
  });

  test("통과 흐름이 없는 조합만 많으면(같은 외벽의 창 6개) 총 조합 수 상한으로 단계를 줄인다", () => {
    const sameWall = [2, 8, 14, 20, 26, 32].map((start, i) => win(`S${i + 1}`, "west", start, 4));
    const plan = planWindowCombinations(withWindows(sameWall), conditions(sameWall));
    // 모든 창의 풍압이 같아 계산 대상은 0개이지만, 5단계 15625조합은 메모리 상한(1000)을 넘는다.
    expect(plan.fullTotal).toBe(15625);
    expect(plan.fullCompute).toBe(0);
    expect(plan.levels).toEqual([0, 0.5, 1]);
    expect(plan.totalCombos).toBe(729);
    expect(plan.computeCount).toBe(0);
    expect(plan.skippedCount).toBe(729);
    expect(plan.status).toBe("ok");
  });
});

describe("통과 흐름 판정과 계산 생략", () => {
  test("조합이 통과 흐름을 만드는지 판정하는 규칙이 경계조건 생성과 모든 조합에서 같다", () => {
    const layouts: [string, WindowDef[]][] = [
      ["기본 2개", base.windows],
      ["3개", SIX.slice(0, 3)],
      ["6개", SIX],
      ["같은 외벽 3개", [win("S1", "west", 4, 8), win("S2", "west", 16, 8), win("S3", "west", 28, 8)]],
    ];
    for (const [name, windows] of layouts) {
      const layout = withWindows(windows);
      const ids = windows.map((w) => w.id);
      for (const deg of [270, 0, 45, 135]) {
        const b = conditions(windows, allOpen(windows), deg);
        const classify = createFlowClassifier(layout, b);
        const levels = windows.length > 3 ? [0, 1] : THREE_LEVELS;
        for (const openness of generateCombinations(layout, b, ids, levels)) {
          const { summary } = buildFlowSetup(rasterize(layout, openness), b, { dt: 0.2 });
          expect(classify(openness), `${name} ${deg}° ${JSON.stringify(openness)}`).toBe(
            summary.interiorPressure !== null
          );
        }
      }
    }
    // 풍속 0이면 어떤 조합도 흐르지 않는다.
    const calm = createFlowClassifier(base, { ...conditions(base.windows), windSpeed: 0 });
    expect(calm({ A: 1, B: 1 })).toBe(false);
  });

  test("Solver를 돌리지 않은 결과가 통과 흐름 없는 조건의 Solver 결과와 완전히 같다", () => {
    const closed: [number, number][] = [[0, 0], [0, 1], [1, 0], [0.5, 0]];
    for (const [a, b] of closed) {
      const c = { ...conditions(base.windows), windowOpenness: { A: a, B: b } };
      const skipped = evaluateWithoutFlow(base, c);
      const solved = simulateVentilation(base, c);
      expect(skipped.residual, `A${a} B${b}`).toBe(solved.residual);
      expect(skipped.residual).toBe(1);
      expect(skipped.weakShare).toBe(solved.weakShare);
      expect(Array.from(skipped.tracer)).toEqual(Array.from(solved.tracer));
      expect(Array.from(skipped.weak)).toEqual(Array.from(solved.weak));
      expect(Array.from(skipped.field.u)).toEqual(Array.from(solved.field.u));
      expect(Array.from(skipped.field.v)).toEqual(Array.from(solved.field.v));
      expect(Array.from(skipped.field.solid)).toEqual(Array.from(solved.field.solid));
      expect(skipped.flow).toEqual(solved.flow);
    }
  });
});

describe("탐색 실행", () => {
  test("통과 흐름이 없는 조합은 계산하지 않고 평가 조합 수에는 포함한다(3개 창, 2단계)", async () => {
    const windows = SIX.slice(0, 3);
    const layout = withWindows(windows);
    const b = conditions(windows);
    const progress: [number, number][] = [];
    const outcome = await searchWindowCombinations(layout, b, {
      levels: [0, 1],
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(outcome).not.toBeNull();
    const { entries, plan } = outcome!;
    expect(entries).toHaveLength(8);
    expect(plan).toMatchObject({ mode: "limited", totalCombos: 8, computeCount: 4, skippedCount: 4 });
    expect(outcome!.computedCount).toBe(plan.computeCount);
    expect(outcome!.skippedCount).toBe(plan.skippedCount);
    expect(entries.filter((e) => e.skipped)).toHaveLength(4);
    for (const e of entries.filter((e) => e.skipped)) expect(e.result.residual).toBe(1);
    for (const e of entries.filter((e) => !e.skipped)) expect(e.result.residual).toBeLessThan(1);
    expect(progress.at(-1)).toEqual([8, 8]);
    // 순위는 잔류율이 낮은 순으로 1부터 이어진다.
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].result.residual).toBeGreaterThanOrEqual(entries[i - 1].result.residual);
    }
    expect(outcome!.top).toHaveLength(3);
    expect(outcome!.top.every((e) => !e.skipped)).toBe(true);
    // 현재 조건(모두 100%)은 탐색 조합 안에 있다.
    expect(outcome!.currentComputedSeparately).toBe(false);
    expect(outcome!.current.windowOpenness).toEqual({ W1: 1, W2: 1, W3: 1 });
  }, 90_000);

  test("탐색할 창을 고르면 나머지 창은 현재 개방률로 고정된 채 평가한다", async () => {
    const layout = withWindows(SIX.slice(0, 3));
    const b = conditions(SIX.slice(0, 3), { W1: 1, W2: 1, W3: 0.55 });
    const outcome = await searchWindowCombinations(layout, b, { levels: [0, 1], windowIds: ["W1", "W2"] });
    expect(outcome!.entries).toHaveLength(4);
    for (const e of outcome!.entries) expect(e.windowOpenness.W3).toBe(0.55);
    expect(outcome!.plan.fixed).toEqual([{ id: "W3", openness: 0.55 }]);
    // W1·W2가 모두 닫히면 열린 창이 W3 하나뿐이라 통과 흐름이 없어 생략된다.
    const closedBoth = outcome!.entries.find((e) => e.windowOpenness.W1 === 0 && e.windowOpenness.W2 === 0)!;
    expect(closedBoth.skipped).toBe(true);
    expect(outcome!.skippedCount).toBe(1);
    expect(outcome!.plan.mode).toBe("limited");
  }, 90_000);

  test("계산 대상이 하나도 없어도(같은 외벽의 창 6개) 평가 조합 전체가 순위에 오른다", async () => {
    const sameWall = [2, 8, 14, 20, 26, 32].map((start, i) => win(`S${i + 1}`, "west", start, 4));
    const outcome = await searchWindowCombinations(withWindows(sameWall), conditions(sameWall), {
      levels: [0, 1],
    });
    expect(outcome!.entries).toHaveLength(64);
    expect(outcome!.computedCount).toBe(0);
    expect(outcome!.skippedCount).toBe(64);
    expect(outcome!.entries.every((e) => e.result.residual === 1)).toBe(true);
    // 잔류율이 모두 같으면 열린 정도의 합이 작은 조합이 먼저이다.
    expect(outcome!.entries[0].windowOpenness).toEqual(Object.fromEntries(sameWall.map((w) => [w.id, 0])));
    expect(outcome!.top).toHaveLength(3);
  }, 90_000);

  test("조합이 너무 많아 창을 골라야 하는 상태에서는 탐색을 거부한다", async () => {
    await expect(searchWindowCombinations(withWindows(SIX), conditions(SIX))).rejects.toThrow("탐색할 창을 선택");
  });

  test("기본 5단계 전체 평가: 25개 조합, 계산 16·생략 9, 기존 9조합 값이 그대로이고 같은 입력은 같은 결과를 낸다", async () => {
    const b = conditions(base.windows, { A: 1, B: 0.5 }, 270);
    const first = await searchWindowCombinations(base, b);
    const second = await searchWindowCombinations(base, b);
    const { entries, plan, top, current } = first!;

    expect(plan.mode).toBe("full");
    expect(entries).toHaveLength(25);
    expect(first!.computedCount).toBe(16);
    expect(first!.skippedCount).toBe(9);
    expect(entries.filter((e) => e.skipped)).toHaveLength(9);
    expect(first!.currentComputedSeparately).toBe(false);

    // 기존 3단계(0·50·100%) 조합의 값은 변경 전과 같다.
    const residual = (a: number, bb: number) =>
      entries.find((e) => e.windowOpenness.A === a && e.windowOpenness.B === bb)!.result.residual;
    expect(residual(1, 1)).toBeCloseTo(0.19339, 4);
    expect(residual(1, 0.5)).toBeCloseTo(0.28123, 4);
    expect(residual(0.5, 1)).toBeCloseTo(0.36921, 4);
    expect(residual(0.5, 0.5)).toBeCloseTo(0.42236, 4);

    // 목적함수(잔류율이 낮을수록 유리)와 정렬 기준(잔류율, 열린 정도의 합, 창 순서)이 유지된다.
    expect(top.map((e) => [e.windowOpenness.A, e.windowOpenness.B])).toEqual([[1, 1], [1, 0.75], [0.75, 1]]);
    expect(current.windowOpenness).toEqual({ A: 1, B: 0.5 });
    expect(current.rank).toBe(4);
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const cur = entries[i];
      expect(cur.result.residual).toBeGreaterThanOrEqual(prev.result.residual);
    }

    // 같은 입력으로 다시 실행해도 같은 결과
    expect(second!.entries.map((e) => [e.windowOpenness, e.result.residual, e.rank, e.skipped])).toEqual(
      entries.map((e) => [e.windowOpenness, e.result.residual, e.rank, e.skipped])
    );
    expect(second!.plan).toEqual(plan);
  }, 240_000);
});
