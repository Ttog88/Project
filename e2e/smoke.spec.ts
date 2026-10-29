import { expect, test } from "@playwright/test";

// 다른 테스트의 유동 계산 부하로 페이지 준비가 늦어질 수 있어 시간 제한을 늘린다.
test.setTimeout(120_000);

test("홈 화면이 열리고 교육용 안내와 계산 결과가 보인다", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Apartment Airflow Optimizer");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Apartment Airflow Optimizer");
  await expect(page.getByTestId("disclaimer")).toBeVisible();
  await expect(page.getByTestId("residual")).toContainText("%", { timeout: 30_000 });
});
