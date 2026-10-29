"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Layout, WindowOpenness } from "@/lib/floorplan";
import {
  MEANINGFUL_DIFFERENCE,
  type CombinationEntry,
  type SearchOutcome,
  type SearchPlan,
} from "@/lib/ventilation";

import { FlowCanvas } from "./FlowCanvas";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const level = (value: number) => `${Math.round(value * 100)}%`;
const levelsText = (levels: readonly number[]) =>
  `${levels.map((l) => Math.round(l * 100)).join("·")}%`;

function signedPoints(delta: number): string {
  const points = delta * 100;
  if (Math.abs(points) < 0.05) return "±0.0%p";
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}%p`;
}

/** 탐색 범위(전체/제한 평가, 사용한 단계, 평가·계산·생략 조합 수, 고정한 창)를 한 덩어리로 보여 준다. */
function ScopeSummary({
  plan,
  testId,
  currentSeparate,
}: {
  plan: SearchPlan;
  testId: string;
  currentSeparate: boolean;
}) {
  const limited = plan.mode === "limited";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3 text-sm" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={limited ? "outline" : "default"} data-testid={`${testId}-mode`}>
          {limited ? "제한 평가" : "전체 평가"}
        </Badge>
        <span className="font-medium" data-testid={`${testId}-levels`}>
          {plan.levels.length}단계({levelsText(plan.levels)})
        </span>
        <span className="tabular-nums" data-testid={`${testId}-counts`}>
          평가 {plan.totalCombos}조합
          {limited ? ` / 5단계 전체 ${plan.fullTotal}조합` : ""}
          {" "}(계산 {plan.computeCount} · 계산 생략 {plan.skippedCount})
        </span>
      </div>
      {plan.levelsReduced ? (
        <p className="text-xs text-muted-foreground">
          5단계로는 계산 대상이 {plan.fullCompute}개로 상한 {plan.limit}개를 넘어 {plan.levels.length}단계로 줄였습니다.
        </p>
      ) : null}
      {plan.fixed.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-fixed`}>
          탐색한 창: {plan.searchedIds.map((id) => `창 ${id}`).join(", ")} · 현재 개방률로 고정한 창:{" "}
          {plan.fixed.map((f) => `창 ${f.id}(${level(f.openness)})`).join(", ")}
        </p>
      ) : null}
      {plan.skippedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          계산 생략은 통과 흐름이 없는 조합으로, 계산하지 않아도 잔류율이 100%로 정해집니다.
        </p>
      ) : null}
      {currentSeparate ? (
        <p className="text-xs text-muted-foreground">
          현재 조건이 탐색 조합에 없어 따로 1회 계산합니다.
        </p>
      ) : null}
    </div>
  );
}

export function OptimizerPanel({
  layout,
  plan,
  selectedWindowIds,
  onSelectWindows,
  outcome,
  stale,
  running,
  progress,
  onSearch,
  onApply,
}: {
  layout: Layout;
  /** 지금 조건에서 탐색을 시작하면 쓰게 될 계획 */
  plan: SearchPlan;
  /** 탐색할 창으로 고른 id. null이면 모든 창 */
  selectedWindowIds: string[] | null;
  onSelectWindows: (ids: string[] | null) => void;
  outcome: SearchOutcome | null;
  stale: boolean;
  running: boolean;
  progress: { done: number; total: number };
  onSearch: () => void;
  onApply: (openness: WindowOpenness) => void;
}) {
  const [compareRank, setCompareRank] = useState(1);
  const best = outcome?.top[0];
  const compared: CombinationEntry | undefined =
    outcome?.top.find((e) => e.rank === compareRank) ?? best;
  const gain = outcome && best ? outcome.current.result.residual - best.result.residual : 0;
  const noMeaningfulGain = gain < MEANINGFUL_DIFFERENCE;
  const windows = layout.windows;
  const describe = (openness: WindowOpenness) =>
    windows.map((w) => `창 ${w.id} ${level(openness[w.id] ?? 0)}`).join(" · ");
  const showSelection = plan.status === "needs-selection" || selectedWindowIds !== null;
  const checked = selectedWindowIds ?? windows.map((w) => w.id);
  const toggleWindow = (id: string, on: boolean) => {
    const next = windows.map((w) => w.id).filter((x) => (x === id ? on : checked.includes(x)));
    onSelectWindows(next.length === windows.length ? null : next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>창문 개방 조합 자동 탐색</CardTitle>
        <CardDescription>
          창 개방률 조합을 같은 조건으로 계산하고, 60초 뒤 추적 물질 잔류율이 낮은 조합을 추천합니다. 탐색 범위는 탐색 계획에 표시됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ScopeSummary plan={plan} testId="search-plan" currentSeparate={plan.currentOffGrid} />

        {plan.status === "needs-selection" ? (
          <Alert variant="destructive" data-testid="selection-required">
            <AlertTitle>탐색할 창을 골라 주세요</AlertTitle>
            <AlertDescription className="text-destructive">
              {plan.searchedIds.length === 0
                ? "탐색할 창이 없습니다."
                : `2단계로도 계산 대상이 ${plan.computeCount}개로 상한 ${plan.limit}개를 넘습니다.`}{" "}
              탐색할 창을 고르면 나머지 창은 현재 개방률로 고정합니다.
            </AlertDescription>
          </Alert>
        ) : null}

        {showSelection ? (
          <fieldset className="flex flex-col gap-2 text-sm" data-testid="window-selection">
            <legend className="mb-1 font-medium">탐색할 창</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {windows.map((w) => (
                <label key={w.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked.includes(w.id)}
                    onChange={(event) => toggleWindow(w.id, event.target.checked)}
                    className="accent-primary"
                  />
                  창 {w.id}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSearch} disabled={running || plan.status !== "ok"}>
            {running ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
            {running ? `탐색 중 ${progress.done}/${progress.total}` : "최적 조합 탐색"}
          </Button>
          <span className="text-sm text-muted-foreground">
            현재 풍향·풍속·가구 배치와 현재 창문 개방률을 기준으로 비교합니다.
          </span>
        </div>

        {running ? (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label="탐색 진행률"
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
        ) : null}

        {!outcome && !running ? (
          <p className="text-sm text-muted-foreground">
            아직 탐색하지 않았습니다. 버튼을 누르면 상위 3개 조합이 현재 조건과 함께 표시됩니다.
          </p>
        ) : null}

        {outcome && best && compared ? (
          <div className="flex flex-col gap-4" data-testid="search-results">
            {stale ? (
              <Alert>
                <AlertTitle>조건이 바뀌었습니다</AlertTitle>
                <AlertDescription>아래 결과는 이전 조건 기준입니다. 다시 탐색하세요.</AlertDescription>
              </Alert>
            ) : null}

            <ScopeSummary
              plan={outcome.plan}
              testId="search-scope"
              currentSeparate={outcome.currentComputedSeparately}
            />

            <Alert>
              <AlertTitle>
                {noMeaningfulGain
                  ? "현재 조건과 유의한 차이가 있는 조합이 없습니다"
                  : `탐색한 범위 안에서 가장 유리한 조합: ${describe(best.windowOpenness)}`}
              </AlertTitle>
              <AlertDescription>
                {noMeaningfulGain
                  ? "현재 조건이 이미 탐색한 범위 안에서 가장 유리하거나, 조합 사이의 차이가 작습니다."
                  : `현재 조건보다 잔류율이 ${(gain * 100).toFixed(1)}%p 낮습니다. 교육용 상대 비교이며 실제 성능이 아닙니다.`}{" "}
                {outcome.plan.mode === "limited"
                  ? "제한 평가이므로 전체 최적해가 아니라 탐색한 범위 안의 추천 조건입니다."
                  : "25% 간격 5단계 안에서의 결과이며, 5% 단위의 모든 값을 확인한 것은 아닙니다."}
              </AlertDescription>
            </Alert>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>구분</TableHead>
                  {windows.map((w) => (
                    <TableHead key={w.id}>창 {w.id}</TableHead>
                  ))}
                  <TableHead className="text-right">잔류율</TableHead>
                  <TableHead className="text-right">현재 대비</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow data-testid="row-current">
                  <TableCell>
                    <Badge variant="secondary">현재 조건</Badge>
                  </TableCell>
                  {windows.map((w) => (
                    <TableCell key={w.id}>{level(outcome.current.windowOpenness[w.id] ?? 0)}</TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{percent(outcome.current.result.residual)}</TableCell>
                  <TableCell className="text-right tabular-nums">—</TableCell>
                </TableRow>
                {outcome.top.map((entry) => (
                  <TableRow key={entry.rank} data-testid={`row-top-${entry.rank}`}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={entry.rank === 1 ? "default" : "outline"}>{entry.rank}위</Badge>
                        {entry.rank === outcome.current.rank ? (
                          <span className="text-xs text-muted-foreground">(현재 조건과 같음)</span>
                        ) : null}
                        {entry.skipped ? (
                          <span className="text-xs text-muted-foreground">(통과 흐름 없음)</span>
                        ) : null}
                      </div>
                    </TableCell>
                    {windows.map((w) => (
                      <TableCell key={w.id}>{level(entry.windowOpenness[w.id] ?? 0)}</TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{percent(entry.result.residual)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {signedPoints(entry.result.residual - outcome.current.result.residual)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">비교할 추천 조건</span>
              {outcome.top.map((entry) => (
                <Button
                  key={entry.rank}
                  size="xs"
                  variant={entry.rank === compared.rank ? "default" : "outline"}
                  aria-pressed={entry.rank === compared.rank}
                  onClick={() => setCompareRank(entry.rank)}
                >
                  {entry.rank}위
                </Button>
              ))}
              <Button size="xs" variant="secondary" onClick={() => onApply(compared.windowOpenness)}>
                이 조건을 현재 조건으로 적용
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2" data-testid="comparison">
              {[
                { title: "현재 조건", entry: outcome.current },
                { title: `추천 ${compared.rank}위`, entry: compared },
              ].map(({ title, entry }) => (
                <figure key={title} className="flex flex-col gap-2">
                  <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {title} · {windows.map((w) => `창 ${w.id} ${level(entry.windowOpenness[w.id] ?? 0)}`).join(" / ")}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      잔류율 {percent(entry.result.residual)} · 취약 후보 {percent(entry.result.weakShare)}
                    </span>
                  </figcaption>
                  <FlowCanvas
                    layout={layout}
                    openness={entry.windowOpenness}
                    result={entry.result}
                    showParticles
                    showTracer
                    showWeak
                    ariaLabel={`${title}의 유동과 환기 취약 후보 지도`}
                  />
                </figure>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
