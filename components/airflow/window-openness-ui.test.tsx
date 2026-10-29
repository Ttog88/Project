import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AirflowWorkbench } from "@/components/airflow/AirflowWorkbench";

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

const slider = (id: "A" | "B") =>
  screen.getByRole("slider", { name: `창 ${id} 개방률 세밀 조절(5% 단위)` }) as HTMLInputElement;
const setOpenness = (id: "A" | "B", percent: number) =>
  fireEvent.change(slider(id), { target: { value: String(percent) } });
const applied = (id: "A" | "B") => screen.getByTestId(`window-${id}-applied`).textContent;
const settled = () => screen.getByTestId("summary").getAttribute("aria-busy") === "false";
const waitSettled = () => waitFor(() => expect(settled()).toBe(true), { timeout: 30_000 });

test("창마다 0~100%, 5% 단위 슬라이더가 있고 기존 0·50·100% 빠른 설정 버튼도 그대로 있다", () => {
  render(<AirflowWorkbench />);
  for (const id of ["A", "B"] as const) {
    const input = slider(id);
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "100");
    expect(input).toHaveAttribute("step", "5");
    const group = screen.getByRole("group", { name: `창 ${id} 개방률` });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["0%", "50%", "100%"]);
  }
  // 기본값: 창 A 100%, 창 B 50%
  expect(slider("A")).toHaveValue("100");
  expect(slider("B")).toHaveValue("50");
});

test("0·5·25·50·75·100% 입력이 설정 값, 적용 값, 열린 칸 수, 열린 폭으로 표시된다", () => {
  render(<AirflowWorkbench />);
  const expected: [number, string][] = [
    [0, "설정 0% → 적용 0%(닫힘)"],
    [5, "설정 5% → 적용 6% (1/16칸, 0.2 m)"],
    [25, "설정 25% → 적용 25% (4/16칸, 0.7 m)"],
    [50, "설정 50% → 적용 50% (8/16칸, 1.3 m)"],
    [75, "설정 75% → 적용 75% (12/16칸, 2.0 m)"],
    [100, "설정 100% → 적용 100% (16/16칸, 2.7 m)"],
  ];
  for (const [percent, text] of expected) {
    setOpenness("A", percent);
    expect(slider("A")).toHaveValue(String(percent));
    expect(applied("A")).toBe(text);
  }
  // 창 B는 따로 움직인다.
  setOpenness("B", 55);
  expect(applied("B")).toBe("설정 55% → 적용 56% (9/16칸, 1.5 m)");
  expect(applied("A")).toBe("설정 100% → 적용 100% (16/16칸, 2.7 m)");
});

test("5% 단위가 아닌 값은 가까운 5% 단위로 맞춰진다", () => {
  render(<AirflowWorkbench />);
  setOpenness("A", 57);
  expect(slider("A")).toHaveValue("55");
  expect(applied("A")).toContain("설정 55%");
});

test("같은 열린 칸 수가 되는 설정이면 같은 개구부로 계산된다는 안내가 뜬다", () => {
  render(<AirflowWorkbench />);
  setOpenness("A", 10);
  expect(screen.getByTestId("window-A-same")).toHaveTextContent(
    "이 창에서는 10~15%가 같은 열린 폭(2칸)으로 계산됩니다."
  );
  setOpenness("A", 15);
  expect(screen.getByTestId("window-A-same")).toHaveTextContent("10~15%가 같은 열린 폭(2칸)");
  setOpenness("A", 20);
  expect(screen.queryByTestId("window-A-same")).not.toBeInTheDocument();
  // 다른 창에는 영향이 없다(창 B 기본 50%는 안내 없음).
  expect(screen.queryByTestId("window-B-same")).not.toBeInTheDocument();
});

test("빠른 설정 버튼은 슬라이더 값과 함께 움직인다", () => {
  render(<AirflowWorkbench />);
  const group = screen.getByRole("group", { name: "창 B 개방률" });
  fireEvent.click(within(group).getByRole("button", { name: "100%" }));
  expect(slider("B")).toHaveValue("100");
  expect(within(group).getByRole("button", { name: "100%" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(group).getByRole("button", { name: "0%" }));
  expect(slider("B")).toHaveValue("0");
  expect(applied("B")).toBe("설정 0% → 적용 0%(닫힘)");
  // 5% 단위 값에서는 빠른 설정 버튼이 눌린 상태가 아니다.
  setOpenness("B", 35);
  for (const button of within(group).getAllByRole("button")) {
    expect(button).toHaveAttribute("aria-pressed", "false");
  }
});

test("개방률을 바꾸면 유동이 다시 계산되고, 같은 열린 칸 수의 설정은 같은 결과가 나온다", async () => {
  render(<AirflowWorkbench />);
  const residual = screen.getByTestId("residual");
  await waitSettled();

  setOpenness("A", 10);
  expect(screen.getByTestId("summary")).toHaveAttribute("aria-busy", "true");
  await waitSettled();
  const ten = residual.textContent;
  expect(ten).toMatch(/%$/);

  setOpenness("A", 15);
  await waitSettled();
  expect(residual.textContent).toBe(ten);

  setOpenness("A", 5);
  await waitSettled();
  expect(residual.textContent).not.toBe(ten);
}, 90_000);

test("현재 개방률이 탐색 단계에 없어도(55%) 자동 탐색이 오류 없이 현재 행을 보여 준다", async () => {
  render(<AirflowWorkbench />);
  setOpenness("A", 55);
  await waitSettled();

  fireEvent.click(screen.getByRole("button", { name: "최적 조합 탐색" }));
  await waitFor(() => expect(screen.getByTestId("search-results")).toBeInTheDocument(), { timeout: 90_000 });

  const current = screen.getByTestId("row-current");
  expect(current).toHaveTextContent("55%");
  for (const rank of [1, 2, 3]) expect(screen.getByTestId(`row-top-${rank}`)).toBeInTheDocument();
  // 추천 조합은 기존 0·50·100% 단계 안에서 고른다.
  expect(screen.getByTestId("row-top-1")).toHaveTextContent("100%100%");
}, 120_000);
