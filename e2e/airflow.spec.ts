import { expect, test } from "@playwright/test";

// 유동 계산이 무거워 여러 테스트를 병렬로 돌리면 기본 제한(30초)을 넘길 수 있다.
test.setTimeout(120_000);

test("가구와 창문을 바꾸고 자동 탐색해 추천 조건을 현재 조건과 비교한다", async ({ page }) => {
  await page.goto("/");
  const residual = page.getByTestId("residual");
  await expect(residual).toContainText("%", { timeout: 30_000 });

  // 창 A 0% → 통과 흐름이 없어 잔류율 100%
  await page.getByRole("group", { name: "창 A 개방률" }).getByRole("button", { name: "0%", exact: true }).click();
  await expect(page.getByTestId("flow-direction")).toHaveText("통과 흐름 없음", { timeout: 30_000 });
  await expect(residual).toHaveText("100.0%");

  // 창 A 100%, 창 B 50%로 되돌리면 창 A → 창 B로 흐른다
  await page.getByRole("group", { name: "창 A 개방률" }).getByRole("button", { name: "100%", exact: true }).click();
  await page.getByRole("group", { name: "창 B 개방률" }).getByRole("button", { name: "50%", exact: true }).click();
  await expect(page.getByTestId("flow-direction")).toHaveText("창 A → 창 B", { timeout: 30_000 });
  const before = await residual.textContent();

  // 가구를 옮기면 유동이 다시 계산되어 결과가 달라진다
  await page.getByRole("button", { name: "식탁", exact: true }).click();
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "위로 이동" }).click();
  await expect(residual).not.toHaveText(before ?? "", { timeout: 30_000 });

  // 자동 탐색: 상위 3개와 현재 조건이 표에 나오고, 나란히 비교할 수 있다
  await page.getByRole("button", { name: "최적 조합 탐색" }).click();
  await expect(page.getByTestId("search-results")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("row-current")).toBeVisible();
  for (const rank of [1, 2, 3]) await expect(page.getByTestId(`row-top-${rank}`)).toBeVisible();
  // 나란히 비교하는 평면도는 2개이고, 각각 북쪽 화살표가 있다.
  await expect(page.getByTestId("comparison").locator("canvas")).toHaveCount(2);
  await expect(page.getByTestId("comparison").getByTestId("north-arrow")).toHaveCount(2);
});
