import { describe, expect, test } from "vitest";

import {
  createSampleLayout,
  describeOpening,
  rasterize,
  type Layout,
  type WindowDef,
  type WindowOpenness,
} from "@/lib/floorplan";
import { CELL_OUTLET, CELL_SOLID } from "@/lib/flow";
import {
  buildFlowSetup,
  searchWindowCombinations,
  simulateVentilation,
  windPressure,
  type FlowSummary,
  type WindowFlow,
} from "@/lib/ventilation";

const NX = 60;
const NORMAL = {
  west: { east: -1, north: 0 },
  east: { east: 1, north: 0 },
  north: { east: 0, north: 1 },
  south: { east: 0, north: -1 },
} as const;

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
const wind = (windDirectionDeg = 270, windSpeed = 3) => ({ windDirectionDeg, windSpeed });
const boundary = (layout: Layout, openness: WindowOpenness, w = wind()) => {
  const plan = rasterize(layout, openness);
  return { plan, ...buildFlowSetup(plan, w, { dt: 0.2 }) };
};
const byId = (summary: FlowSummary, id: string): WindowFlow => summary.windows.find((x) => x.id === id)!;
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

// 서쪽 풍압 1, 남·북쪽 0, 동쪽 -0.5 (서풍 270°)
const OneInTwoOut = [win("W1", "west", 6), win("W2", "south", 34), win("W3", "east", 14)];
const TwoInOneOut = [win("W1", "west", 6), win("W2", "west", 24), win("W3", "east", 14)];
const SixWindows = [
  win("W1", "west", 6),
  win("W2", "south", 34),
  win("W3", "east", 14),
  win("W4", "north", 6),
  win("W5", "west", 24),
  win("W6", "south", 8),
];

describe("창문 3개: 유입·유출 구성", () => {
  test("서풍에서 유입 1개·유출 2개가 된다", () => {
    const layout = withWindows(OneInTwoOut);
    const { summary } = boundary(layout, allOpen(OneInTwoOut));
    expect(summary.inletIds).toEqual(["W1"]);
    expect(summary.outletIds).toEqual(["W2", "W3"]);
    expect(summary.windows.map((w) => w.role)).toEqual(["inlet", "outlet", "outlet"]);
    // 이전 단일 표기(호환용)는 첫 유입·유출 창이다.
    expect(summary.inletId).toBe("W1");
    expect(summary.outletId).toBe("W2");
  });

  test("서풍에서 유입 2개·유출 1개가 된다", () => {
    const layout = withWindows(TwoInOneOut);
    const { summary } = boundary(layout, allOpen(TwoInOneOut));
    expect(summary.inletIds).toEqual(["W1", "W2"]);
    expect(summary.outletIds).toEqual(["W3"]);
    // 같은 외벽의 같은 폭 창은 같은 유량을 받는다.
    expect(byId(summary, "W1").modelFlux).toBeCloseTo(byId(summary, "W2").modelFlux, 12);
  });

  test("열린 창 전체의 유입량과 유출량이 같아지도록 공통 실내 압력이 정해진다", () => {
    for (const windows of [OneInTwoOut, TwoInOneOut, SixWindows]) {
      const { summary } = boundary(withWindows(windows), allOpen(windows));
      const inflow = sum(summary.windows.filter((w) => w.modelFlux > 0).map((w) => w.modelFlux));
      const outflow = -sum(summary.windows.filter((w) => w.modelFlux < 0).map((w) => w.modelFlux));
      expect(inflow).toBeGreaterThan(0);
      expect(inflow).toBeCloseTo(outflow, 9);
      expect(sum(summary.windows.map((w) => w.modelFlux))).toBeCloseTo(0, 9);
      const pressures = summary.windows.map((w) => w.pressure);
      expect(summary.interiorPressure!).toBeGreaterThan(Math.min(...pressures));
      expect(summary.interiorPressure!).toBeLessThan(Math.max(...pressures));
    }
  });
});

describe("창문별 풍압과 유량 부호", () => {
  test("풍압은 외벽 방향과 풍향으로 정해지고, 유량 부호는 (풍압 - 실내 압력)과 같다", () => {
    for (const deg of [0, 90, 180, 270, 135]) {
      for (const windows of [OneInTwoOut, SixWindows]) {
        const { summary } = boundary(withWindows(windows), allOpen(windows), wind(deg));
        for (const def of windows) {
          const w = byId(summary, def.id);
          expect(w.pressure).toBeCloseTo(windPressure(deg, NORMAL[def.side]), 12);
          if (summary.interiorPressure === null) {
            expect(w.modelFlux).toBe(0);
            continue;
          }
          const d = w.pressure - summary.interiorPressure;
          if (Math.abs(d) < 1e-9) expect(w.modelFlux).toBe(0);
          else expect(Math.sign(w.modelFlux), `${def.id} 풍향 ${deg}°`).toBe(Math.sign(d));
          expect(w.role).toBe(w.modelFlux > 0 ? "inlet" : w.modelFlux < 0 ? "outlet" : "none");
        }
      }
    }
  });

  test("같은 외벽의 창은 풍압이 같다", () => {
    const { summary } = boundary(withWindows(TwoInOneOut), allOpen(TwoInOneOut));
    expect(byId(summary, "W1").pressure).toBe(byId(summary, "W2").pressure);
    expect(byId(summary, "W1").pressure).toBeCloseTo(1, 12);
    expect(byId(summary, "W3").pressure).toBeCloseTo(-0.5, 12);
  });

  test("유입 속도는 모델 유량을 열린 폭으로 나눈 값이다", () => {
    const { summary } = boundary(withWindows(OneInTwoOut), allOpen(OneInTwoOut));
    const w1 = byId(summary, "W1");
    expect(w1.inflowSpeed).toBeCloseTo(w1.modelFlux / w1.widthMeters, 12);
    expect(byId(summary, "W2").inflowSpeed).toBe(0);
    expect(summary.inflowSpeed).toBe(w1.inflowSpeed);
    expect(summary.flux).toBeCloseTo(w1.modelFlux, 12);
  });
});

describe("창문별 경계조건 생성", () => {
  test("유입 창은 개구부의 바깥 경계 면에 유입 속도를, 유출 창은 바깥 끝 셀에 압력 경계를 만든다", () => {
    const layout = withWindows(OneInTwoOut);
    const { plan, setup, summary } = boundary(layout, allOpen(OneInTwoOut));
    const w1 = byId(summary, "W1");

    // W1(서쪽, y 6~17): 바깥 경계(x=0)의 u 면 12개, 실내(동쪽) 방향이므로 값이 +
    expect(setup.inletFaces).toHaveLength(12);
    expect(setup.inletFaces.every((f) => f.axis === "u")).toBe(true);
    expect(setup.inletFaces.map((f) => f.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, k) => (6 + k) * (NX + 1))
    );
    for (const f of setup.inletFaces) expect(f.value).toBe(w1.inflowSpeed);
    expect(setup.freshAirCells).toHaveLength(12);

    // 유출 창 W2(남쪽 y=41, x 34~45)와 W3(동쪽 x=59, y 14~25)의 바깥 끝 셀이 압력 경계
    const outlets = Array.from(setup.cellType).flatMap((t, c) => (t === CELL_OUTLET ? [c] : []));
    expect(outlets).toHaveLength(24);
    for (let x = 34; x < 46; x++) expect(setup.cellType[41 * NX + x]).toBe(CELL_OUTLET);
    for (let y = 14; y < 26; y++) expect(setup.cellType[y * NX + 59]).toBe(CELL_OUTLET);
    // 압력 경계 셀과 신선 공기 셀은 추적 물질 집계에서 빠진다.
    for (const c of outlets) expect(setup.tracked[c]).toBe(0);
    for (const c of setup.freshAirCells) expect(setup.tracked[c]).toBe(0);
    expect(plan.openings.map((o) => o.id)).toEqual(["W1", "W2", "W3"]);
  });

  test("유입 창이 둘이면 각 창의 개구부에 자기 속도로 경계가 만들어진다", () => {
    const layout = withWindows(TwoInOneOut);
    const open = { W1: 1, W2: 0.5, W3: 1 };
    const { setup, summary } = boundary(layout, open);
    const w1 = byId(summary, "W1");
    const w2 = byId(summary, "W2");
    expect(w2.openCells).toBe(6);
    expect(setup.inletFaces).toHaveLength(w1.openCells + w2.openCells);
    // 두 창의 폭이 달라도 유입 속도는 같다(풍압이 같으므로).
    expect(w1.inflowSpeed).toBeCloseTo(w2.inflowSpeed, 12);
    expect(w1.modelFlux).toBeCloseTo(2 * w2.modelFlux, 12);
    expect(setup.inletFaces.every((f) => f.value === w1.inflowSpeed || Math.abs(f.value - w1.inflowSpeed) < 1e-12)).toBe(true);
  });

  test("창이 2~6개이면 개수만큼 경계가 동적으로 생성된다", () => {
    for (let n = 2; n <= 6; n++) {
      const windows = SixWindows.slice(0, n);
      const { setup, summary } = boundary(withWindows(windows), allOpen(windows));
      expect(summary.windows).toHaveLength(n);
      expect(new Set(summary.windows.map((w) => w.id)).size).toBe(n);
      const inletCells = sum(summary.windows.filter((w) => w.role === "inlet").map((w) => w.openCells));
      const outletCells = sum(summary.windows.filter((w) => w.role === "outlet").map((w) => w.openCells));
      expect(setup.inletFaces).toHaveLength(inletCells);
      expect(Array.from(setup.cellType).filter((t) => t === CELL_OUTLET)).toHaveLength(outletCells);
      expect(summary.inletIds.length).toBeGreaterThan(0);
      expect(summary.outletIds.length).toBeGreaterThan(0);
      expect(sum(summary.windows.map((w) => w.modelFlux))).toBeCloseTo(0, 9);
    }
  });
});

describe("닫힌 창과 통과 흐름이 없는 경우", () => {
  test("닫힌 창은 유량 0이고 경계조건이 만들어지지 않는다", () => {
    const layout = withWindows(OneInTwoOut);
    const open = { W1: 1, W2: 0, W3: 1 };
    const { plan, setup, summary } = boundary(layout, open);
    const w2 = byId(summary, "W2");
    expect(w2.role).toBe("none");
    expect(w2.modelFlux).toBe(0);
    expect(w2.inflowSpeed).toBe(0);
    expect(w2.openCells).toBe(0);
    expect(w2.appliedPercent).toBe(0);
    // 닫힌 창의 바깥 줄은 벽 그대로이고 압력 경계가 아니다.
    for (let x = 34; x < 46; x++) {
      expect(plan.solid[41 * NX + x]).toBe(1);
      expect(setup.cellType[41 * NX + x]).toBe(CELL_SOLID);
    }
    // 나머지 두 창(유입 W1, 유출 W3)만 흐른다.
    expect(summary.inletIds).toEqual(["W1"]);
    expect(summary.outletIds).toEqual(["W3"]);
    expect(byId(summary, "W1").modelFlux).toBeCloseTo(-byId(summary, "W3").modelFlux, 12);

    const r = simulateVentilation(layout, { ...wind(), windowOpenness: open });
    expect(byId(r.flow, "W2").appliedFlux).toBe(0);
  });

  test("열린 창이 하나뿐이면 통과 흐름이 없다", () => {
    const layout = withWindows(OneInTwoOut);
    const { setup, summary } = boundary(layout, { W1: 1, W2: 0, W3: 0 });
    expect(summary.interiorPressure).toBeNull();
    expect(summary.windows.every((w) => w.role === "none" && w.modelFlux === 0)).toBe(true);
    expect(setup.inletFaces).toHaveLength(0);
    expect(Array.from(setup.cellType).includes(CELL_OUTLET)).toBe(false);
  });

  test("열린 창의 풍압이 모두 같으면 통과 흐름이 없다(같은 외벽의 창 3개)", () => {
    const sameWall = [win("W1", "west", 4, 8), win("W2", "west", 16, 8), win("W3", "west", 28, 8)];
    const layout = withWindows(sameWall);
    for (const deg of [0, 90, 270]) {
      const { setup, summary } = boundary(layout, allOpen(sameWall), wind(deg));
      expect(summary.interiorPressure, `풍향 ${deg}°`).toBeNull();
      expect(summary.inletIds).toEqual([]);
      expect(summary.outletIds).toEqual([]);
      expect(summary.windows.every((w) => w.modelFlux === 0)).toBe(true);
      expect(setup.inletFaces).toHaveLength(0);
    }
    const r = simulateVentilation(layout, { ...wind(), windowOpenness: allOpen(sameWall) });
    expect(r.residual).toBeCloseTo(1, 6);
    expect(r.flow.windows.every((w) => w.appliedFlux === 0)).toBe(true);
  });

  test("북동풍(45°)에서 서쪽 창과 남쪽 창은 풍압이 같아 흐름이 없고, 풍속 0도 흐름이 없다", () => {
    const layout = withWindows([win("W1", "west", 6), win("W2", "south", 34)]);
    expect(boundary(layout, { W1: 1, W2: 1 }, wind(45)).summary.interiorPressure).toBeNull();
    expect(boundary(layout, { W1: 1, W2: 1 }, wind(270, 0)).summary.interiorPressure).toBeNull();
  });
});

describe("창별 기록(배치·개방률)", () => {
  test("위치, 외벽 방향, 크기, 설정·적용 개방률을 창마다 가진다", () => {
    const layout = withWindows(OneInTwoOut);
    const { summary } = boundary(layout, { W1: 0.55, W2: 1, W3: 0.05 });
    const w1 = byId(summary, "W1");
    const expected = describeOpening(12, 0.55);
    expect(w1).toMatchObject({
      label: "창 W1",
      side: "west",
      start: 6,
      lengthCells: 12,
      settingPercent: 55,
      openCells: 7,
      appliedPercent: expected.appliedPercent,
    });
    expect(w1.widthMeters).toBeCloseTo(7 / 6, 12);
    // 길이 12칸 창의 설정 5%는 0.6칸 → 1칸(8%)으로 적용된다.
    expect(byId(summary, "W3")).toMatchObject({ settingPercent: 5, openCells: 1, appliedPercent: 8 });
  });
});

describe("기존 2개 창문 결과 회귀", () => {
  /** 이전 구현(열린 창 2개의 직렬 오리피스 식)을 그대로 옮긴 기준. */
  const legacy = (deg: number, speed: number, a: number, b: number) => {
    const pa = windPressure(deg, NORMAL.west);
    const pb = windPressure(deg, NORMAL.south);
    const wa = Math.round(16 * a) / 6;
    const wb = Math.round(16 * b) / 6;
    const inletIsA = pa > pb;
    const wIn = inletIsA ? wa : wb;
    const wOut = inletIsA ? wb : wa;
    const wEff = 1 / Math.sqrt(1 / (wIn * wIn) + 1 / (wOut * wOut));
    const flux = 0.6 * wEff * Math.sqrt(Math.abs(pa - pb)) * speed;
    return { inletId: inletIsA ? "A" : "B", flux, inflowSpeed: flux / wIn };
  };

  test("유입·유출 창, 유량, 유입 속도가 이전 식과 같다", () => {
    for (const deg of [0, 90, 180, 270, 300, 10, 200]) {
      for (const [a, b] of [[1, 1], [1, 0.5], [0.5, 1], [0.5, 0.5], [0.55, 0.9], [0.1, 0.15]]) {
        for (const speed of [3, 6]) {
          const { summary } = boundary(base, { A: a, B: b }, wind(deg, speed));
          const old = legacy(deg, speed, a, b);
          expect(summary.inletId, `풍향 ${deg}° A${a} B${b}`).toBe(old.inletId);
          expect(summary.outletId).toBe(old.inletId === "A" ? "B" : "A");
          expect(summary.flux).toBeCloseTo(old.flux, 12);
          expect(summary.inflowSpeed).toBeCloseTo(old.inflowSpeed, 12);
        }
      }
    }
  });

  test("창 ID를 A·B가 아닌 이름으로 바꿔도 결과가 같다", () => {
    const renamed = withWindows(base.windows.map((w, i) => ({ ...w, id: `W${i + 1}` })));
    const a = simulateVentilation(base, { ...wind(), windowOpenness: { A: 1, B: 0.5 } });
    const b = simulateVentilation(renamed, { ...wind(), windowOpenness: { W1: 1, W2: 0.5 } });
    expect(b.residual).toBe(a.residual);
    expect(b.flow.flux).toBe(a.flow.flux);
    expect(b.flow.inletIds).toEqual(["W1"]);
    expect(b.residual).toBeCloseTo(0.28123, 4);
  });

  test("창 ID가 A·B가 아니어도 9개 조합 탐색이 같은 순서와 값을 낸다", async () => {
    const renamed = withWindows(base.windows.map((w, i) => ({ ...w, id: `W${i + 1}` })));
    const original = await searchWindowCombinations(base, { ...wind(), windowOpenness: { A: 1, B: 0.5 } });
    const dynamic = await searchWindowCombinations(renamed, { ...wind(), windowOpenness: { W1: 1, W2: 0.5 } });
    expect(dynamic!.entries).toHaveLength(9);
    expect(dynamic!.entries.map((e) => [e.windowOpenness.W1, e.windowOpenness.W2, e.result.residual])).toEqual(
      original!.entries.map((e) => [e.windowOpenness.A, e.windowOpenness.B, e.result.residual])
    );
    expect(dynamic!.current.rank).toBe(original!.current.rank);
  }, 90_000);
});

describe("모델 유량과 Solver 적용 유량", () => {
  test("창 2개에서는 모델 유량과 적용 유량이 거의 같다", () => {
    const r = simulateVentilation(base, { ...wind(), windowOpenness: { A: 1, B: 0.5 } });
    const a = byId(r.flow, "A");
    const b = byId(r.flow, "B");
    expect(a.appliedFlux).toBeGreaterThan(0);
    expect(b.appliedFlux).toBeLessThan(0);
    expect(a.appliedFlux).toBeCloseTo(a.modelFlux, 1);
    expect(Math.abs(b.appliedFlux / b.modelFlux - 1)).toBeLessThan(0.05);
  });

  test("창 3개: 유입 창은 모델과 같은 유량으로 들어오고, 유출 창은 적용 유량이 따로 기록된다", () => {
    for (const windows of [OneInTwoOut, TwoInOneOut]) {
      const r = simulateVentilation(withWindows(windows), { ...wind(), windowOpenness: allOpen(windows) });
      for (const w of r.flow.windows) {
        // 적용 유량의 부호는 역할과 같다.
        expect(Math.sign(w.appliedFlux), w.id).toBe(Math.sign(w.modelFlux));
        // 유입 창은 경계조건으로 지정한 값이므로 모델과 거의 같다.
        if (w.role === "inlet") expect(Math.abs(w.appliedFlux / w.modelFlux - 1)).toBeLessThan(0.02);
      }
      // 적용 유입량 합과 유출량 합은 허용 오차 안에서 같다(Solver의 압력 반복 한계로 최대 약 8%의 차이가 난다).
      const inflow = sum(r.flow.windows.filter((w) => w.appliedFlux > 0).map((w) => w.appliedFlux));
      const outflow = -sum(r.flow.windows.filter((w) => w.appliedFlux < 0).map((w) => w.appliedFlux));
      expect(Math.abs(outflow / inflow - 1)).toBeLessThan(0.1);
    }
  });

  test("유출 창이 여럿이면 적용 유량의 분배가 모델과 다를 수 있다(스펙의 한계)", () => {
    const r = simulateVentilation(withWindows(OneInTwoOut), {
      ...wind(),
      windowOpenness: allOpen(OneInTwoOut),
    });
    const w2 = byId(r.flow, "W2");
    const w3 = byId(r.flow, "W3");
    // 두 유출 창의 모델 유량 합과 적용 유량 합은 같지만, 개별 값은 Solver가 정한다.
    expect(w2.modelFlux).not.toBeCloseTo(w2.appliedFlux, 1);
    expect(Math.abs(w2.appliedFlux + w3.appliedFlux) / Math.abs(w2.modelFlux + w3.modelFlux)).toBeGreaterThan(0.85);
    expect(Math.abs(w2.appliedFlux + w3.appliedFlux) / Math.abs(w2.modelFlux + w3.modelFlux)).toBeLessThan(1.15);
  });

  test("6개 창에서도 계산이 끝나고 창별 기록이 모두 채워진다", () => {
    const openness = allOpen(SixWindows);
    openness.W2 = 0.5;
    const r = simulateVentilation(withWindows(SixWindows), { ...wind(), windowOpenness: openness });
    expect(r.flow.windows).toHaveLength(6);
    expect(r.residual).toBeGreaterThan(0);
    expect(r.residual).toBeLessThan(1);
    for (const w of r.flow.windows) {
      expect(Number.isFinite(w.appliedFlux)).toBe(true);
      expect(Number.isFinite(w.modelFlux)).toBe(true);
    }
  });
});
