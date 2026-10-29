import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import Home from "@/app/page";

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

test("홈 화면은 제목, 교육용 안내, 주요 조작부를 보여준다", () => {
  render(<Home />);

  expect(
    screen.getByRole("heading", { level: 1, name: /Apartment Airflow Optimizer/ })
  ).toBeInTheDocument();
  expect(screen.getByTestId("disclaimer")).toHaveTextContent(
    "실제 아파트의 환기 성능을 검증하거나 보증한 결과가 아니며"
  );
  expect(screen.getByRole("group", { name: "창 A 개방률" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "창 B 개방률" })).toBeInTheDocument();
  expect(screen.getByLabelText(/풍향/)).toBeInTheDocument();
  expect(screen.getByLabelText(/풍속/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "최적 조합 탐색" })).toBeEnabled();
});
