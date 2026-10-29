import { expect, test, type Page } from "@playwright/test";

// 유동 계산이 무거워 여러 테스트를 병렬로 돌리면 기본 제한(30초)을 넘길 수 있다.
test.setTimeout(120_000);

const setRange = (page: Page, id: string, value: number) =>
  page.locator(`#${id}`).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

const settled = (page: Page) =>
  expect(page.getByTestId("summary")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });

test("평면도에 북쪽 화살표가 있고, 풍향을 바꾸면 나침반 화살표와 유입 창이 함께 바뀐다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("north-arrow").first()).toBeVisible();
  await expect(page.getByTestId("wind-compass")).toBeVisible();
  await settled(page);

  // 기본 풍향 270°: 서쪽에서 불어와 동쪽으로 이동, 서쪽 창(A)으로 들어온다.
  await expect(page.getByTestId("wind-summary")).toHaveText("서쪽에서 불어와 동쪽으로 이동");
  await expect(page.getByTestId("wind-from-arrow")).toHaveAttribute("data-bearing", "270");
  await expect(page.getByTestId("wind-travel-arrow")).toHaveAttribute("data-bearing", "90");
  await expect(page.getByTestId("flow-direction")).toHaveText("창 A → 창 B");

  // 풍향 90°: 동쪽에서 불어와 서쪽으로 이동, 흐름 방향이 반대로 바뀐다.
  await setRange(page, "wind-direction", 90);
  await expect(page.getByTestId("wind-summary")).toHaveText("동쪽에서 불어와 서쪽으로 이동");
  await expect(page.getByTestId("wind-from-arrow")).toHaveAttribute("data-bearing", "90");
  await expect(page.getByTestId("flow-direction")).toHaveText("창 B → 창 A", { timeout: 30_000 });

  // 풍속 입력도 그대로 동작한다.
  await setRange(page, "wind-speed", 0);
  await expect(page.getByTestId("flow-direction")).toHaveText("통과 흐름 없음", { timeout: 30_000 });
});

test("선택한 가구를 삭제하면 목록·평면도에서 사라지고 유동이 다시 계산된다", async ({ page }) => {
  await page.goto("/");
  await settled(page);
  const residual = page.getByTestId("residual");
  const before = await residual.textContent();
  expect(before).toMatch(/%$/);

  await page.getByRole("button", { name: "식탁", exact: true }).click();
  await expect(page.getByTestId("furniture-table")).toHaveCount(1);
  await page.getByRole("button", { name: "선택한 가구 삭제" }).click();

  await expect(page.getByTestId("furniture-table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "식탁", exact: true })).toHaveCount(0);
  await settled(page);
  await expect(residual).not.toHaveText(before ?? "");

  // 다른 가구의 이동은 그대로 되고, 충돌 방지도 유지된다.
  await page.getByRole("button", { name: "소파", exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "위로 이동" }).click();
  await expect(page.getByTestId("furniture-sofa")).toHaveAttribute("y", "2");
  await expect(page.getByTestId("placement-notice")).toBeVisible();
});
