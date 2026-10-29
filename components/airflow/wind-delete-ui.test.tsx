import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AirflowWorkbench } from "@/components/airflow/AirflowWorkbench";
import { windFromVector, windTravelVector } from "@/lib/ventilation";

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

const CENTER = 80; // WindCompass의 viewBox 중심
const ARROW = 46; // WindCompass의 화살표 길이

const setDirection = (deg: number) =>
  fireEvent.change(screen.getByLabelText(/풍향/), { target: { value: String(deg) } });

const endpoint = (testId: string) => {
  const line = screen.getByTestId(testId);
  return {
    x: Number(line.getAttribute("x2")) - CENTER,
    y: Number(line.getAttribute("y2")) - CENTER,
    bearing: Number(line.getAttribute("data-bearing")),
  };
};

test("평면도에 북쪽 화살표가 표시된다", () => {
  render(<AirflowWorkbench />);
  const north = screen.getByTestId("north-arrow");
  expect(north).toHaveAttribute("aria-label", "북쪽(평면도 위쪽)");
  expect(north).toHaveTextContent("N");
});

test("나침반에 불어오는 쪽과 이동 방향이 별도 화살표로 표시되고 문장으로도 설명된다", () => {
  render(<AirflowWorkbench />);
  // 기본 풍향 270°: 서쪽에서 불어와 동쪽으로 이동
  expect(endpoint("wind-from-arrow").bearing).toBe(270);
  expect(endpoint("wind-travel-arrow").bearing).toBe(90);
  expect(screen.getByTestId("wind-summary")).toHaveTextContent("서쪽에서 불어와 동쪽으로 이동");

  setDirection(90);
  expect(screen.getByTestId("wind-summary")).toHaveTextContent("동쪽에서 불어와 서쪽으로 이동");
  expect(endpoint("wind-from-arrow").bearing).toBe(90);
  expect(endpoint("wind-travel-arrow").bearing).toBe(270);
});

test("나침반 화살표는 계산이 쓰는 풍향 기준 벡터와 같은 방향이다(0·90·180·270°)", () => {
  render(<AirflowWorkbench />);
  const expectedSide = {
    0: { from: "위(북)", fromX: 0, fromY: -1 },
    90: { from: "오른쪽(동)", fromX: 1, fromY: 0 },
    180: { from: "아래(남)", fromX: 0, fromY: 1 },
    270: { from: "왼쪽(서)", fromX: -1, fromY: 0 },
  } as const;
  for (const deg of [0, 90, 180, 270] as const) {
    setDirection(deg);
    const from = endpoint("wind-from-arrow");
    const travel = endpoint("wind-travel-arrow");
    const e = expectedSide[deg];
    // 바람이 오는 쪽 화살표는 그 방위를 가리키고, 이동 방향 화살표는 정반대를 가리킨다.
    expect(from.x / ARROW, `풍향 ${deg}° ${e.from}`).toBeCloseTo(e.fromX, 6);
    expect(from.y / ARROW).toBeCloseTo(e.fromY, 6);
    expect(travel.x / ARROW).toBeCloseTo(-e.fromX, 6);
    expect(travel.y / ARROW).toBeCloseTo(-e.fromY, 6);
    // 계산의 기준 벡터(화면의 y는 아래로 증가하므로 north는 부호가 반대)와 같다.
    const solverFrom = windFromVector(deg);
    const solverTravel = windTravelVector(deg);
    expect(from.x / ARROW).toBeCloseTo(solverFrom.east, 6);
    expect(-from.y / ARROW).toBeCloseTo(solverFrom.north, 6);
    expect(travel.x / ARROW).toBeCloseTo(solverTravel.east, 6);
    expect(-travel.y / ARROW).toBeCloseTo(solverTravel.north, 6);
  }
});

test("기존 풍향·풍속 입력은 그대로 동작한다", () => {
  render(<AirflowWorkbench />);
  const direction = screen.getByLabelText(/풍향/) as HTMLInputElement;
  const speed = screen.getByLabelText(/풍속/) as HTMLInputElement;
  expect(direction).toHaveValue("270");
  expect(speed).toHaveValue("3");
  fireEvent.change(speed, { target: { value: "7.5" } });
  expect(screen.getByText("7.5 m/s")).toBeInTheDocument();
  setDirection(45);
  expect(screen.getByTestId("wind-summary")).toHaveTextContent("북동쪽에서 불어와 남서쪽으로 이동");
});

const furnitureButtons = () =>
  within(screen.getByRole("group", { name: "가구 선택" })).getAllByRole("button");

test("선택한 가구를 삭제하면 목록과 평면도에서 사라지고 선택이 해제된다", () => {
  render(<AirflowWorkbench />);
  const before = furnitureButtons().length;
  fireEvent.click(screen.getByRole("button", { name: "식탁" }));
  expect(screen.getByTestId("furniture-table")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "선택한 가구 삭제" }));

  expect(screen.queryByTestId("furniture-table")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "식탁" })).not.toBeInTheDocument();
  expect(furnitureButtons()).toHaveLength(before - 1);
  expect(screen.queryByRole("button", { name: "선택한 가구 삭제" })).not.toBeInTheDocument();
  expect(screen.getByText("가구를 선택하면 크기와 위치를 바꿀 수 있습니다.")).toBeInTheDocument();
  // 다른 가구는 그대로 있다.
  expect(screen.getByTestId("furniture-sofa")).toBeInTheDocument();
});

test("Delete 키로도 선택한 가구를 삭제할 수 있다", () => {
  render(<AirflowWorkbench />);
  fireEvent.keyDown(screen.getByTestId("furniture-sofa"), { key: "Delete" });
  expect(screen.queryByTestId("furniture-sofa")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "소파" })).not.toBeInTheDocument();
});

test("삭제한 뒤에도 기존 가구 추가와 충돌 방지가 동작한다", () => {
  render(<AirflowWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "식탁" }));
  fireEvent.click(screen.getByRole("button", { name: "선택한 가구 삭제" }));

  // 삭제한 자리와 같은 종류를 다시 추가할 수 있다.
  fireEvent.click(screen.getByRole("button", { name: "식탁 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "빈 공간에 추가" }));
  expect(screen.getByRole("button", { name: "식탁 2" })).toHaveAttribute("aria-pressed", "true");

  // 소파를 선택해 위로 옮기면 아파트 실내 경계(y=2)에서 막히고 안내가 뜬다(충돌 방지 유지).
  fireEvent.click(screen.getByRole("button", { name: "소파" }));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "위로 이동" }));
  expect(screen.getByTestId("furniture-sofa")).toHaveAttribute("y", "2");
  expect(screen.getByTestId("placement-notice")).toHaveTextContent("아파트 밖으로 나가는 위치입니다");
});

test("가구를 삭제하면 유동이 다시 계산되어 결과가 달라진다", async () => {
  render(<AirflowWorkbench />);
  const residual = screen.getByTestId("residual");
  const settled = () => screen.getByTestId("summary").getAttribute("aria-busy") === "false";

  await waitFor(() => expect(settled()).toBe(true), { timeout: 30_000 });
  const before = residual.textContent;
  expect(before).toMatch(/%$/);

  fireEvent.click(screen.getByRole("button", { name: "식탁" }));
  fireEvent.click(screen.getByRole("button", { name: "선택한 가구 삭제" }));
  expect(screen.getByTestId("summary")).toHaveAttribute("aria-busy", "true");

  await waitFor(() => expect(settled()).toBe(true), { timeout: 30_000 });
  expect(residual.textContent).toMatch(/%$/);
  expect(residual.textContent).not.toBe(before);
}, 90_000);
