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
} from "@/lib/ventilation";

import { FlowCanvas } from "./FlowCanvas";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const level = (value: number) => `${Math.round(value * 100)}%`;

function signedPoints(delta: number): string {
  const points = delta * 100;
  if (Math.abs(points) < 0.05) return "±0.0%p";
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}%p`;
}

export function OptimizerPanel({
  layout,
  outcome,
  stale,
  running,
  progress,
  onSearch,
  onApply,
}: {
  layout: Layout;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>창문 개방 조합 자동 탐색</CardTitle>
        <CardDescription>
          두 창의 개방률 3단계 조합 9개를 같은 조건으로 계산하고, 60초 뒤 추적 물질 잔류율이 낮은 조합을 추천합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSearch} disabled={running}>
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

            <Alert>
              <AlertTitle>
                {noMeaningfulGain
                  ? "현재 조건과 유의한 차이가 있는 조합이 없습니다"
                  : `추천: 창 A ${level(best.windowOpenness.A)} · 창 B ${level(best.windowOpenness.B)}`}
              </AlertTitle>
              <AlertDescription>
                {noMeaningfulGain
                  ? "현재 조건이 이미 가장 유리하거나, 조합 사이의 차이가 작습니다."
                  : `현재 조건보다 잔류율이 ${(gain * 100).toFixed(1)}%p 낮습니다. 교육용 상대 비교이며 실제 성능이 아닙니다.`}
              </AlertDescription>
            </Alert>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>구분</TableHead>
                  <TableHead>창 A</TableHead>
                  <TableHead>창 B</TableHead>
                  <TableHead className="text-right">잔류율</TableHead>
                  <TableHead className="text-right">현재 대비</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow data-testid="row-current">
                  <TableCell>
                    <Badge variant="secondary">현재 조건</Badge>
                  </TableCell>
                  <TableCell>{level(outcome.current.windowOpenness.A)}</TableCell>
                  <TableCell>{level(outcome.current.windowOpenness.B)}</TableCell>
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
                      </div>
                    </TableCell>
                    <TableCell>{level(entry.windowOpenness.A)}</TableCell>
                    <TableCell>{level(entry.windowOpenness.B)}</TableCell>
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
                      {title} · 창 A {level(entry.windowOpenness.A)} / 창 B {level(entry.windowOpenness.B)}
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
