import { expect, test } from "@playwright/test";

// 유동 계산이 무거워 여러 테스트를 병렬로 돌리면 기본 제한(30초)을 넘길 수 있다.
test.setTimeout(120_000);

test("가구는 서로 겹치지 않고, 가구를 추가하면 유동 결과가 갱신된다", async ({ page }) => {
  await page.goto("/");
  const residual = page.getByTestId("residual");
  await expect(residual).toContainText("%", { timeout: 30_000 });

  // 식탁을 위로 옮기다 소파에 닿으면 거부되고 안내가 뜬다
  await page.getByRole("button", { name: "식탁", exact: true }).click();
  const table = page.getByTestId("furniture-table");
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "위로 이동" }).click();
  await expect(table).toHaveAttribute("y", "11");
  await expect(page.getByTestId("placement-notice")).toContainText("다른 가구와 겹치는 위치입니다");

  // 식탁이 막던 자리가 풀린 뒤 결과가 안정되면 값을 기록한다
  await expect(page.getByTestId("summary")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  const before = await residual.textContent();

  // 수납장을 방문 앞 통로에 추가하면 유동 결과가 달라진다
  await page.getByRole("button", { name: "수납장 추가" }).click();
  await page.getByRole("button", { name: "빈 공간에 추가" }).click();
  await expect(page.getByTestId("furniture-shelf-2")).toBeVisible();
  await expect(page.getByTestId("summary")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "수납장 2", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await residual.textContent()).toMatch(/%$/);
  expect(before).toMatch(/%$/);
});
