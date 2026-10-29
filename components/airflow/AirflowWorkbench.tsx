"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Info, Wind } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  addFurniture,
  createSampleLayout,
  placeFurniture,
  removeFurniture,
  type FurnitureKind,
  type Layout,
  type Rect,
  type WindowOpenness,
} from "@/lib/floorplan";
import {
  searchWindowCombinations,
  simulateVentilationAsync,
  type Conditions,
  type SearchOutcome,
  type VentilationResult,
} from "@/lib/ventilation";

import { FurniturePanel, WindControls, WindowControls, directionName } from "./ControlPanels";
import { FlowCanvas } from "./FlowCanvas";
import { OptimizerPanel } from "./OptimizerPanel";
import { placementMessage } from "./placementMessages";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function AirflowWorkbench() {
  const [layout, setLayout] = useState<Layout>(() => createSampleLayout());
  const [openness, setOpenness] = useState<WindowOpenness>({ A: 1, B: 0.5 });
  const [direction, setDirection] = useState(270);
  const [speed, setSpeed] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>("table");
  const [pendingKind, setPendingKind] = useState<FurnitureKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showParticles, setShowParticles] = useState(true);
  const [showTracer, setShowTracer] = useState(true);
  const [showWeak, setShowWeak] = useState(true);

  const conditions = useMemo<Conditions>(
    () => ({ windowOpenness: openness, windDirectionDeg: direction, windSpeed: speed }),
    [openness, direction, speed]
  );

  // 안내 메시지는 잠시 뒤 사라진다.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // 이동·크기 변경은 모두 여기서 같은 충돌 판정(placeFurniture)을 거친다.
  // 거부되면 배치를 바꾸지 않고(마지막 유효 상태 유지) 안내만 띄운다.
  const editFurniture = (id: string, rect: Rect) => {
    const result = placeFurniture(layout, id, rect);
    if (result.status === "moved") setLayout(result.layout);
    else if (result.status === "rejected") setNotice(placementMessage(result.reason!, "edit"));
  };

  // 삭제하면 고체 영역과 목록이 함께 바뀌고 유동이 다시 계산된다. 확인·되돌리기는 없다.
  const deleteFurniture = (id: string) => {
    const result = removeFurniture(layout, id);
    if (result.status !== "removed") return;
    setLayout(result.layout);
    setSelectedId(null);
    setNotice(null);
  };

  const addFurnitureOfKind = (at?: { x: number; y: number }) => {
    if (!pendingKind) return;
    const result = addFurniture(layout, pendingKind, at);
    if (result.status === "added") {
      setLayout(result.layout);
      setSelectedId(result.furniture.id);
      setPendingKind(null);
      setNotice(null);
    } else {
      setNotice(placementMessage(result.reason, "add"));
    }
  };

  // 조건이 바뀌면 잠시 기다렸다가 유동장을 다시 계산한다.
  const [computed, setComputed] = useState<{ result: VentilationResult; layout: Layout } | null>(null);
  const result = computed?.result ?? null;
  const computing = !computed || computed.layout !== layout || computed.result.conditions !== conditions;
  useEffect(() => {
    const token = { cancelled: false };
    const timer = setTimeout(async () => {
      const next = await simulateVentilationAsync(layout, conditions, token);
      if (next && !token.cancelled) setComputed({ result: next, layout });
    }, 200);
    return () => {
      token.cancelled = true;
      clearTimeout(timer);
    };
  }, [layout, conditions]);

  // 자동 탐색
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [outcomeKey, setOutcomeKey] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 9 });
  const searchToken = useRef({ cancelled: false });
  const inputKey = useMemo(
    () => JSON.stringify({ f: layout.furniture, o: openness, d: direction, s: speed }),
    [layout.furniture, openness, direction, speed]
  );

  useEffect(() => () => void (searchToken.current.cancelled = true), []);

  const runSearch = async () => {
    searchToken.current.cancelled = true;
    const token = { cancelled: false };
    searchToken.current = token;
    const key = inputKey;
    setRunning(true);
    setProgress({ done: 0, total: 9 });
    const found = await searchWindowCombinations(layout, conditions, {
      signal: token,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    if (found && !token.cancelled) {
      setOutcome(found);
      setOutcomeKey(key);
    }
    if (!token.cancelled) setRunning(false);
  };

  const flow = result?.flow;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Wind className="size-6 text-primary" aria-hidden />
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Apartment Airflow Optimizer</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          가상 아파트에서 가구, 창문 개방률, 풍향·풍속을 바꿔 가며 실내 기류와 환기 취약 후보 구역을 보고, 창문 개방 조합을 자동으로 비교합니다.
        </p>
      </header>

      <Alert data-testid="disclaimer">
        <Info aria-hidden />
        <AlertTitle>교육용 상대 비교입니다</AlertTitle>
        <AlertDescription>
          2D 경량 유동 계산으로 조건 사이의 상대적 경향만 보여 줍니다. 실제 아파트의 환기 성능을 검증하거나 보증한 결과가 아니며, 모든 계산은 이 브라우저 안에서만 수행됩니다.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>평면도와 유동</CardTitle>
            <CardDescription>
              점은 계산된 속도장을 따라 움직입니다. 색은 60초 뒤 남은 추적 물질이고, 붉은 구역은 환기 취약 후보입니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <FlowCanvas
              layout={layout}
              openness={openness}
              result={result}
              showParticles={showParticles}
              showTracer={showTracer}
              showWeak={showWeak}
              ariaLabel="가상 아파트 평면도, 유동 입자, 환기 취약 후보 지도"
              editor={{
                selectedId,
                onSelect: setSelectedId,
                onEdit: editFurniture,
                placing: pendingKind !== null,
                onPlaceAt: addFurnitureOfKind,
                onDelete: deleteFurniture,
              }}
            />
            {notice ? (
              <Alert variant="destructive" role="status" data-testid="placement-notice">
                <AlertDescription className="text-destructive">{notice}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ["입자", showParticles, setShowParticles],
                  ["잔류 농도 지도", showTracer, setShowTracer],
                  ["환기 취약 후보", showWeak, setShowWeak],
                ] as const
              ).map(([label, checked, set]) => (
                <label key={label} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => set(event.target.checked)}
                    className="accent-primary"
                  />
                  {label}
                </label>
              ))}
            </div>
            <dl
              className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4"
              data-testid="summary"
              aria-busy={computing}
            >
              <div>
                <dt className="text-xs text-muted-foreground">잔류율(60초 뒤)</dt>
                <dd className="font-medium tabular-nums" data-testid="residual">
                  {result ? percent(result.residual) : "계산 중"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">환기 취약 후보 면적</dt>
                <dd className="font-medium tabular-nums" data-testid="weak-share">
                  {result ? percent(result.weakShare) : "계산 중"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">공기 흐름</dt>
                <dd className="font-medium" data-testid="flow-direction">
                  {flow?.inletIds.length
                    ? `창 ${flow.inletIds.join(", ")} → 창 ${flow.outletIds.join(", ")}`
                    : result
                      ? "통과 흐름 없음"
                      : "계산 중"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">풍향</dt>
                <dd className="font-medium">
                  {direction}° {directionName(direction)}풍
                  {computing ? <Badge className="ml-1.5" variant="outline">갱신 중</Badge> : null}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <WindowControls layout={layout} openness={openness} onChange={setOpenness} />
          <WindControls direction={direction} speed={speed} onDirection={setDirection} onSpeed={setSpeed} />
          <FurniturePanel
            layout={layout}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEdit={editFurniture}
            pendingKind={pendingKind}
            onPendingKind={setPendingKind}
            onAddInEmptySpace={() => addFurnitureOfKind()}
            onDelete={deleteFurniture}
          />
        </div>
      </div>

      <OptimizerPanel
        layout={layout}
        outcome={outcome}
        stale={outcome !== null && outcomeKey !== inputKey}
        running={running}
        progress={progress}
        onSearch={runSearch}
        onApply={setOpenness}
      />
    </div>
  );
}
