import { expect, test } from "@playwright/test";

test("홈 화면이 열리고 교육용 안내와 계산 결과가 보인다", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Apartment Airflow Optimizer");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Apartment Airflow Optimizer");
  await expect(page.getByTestId("disclaimer")).toBeVisible();
  await expect(page.getByTestId("residual")).toContainText("%", { timeout: 30_000 });
});
