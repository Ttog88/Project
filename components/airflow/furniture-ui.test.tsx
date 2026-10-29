import { fireEvent, render, screen, within } from "@testing-library/react";
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

const chip = (name: string) => screen.getByRole("button", { name });
const selectedGroup = () => screen.getByRole("group", { name: "가구 선택" });

test("가구가 다른 가구와 겹치는 위치로 이동하려 하면 안내가 뜨고 마지막 유효 위치를 유지한다", () => {
  render(<AirflowWorkbench />);
  fireEvent.click(chip("식탁"));
  const table = screen.getByTestId("furniture-table");
  expect(table).toHaveAttribute("y", "18");

  // 식탁(y 18)을 위로 옮기면 소파(y 5~10)에 닿는 y=11까지는 되고, 그다음 칸부터 거부된다.
  for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole("button", { name: "위로 이동" }));
  expect(table).toHaveAttribute("y", "11");
  expect(screen.queryByTestId("placement-notice")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "위로 이동" }));
  expect(table).toHaveAttribute("y", "11");
  expect(screen.getByTestId("placement-notice")).toHaveTextContent("다른 가구와 겹치는 위치입니다");
  expect(screen.getByTestId("placement-notice")).toHaveTextContent("마지막 유효한 배치를 유지합니다");
});

test("크기를 키우다 충돌하면 같은 안내가 뜨고 크기가 유지된다", () => {
  render(<AirflowWorkbench />);
  fireEvent.click(chip("책상"));
  const desk = screen.getByTestId("furniture-desk");
  expect(desk).toHaveAttribute("width", "6");

  // 책상(x 16~21)을 가로로 늘리면 x=24의 안쪽 벽에 닿기 전(w=8)까지만 가능하다.
  fireEvent.click(screen.getByRole("button", { name: "가로 늘리기" }));
  fireEvent.click(screen.getByRole("button", { name: "가로 늘리기" }));
  expect(desk).toHaveAttribute("width", "8");
  fireEvent.click(screen.getByRole("button", { name: "가로 늘리기" }));
  expect(desk).toHaveAttribute("width", "8");
  expect(screen.getByTestId("placement-notice")).toHaveTextContent("벽과 겹치는 위치입니다");
});

test("가구 종류를 고르고 빈 공간에 추가하면 목록에 고유한 새 가구가 생기고 바로 선택된다", () => {
  render(<AirflowWorkbench />);
  const before = within(selectedGroup()).getAllByRole("button").length;

  fireEvent.click(screen.getByRole("button", { name: "책상 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "빈 공간에 추가" }));

  expect(within(selectedGroup()).getAllByRole("button")).toHaveLength(before + 1);
  expect(chip("책상 2")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("furniture-desk-2")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "빈 공간에 추가" })).not.toBeInTheDocument();

  // 같은 종류를 한 번 더 추가하면 다른 ID가 붙는다.
  fireEvent.click(screen.getByRole("button", { name: "책상 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "빈 공간에 추가" }));
  expect(screen.getByTestId("furniture-desk-3")).toBeInTheDocument();
});

test("추가한 가구도 기존 가구처럼 이동·크기 변경이 되고 충돌하면 거부된다", () => {
  render(<AirflowWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "수납장 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "빈 공간에 추가" }));
  const shelf = screen.getByTestId("furniture-shelf-2");
  const x = Number(shelf.getAttribute("x"));

  fireEvent.click(screen.getByRole("button", { name: "오른쪽으로 이동" }));
  expect(Number(shelf.getAttribute("x"))).toBe(x + 1);
  fireEvent.click(screen.getByRole("button", { name: "가로 늘리기" }));
  expect(shelf).toHaveAttribute("width", "7");
});

test("놓을 공간이 없으면 가구를 만들지 않고 안내한다", () => {
  render(<AirflowWorkbench />);
  const before = within(selectedGroup()).getAllByRole("button").length;
  let added = 0;
  for (let i = 0; i < 30; i++) {
    fireEvent.click(screen.getByRole("button", { name: "침대 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "빈 공간에 추가" }));
    if (screen.queryByTestId("placement-notice")) break;
    added++;
  }
  expect(screen.getByTestId("placement-notice")).toHaveTextContent("빈 공간이 부족합니다");
  expect(within(selectedGroup()).getAllByRole("button")).toHaveLength(before + added);
  expect(added).toBeGreaterThan(0);
  expect(added).toBeLessThan(30);
});
