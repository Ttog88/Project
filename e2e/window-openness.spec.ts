import { expect, test, type Page } from "@playwright/test";

// 유동 계산이 무거워 여러 테스트를 병렬로 돌리면 기본 제한(30초)을 넘길 수 있다.
test.setTimeout(120_000);

const slider = (page: Page, id: "A" | "B") =>
  page.getByRole("slider", { name: `창 ${id} 개방률 세밀 조절(5% 단위)` });

const setOpenness = (page: Page, id: "A" | "B", percent: number) =>
  slider(page, id).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, percent);

const settled = (page: Page) =>
  expect(page.getByTestId("summary")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });

test("5% 단위로 개방률을 조절하면 설정·적용 값이 구분되어 보이고 유동이 다시 계산된다", async ({ page }) => {
  await page.goto("/");
  const residual = page.getByTestId("residual");
  await settled(page);

  // 기본값(창 A 100%, 창 B 50%)과 기존 빠른 설정 버튼
  await expect(slider(page, "A")).toHaveValue("100");
  await expect(page.getByTestId("window-B-applied")).toHaveText("설정 50% → 적용 50% (8/16칸, 1.3 m)");
  const quick = page.getByRole("group", { name: "창 A 개방률" });
  await expect(quick.getByRole("button")).toHaveText(["0%", "50%", "100%"]);

  // 설정 55% → 적용 56%(9/16칸, 1.5 m)
  await setOpenness(page, "A", 55);
  await expect(page.getByTestId("window-A-applied")).toHaveText("설정 55% → 적용 56% (9/16칸, 1.5 m)");
  await settled(page);
  const r55 = await residual.textContent();
  expect(r55).toMatch(/%$/);

  // 10%와 15%는 같은 열린 칸 수(2칸)라 안내가 뜨고 결과도 같다
  await setOpenness(page, "A", 10);
  await expect(page.getByTestId("window-A-same")).toHaveText(
    "이 창에서는 10~15%가 같은 열린 폭(2칸)으로 계산됩니다."
  );
  await settled(page);
  const r10 = await residual.textContent();
  await setOpenness(page, "A", 15);
  await expect(page.getByTestId("window-A-applied")).toHaveText("설정 15% → 적용 13% (2/16칸, 0.3 m)");
  await settled(page);
  await expect(residual).toHaveText(r10 ?? "");

  // 5%는 1칸으로 달라지므로 결과가 바뀐다
  await setOpenness(page, "A", 5);
  await settled(page);
  await expect(residual).not.toHaveText(r10 ?? "");

  // 0%는 닫힘이라 통과 흐름이 없다
  await setOpenness(page, "A", 0);
  await expect(page.getByTestId("window-A-applied")).toHaveText("설정 0% → 적용 0%(닫힘)");
  await expect(page.getByTestId("flow-direction")).toHaveText("통과 흐름 없음", { timeout: 30_000 });
  await expect(residual).toHaveText("100.0%");

  // 빠른 설정 버튼 100%로 돌아오면 슬라이더도 함께 움직인다
  await quick.getByRole("button", { name: "100%", exact: true }).click();
  await expect(slider(page, "A")).toHaveValue("100");
  await expect(page.getByTestId("flow-direction")).toHaveText("창 A → 창 B", { timeout: 30_000 });
});

test("현재 개방률이 55%처럼 탐색 단계에 없어도 자동 탐색이 현재 행과 5단계 25개 조합 추천을 보여 준다", async ({ page }) => {
  await page.goto("/");
  await settled(page);
  await setOpenness(page, "A", 55);
  await settled(page);

  await page.getByRole("button", { name: "최적 조합 탐색" }).click();
  await expect(page.getByTestId("search-results")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("row-current")).toContainText("55%");
  for (const rank of [1, 2, 3]) await expect(page.getByTestId(`row-top-${rank}`)).toBeVisible();
  await expect(page.getByTestId("row-top-1")).toContainText("100%100%");
  await expect(page.getByTestId("search-scope")).toContainText("현재 조건이 탐색 조합에 없어 따로 1회 계산합니다.");
});
