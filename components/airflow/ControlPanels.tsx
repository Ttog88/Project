"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FURNITURE_CATALOG,
  FURNITURE_MAX,
  FURNITURE_MIN,
  OPENNESS_LEVELS,
  OPENNESS_STEP_PERCENT,
  describeOpening,
  type FurnitureKind,
  type Layout,
  type Openness,
  type Rect,
  type WindowOpenness,
} from "@/lib/floorplan";

import { directionName } from "./compass";
import { WindCompass } from "./WindCompass";

export { directionName };

/** 창 개방률(%) 슬라이더 값을 5% 단위로 맞춰 0~1로 바꾼다. */
function percentToOpenness(value: number): number {
  const step = OPENNESS_STEP_PERCENT;
  const snapped = Math.min(100, Math.max(0, Math.round(value / step) * step));
  return snapped / 100;
}

export function WindowControls({
  layout,
  openness,
  onChange,
}: {
  layout: Layout;
  openness: WindowOpenness;
  onChange: (next: WindowOpenness) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>창문 개방률</CardTitle>
        <CardDescription>
          창은 서로 다른 외벽에 있는 벽 개구부입니다. 0~100%를 5% 단위로 조절합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {layout.windows.map((win) => {
          const applied = describeOpening(win.length, openness[win.id]);
          const closed = applied.openCells === 0;
          return (
            <div key={win.id} className="flex flex-col gap-1.5" data-testid={`window-${win.id}`}>
              <span className="text-sm font-medium">
                창 {win.id} · {win.label}
              </span>
              <div className="flex gap-1.5" role="group" aria-label={`창 ${win.id} 개방률`}>
                {OPENNESS_LEVELS.map((level) => (
                  <Button
                    key={level}
                    size="sm"
                    className="flex-1"
                    variant={openness[win.id] === level ? "default" : "outline"}
                    aria-pressed={openness[win.id] === level}
                    onClick={() => onChange({ ...openness, [win.id]: level as Openness })}
                  >
                    {Math.round(level * 100)}%
                  </Button>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span className="flex justify-between">
                  세밀 조절(5% 단위)
                  <span className="tabular-nums">{applied.settingPercent}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={OPENNESS_STEP_PERCENT}
                  value={applied.settingPercent}
                  aria-label={`창 ${win.id} 개방률 세밀 조절(5% 단위)`}
                  onChange={(event) =>
                    onChange({ ...openness, [win.id]: percentToOpenness(Number(event.target.value)) })
                  }
                  className="w-full accent-primary"
                />
              </label>
              <p className="text-xs tabular-nums" data-testid={`window-${win.id}-applied`}>
                설정 {applied.settingPercent}% → 적용 {applied.appliedPercent}%
                {closed
                  ? "(닫힘)"
                  : ` (${applied.openCells}/${applied.lengthCells}칸, ${applied.widthMeters.toFixed(1)} m)`}
              </p>
              {applied.sameSettings ? (
                <p className="text-xs text-muted-foreground" data-testid={`window-${win.id}-same`}>
                  {closed
                    ? `이 창에서는 ${applied.sameSettings.fromPercent}~${applied.sameSettings.toPercent}%가 모두 닫힘(0칸)으로 계산됩니다.`
                    : `이 창에서는 ${applied.sameSettings.fromPercent}~${applied.sameSettings.toPercent}%가 같은 열린 폭(${applied.openCells}칸)으로 계산됩니다.`}
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function WindControls({
  direction,
  speed,
  onDirection,
  onSpeed,
}: {
  direction: number;
  speed: number;
  onDirection: (deg: number) => void;
  onSpeed: (speed: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>풍향·풍속</CardTitle>
        <CardDescription>풍향은 바람이 불어오는 방향입니다(0°=북, 90°=동).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <WindCompass direction={direction} />
        <label className="flex flex-col gap-1.5 text-sm" htmlFor="wind-direction">
          <span className="flex justify-between font-medium">
            풍향
            <span className="font-normal text-muted-foreground tabular-nums">
              {direction}° ({directionName(direction)}풍)
            </span>
          </span>
          <input
            id="wind-direction"
            type="range"
            min={0}
            max={355}
            step={5}
            value={direction}
            onChange={(event) => onDirection(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm" htmlFor="wind-speed">
          <span className="flex justify-between font-medium">
            풍속
            <span className="font-normal text-muted-foreground tabular-nums">
              {speed.toFixed(1)} m/s
            </span>
          </span>
          <input
            id="wind-speed"
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={speed}
            onChange={(event) => onSpeed(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </label>
      </CardContent>
    </Card>
  );
}

export function FurniturePanel({
  layout,
  selectedId,
  onSelect,
  onEdit,
  pendingKind,
  onPendingKind,
  onAddInEmptySpace,
  onDelete,
}: {
  layout: Layout;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 이동·크기 변경 요청(충돌 판정은 호출한 쪽에서 처리) */
  onEdit: (id: string, rect: Rect) => void;
  pendingKind: FurnitureKind | null;
  onPendingKind: (kind: FurnitureKind | null) => void;
  onAddInEmptySpace: () => void;
  /** 선택한 가구 삭제(확인·되돌리기 없음) */
  onDelete: (id: string) => void;
}) {
  const selected = layout.furniture.find((f) => f.id === selectedId) ?? null;
  const meters = (cells: number) => (cells / 6).toFixed(1);
  const apply = (dx: number, dy: number, dw: number, dh: number) => {
    if (!selected) return;
    onEdit(selected.id, {
      x: selected.x + dx,
      y: selected.y + dy,
      w: selected.w + dw,
      h: selected.h + dh,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>가구</CardTitle>
        <CardDescription>평면도에서 끌어 옮기고, 모서리 핸들이나 아래 버튼으로 크기를 바꿉니다.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="가구 선택">
          {layout.furniture.map((f) => (
            <Button
              key={f.id}
              size="xs"
              variant={f.id === selectedId ? "default" : "outline"}
              aria-pressed={f.id === selectedId}
              onClick={() => onSelect(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {selected ? (
          <div className="flex flex-col gap-2 text-sm" data-testid="furniture-controls">
            <p className="text-muted-foreground tabular-nums">
              {selected.label}: {meters(selected.w)} × {meters(selected.h)} m
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1" role="group" aria-label="가로 크기">
                <span className="w-8 text-xs text-muted-foreground">가로</span>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="가로 줄이기"
                  disabled={selected.w <= FURNITURE_MIN}
                  onClick={() => apply(0, 0, -1, 0)}
                >
                  <Minus />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="가로 늘리기"
                  disabled={selected.w >= FURNITURE_MAX}
                  onClick={() => apply(0, 0, 1, 0)}
                >
                  <Plus />
                </Button>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="세로 크기">
                <span className="w-8 text-xs text-muted-foreground">세로</span>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="세로 줄이기"
                  disabled={selected.h <= FURNITURE_MIN}
                  onClick={() => apply(0, 0, 0, -1)}
                >
                  <Minus />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="세로 늘리기"
                  disabled={selected.h >= FURNITURE_MAX}
                  onClick={() => apply(0, 0, 0, 1)}
                >
                  <Plus />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="위치 이동">
              <span className="w-8 text-xs text-muted-foreground">이동</span>
              <Button size="icon-sm" variant="outline" aria-label="왼쪽으로 이동" onClick={() => apply(-1, 0, 0, 0)}>
                <ArrowLeft />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label="위로 이동" onClick={() => apply(0, -1, 0, 0)}>
                <ArrowUp />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label="아래로 이동" onClick={() => apply(0, 1, 0, 0)}>
                <ArrowDown />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label="오른쪽으로 이동" onClick={() => apply(1, 0, 0, 0)}>
                <ArrowRight />
              </Button>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="self-start"
              aria-label="선택한 가구 삭제"
              onClick={() => onDelete(selected.id)}
            >
              <Trash2 data-icon="inline-start" />
              삭제
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">가구를 선택하면 크기와 위치를 바꿀 수 있습니다.</p>
        )}

        <div className="flex flex-col gap-2 border-t pt-3" data-testid="add-furniture">
          <span className="text-sm font-medium">가구 추가</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="추가할 가구 종류">
            {FURNITURE_CATALOG.map((item) => (
              <Button
                key={item.kind}
                size="xs"
                variant={pendingKind === item.kind ? "default" : "outline"}
                aria-pressed={pendingKind === item.kind}
                aria-label={`${item.label} 추가`}
                onClick={() => onPendingKind(pendingKind === item.kind ? null : item.kind)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          {pendingKind ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                평면도에서 놓을 위치를 클릭하거나, 아래 버튼으로 빈 공간에 바로 추가하세요.
              </p>
              <Button size="sm" variant="secondary" onClick={onAddInEmptySpace}>
                빈 공간에 추가
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">추가할 가구 종류를 먼저 고르세요.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
