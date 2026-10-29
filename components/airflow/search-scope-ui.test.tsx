import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { expect, test, vi } from "vitest";

import { AirflowWorkbench } from "@/components/airflow/AirflowWorkbench";
import { OptimizerPanel } from "@/components/airflow/OptimizerPanel";
import { createSampleLayout, type Layout, type WindowDef } from "@/lib/floorplan";
import {
  planWindowCombinations,
  searchWindowCombinations,
  type SearchBase,
  type SearchOutcome,
} from "@/lib/ventilation";

// jsdom에는 canvas 2D 컨텍스트가 없으므로 그리기 호출만 무시한다.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
  () =>
    new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === "createImageData"
            ? () => ({ data: new Uint8ClampedArray(60 * 42 * 4) })
            : () => {},
        set: () => true,
      }
    ) as unknown as CanvasRenderingContext2D
);

const win = (id: string, side: WindowDef["side"], start: number, length = 12): WindowDef => ({
  id,
  label: `창 ${id}`,
  side,
  start,
  length,
});
const SIX = [
  win("W1", "west", 6),
  win("W2", "south", 34),
  win("W3", "east", 14),
  win("W4", "north", 6),
  win("W5", "west", 24),
  win("W6", "south", 8),
];
const layoutOf = (windows: WindowDef[]): Layout => ({ ...createSampleLayout(), windows });
const baseOf = (windows: WindowDef[], openness?: Record<string, number>): SearchBase => ({
  windDirectionDeg: 270,
  windSpeed: 3,
  windowOpenness: openness ?? Object.fromEntries(windows.map((w) => [w.id, 1])),
});

/** 선택 상태를 가진 채 OptimizerPanel을 렌더링한다(앱에서 Workbench가 하는 일). */
function Harness({
  windows,
  base,
  outcome = null,
}: {
  windows: WindowDef[];
  base: SearchBase;
  outcome?: SearchOutcome | null;
}) {
  const layout = useMemo(() => layoutOf(windows), [windows]);
  const [selected, setSelected] = useState<string[] | null>(null);
  const plan = useMemo(
    () => planWindowCombinations(layout, base, { windowIds: selected ?? undefined }),
    [layout, base, selected]
  );
  return (
    <OptimizerPanel
      layout={layout}
      plan={plan}
      selectedWindowIds={selected}
      onSelectWindows={setSelected}
      outcome={outcome}
      stale={false}
      running={false}
      progress={{ done: 0, total: 0 }}
      onSearch={() => {}}
      onApply={() => {}}
    />
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

test("탐색 시작 전에 기본 5단계 전체 평가의 단계 수, 조합 수, 계산 대상, 계산 생략 수가 보인다", () => {
  render(<AirflowWorkbench />);
  expect(text("search-plan-mode")).toBe("전체 평가");
  expect(text("search-plan-levels")).toBe("5단계(0·25·50·75·100%)");
  expect(text("search-plan-counts")).toBe("평가 25조합 (계산 16 · 계산 생략 9)");
  expect(screen.getByTestId("search-plan")).toHaveTextContent("통과 흐름이 없는 조합으로");
  // 조합이 상한 안이므로 창 선택은 나타나지 않는다.
  expect(screen.queryByTestId("window-selection")).not.toBeInTheDocument();
  expect(screen.queryByTestId("selection-required")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "최적 조합 탐색" })).toBeEnabled();
});

test("현재 개방률이 탐색 단계에 없으면 계획에 따로 계산한다는 안내가 뜬다", () => {
  render(<AirflowWorkbench />);
  fireEvent.change(screen.getByRole("slider", { name: "창 A 개방률 세밀 조절(5% 단위)" }), {
    target: { value: "55" },
  });
  expect(screen.getByTestId("search-plan")).toHaveTextContent("현재 조건이 탐색 조합에 없어 따로 1회 계산합니다.");
  expect(text("search-plan-counts")).toBe("평가 25조합 (계산 16 · 계산 생략 9)");
});

test("전체 평가 결과: 범위, 사용한 단계, 평가·계산·생략 조합 수, 상위 3개와 현재 조건이 표시된다", async () => {
  render(<AirflowWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "최적 조합 탐색" }));
  await waitFor(() => expect(screen.getByTestId("search-results")).toBeInTheDocument(), { timeout: 150_000 });

  expect(text("search-scope-mode")).toBe("전체 평가");
  expect(text("search-scope-levels")).toBe("5단계(0·25·50·75·100%)");
  expect(text("search-scope-counts")).toBe("평가 25조합 (계산 16 · 계산 생략 9)");
  const results = screen.getByTestId("search-results");
  expect(results).toHaveTextContent("탐색한 범위 안에서 가장 유리한 조합");
  expect(results).toHaveTextContent("25% 간격 5단계 안에서의 결과이며, 5% 단위의 모든 값을 확인한 것은 아닙니다");
  // 전체 평가에는 제한 평가 문구가 없다.
  expect(results).not.toHaveTextContent("제한 평가이므로");
  for (const rank of [1, 2, 3]) expect(screen.getByTestId(`row-top-${rank}`)).toBeInTheDocument();
  expect(screen.getByTestId("row-current")).toHaveTextContent("100%50%28.1%");
  // 기본 조건의 상위 1위는 두 창을 모두 100%로 여는 조합이다.
  expect(screen.getByTestId("row-top-1")).toHaveTextContent("100%100%19.3%");
  expect(within(results).getByRole("columnheader", { name: "창 A" })).toBeInTheDocument();
  expect(within(results).getByRole("columnheader", { name: "창 B" })).toBeInTheDocument();
}, 200_000);

test("창 3개: 5단계는 상한을 넘어 3단계로 줄고, 줄였다는 사실과 5단계 전체 조합 수가 보인다", () => {
  const windows = SIX.slice(0, 3);
  render(<Harness windows={windows} base={baseOf(windows)} />);
  expect(text("search-plan-mode")).toBe("제한 평가");
  expect(text("search-plan-levels")).toBe("3단계(0·50·100%)");
  expect(text("search-plan-counts")).toBe("평가 27조합 / 5단계 전체 125조합 (계산 20 · 계산 생략 7)");
  expect(screen.getByTestId("search-plan")).toHaveTextContent(
    "5단계로는 계산 대상이 112개로 상한 30개를 넘어 3단계로 줄였습니다."
  );
  expect(screen.queryByTestId("selection-required")).not.toBeInTheDocument();
});

test("창 6개: 2단계로도 상한을 넘어 탐색할 창을 고르게 하고, 고르면 나머지를 현재 개방률로 고정한다", () => {
  render(<Harness windows={SIX} base={baseOf(SIX, { W1: 1, W2: 1, W3: 1, W4: 1, W5: 1, W6: 0.55 })} />);
  const button = screen.getByRole("button", { name: "최적 조합 탐색" });
  expect(screen.getByTestId("selection-required")).toHaveTextContent("탐색할 창을 골라 주세요");
  expect(screen.getByTestId("selection-required")).toHaveTextContent("상한 30개를 넘습니다");
  expect(button).toBeDisabled();
  const selection = screen.getByTestId("window-selection");
  expect(within(selection).getAllByRole("checkbox")).toHaveLength(6);
  expect(within(selection).getAllByRole("checkbox").every((c) => (c as HTMLInputElement).checked)).toBe(true);

  // 창 W6을 빼면 5개 창, 2단계로 상한 안에 들고 W6은 현재 개방률(55%)로 고정된다.
  fireEvent.click(within(selection).getByRole("checkbox", { name: "창 W6" }));
  expect(screen.queryByTestId("selection-required")).not.toBeInTheDocument();
  expect(button).toBeEnabled();
  expect(text("search-plan-mode")).toBe("제한 평가");
  expect(text("search-plan-levels")).toBe("2단계(0·100%)");
  expect(text("search-plan-fixed")).toBe(
    "탐색한 창: 창 W1, 창 W2, 창 W3, 창 W4, 창 W5 · 현재 개방률로 고정한 창: 창 W6(55%)"
  );

  // 모두 다시 고르면 처음 상태로 돌아가 창을 골라야 한다.
  fireEvent.click(within(selection).getByRole("checkbox", { name: "창 W6" }));
  expect(screen.getByTestId("selection-required")).toBeInTheDocument();
  expect(button).toBeDisabled();
});

test("제한 평가 결과: 전체 최적해가 아니라 탐색 범위 안의 추천임을 밝히고 창 수만큼 열을 보여 준다", async () => {
  const windows = SIX.slice(0, 3);
  const layout = layoutOf(windows);
  // 창 W1이 닫힌 현재 조건: 모두 여는 조합이 더 유리하다.
  const base = baseOf(windows, { W1: 0, W2: 1, W3: 1 });
  const outcome = await searchWindowCombinations(layout, base, { levels: [0, 1] });
  render(<Harness windows={windows} base={base} outcome={outcome} />);

  expect(text("search-scope-mode")).toBe("제한 평가");
  expect(text("search-scope-levels")).toBe("2단계(0·100%)");
  expect(text("search-scope-counts")).toBe("평가 8조합 / 5단계 전체 125조합 (계산 4 · 계산 생략 4)");
  const results = screen.getByTestId("search-results");
  expect(results).toHaveTextContent("탐색한 범위 안에서 가장 유리한 조합: 창 W1 100% · 창 W2 100% · 창 W3 100%");
  expect(results).toHaveTextContent("제한 평가이므로 전체 최적해가 아니라 탐색한 범위 안의 추천 조건입니다.");
  expect(results).not.toHaveTextContent("25% 간격 5단계 안에서의 결과");
  for (const id of ["W1", "W2", "W3"]) {
    expect(within(results).getByRole("columnheader", { name: `창 ${id}` })).toBeInTheDocument();
  }
  expect(within(screen.getByTestId("row-top-1")).getAllByRole("cell")).toHaveLength(1 + 3 + 2);
  expect(screen.getByTestId("row-current")).toHaveTextContent("0%100%100%");
  expect(screen.getByTestId("row-top-1")).toHaveTextContent("100%100%100%");
  const comparison = screen.getByTestId("comparison");
  expect(comparison).toHaveTextContent("현재 조건 · 창 W1 0% / 창 W2 100% / 창 W3 100%");
  expect(comparison).toHaveTextContent("추천 1위 · 창 W1 100% / 창 W2 100% / 창 W3 100%");
}, 120_000);

test("현재 조건이 이미 탐색한 범위 안에서 가장 유리하면 그렇게 안내한다(제한 평가 문구 유지)", async () => {
  const windows = SIX.slice(0, 3);
  const base = baseOf(windows);
  const outcome = await searchWindowCombinations(layoutOf(windows), base, { levels: [0, 1] });
  render(<Harness windows={windows} base={base} outcome={outcome} />);
  const results = screen.getByTestId("search-results");
  expect(results).toHaveTextContent("현재 조건과 유의한 차이가 있는 조합이 없습니다");
  expect(results).toHaveTextContent("이미 탐색한 범위 안에서 가장 유리하거나");
  expect(results).toHaveTextContent("제한 평가이므로 전체 최적해가 아니라");
  expect(screen.getByTestId("row-top-1")).toHaveTextContent("(현재 조건과 같음)");
}, 120_000);

test("고정한 창과 격자 밖 현재 조건이 결과에 표시된다", async () => {
  const windows = SIX.slice(0, 3);
  const layout = layoutOf(windows);
  const base = baseOf(windows, { W1: 0.55, W2: 1, W3: 0.5 });
  const outcome = await searchWindowCombinations(layout, base, { levels: [0, 1], windowIds: ["W1", "W2"] });
  render(<Harness windows={windows} base={base} outcome={outcome} />);

  expect(text("search-scope-mode")).toBe("제한 평가");
  expect(text("search-scope-fixed")).toBe(
    "탐색한 창: 창 W1, 창 W2 · 현재 개방률로 고정한 창: 창 W3(50%)"
  );
  // W1의 현재 개방률(55%)은 탐색 단계(0·100%)에 없어 현재 조건을 따로 계산한다.
  expect(screen.getByTestId("search-scope")).toHaveTextContent("현재 조건이 탐색 조합에 없어 따로 1회 계산합니다.");
  expect(screen.getByTestId("row-current")).toHaveTextContent("55%100%50%");
  expect(outcome!.current.rank).toBe(0);
}, 120_000);
