"use client";

import { windFromVector, windTravelVector } from "@/lib/ventilation";

import { directionName, normalizeDegrees } from "./compass";

const SIZE = 160;
const CENTER = SIZE / 2;
const RIM = 56;
const ARROW = 46;

/**
 * 풍향 나침반. 풍향은 "바람이 불어오는 방향"이다(0°=북, 90°=동, 시계 방향).
 * 화살표 끝점은 계산이 쓰는 windFromVector·windTravelVector에서 그대로 구하므로
 * 화면과 Solver가 같은 각도 기준을 공유한다.
 *  - 파란 화살표: 바람이 불어오는 쪽(풍향)
 *  - 주황 화살표: 공기가 실제로 이동하는 방향(풍향 + 180°)
 */
export function WindCompass({ direction }: { direction: number }) {
  const deg = normalizeDegrees(direction);
  const from = windFromVector(deg);
  const travel = windTravelVector(deg);
  // 북쪽(north)이 화면 위쪽(y 감소)이다.
  const point = (v: { east: number; north: number }, length: number) => ({
    x: CENTER + v.east * length,
    y: CENTER - v.north * length,
  });
  const fromEnd = point(from, ARROW);
  const travelEnd = point(travel, ARROW);
  const fromName = `${directionName(deg)}쪽`;
  const travelName = `${directionName(deg + 180)}쪽`;
  const sentence = `${fromName}에서 불어와 ${travelName}으로 이동`;

  return (
    <figure className="flex flex-col items-center gap-2" data-testid="wind-compass">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-36"
        role="img"
        aria-label={`나침반: ${sentence}`}
      >
        <defs>
          <marker id="wind-head-from" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" className="fill-blue-600 dark:fill-blue-400" />
          </marker>
          <marker id="wind-head-travel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" className="fill-orange-600 dark:fill-orange-400" />
          </marker>
        </defs>
        <circle cx={CENTER} cy={CENTER} r={RIM} className="fill-muted/40 stroke-border" strokeWidth={1.5} />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((tick) => {
          const v = windFromVector(tick);
          const inner = tick % 90 === 0 ? RIM - 7 : RIM - 4;
          return (
            <line
              key={tick}
              x1={CENTER + v.east * inner}
              y1={CENTER - v.north * inner}
              x2={CENTER + v.east * RIM}
              y2={CENTER - v.north * RIM}
              className="stroke-muted-foreground"
              strokeWidth={tick % 90 === 0 ? 1.5 : 1}
            />
          );
        })}
        {(
          [
            ["N", 0, 1],
            ["E", 1, 0],
            ["S", 0, -1],
            ["W", -1, 0],
          ] as const
        ).map(([label, east, north]) => (
          <text
            key={label}
            x={CENTER + east * (RIM + 12)}
            y={CENTER - north * (RIM + 12) + 4}
            textAnchor="middle"
            className={label === "N" ? "fill-destructive text-[13px] font-bold" : "fill-muted-foreground text-[12px]"}
          >
            {label}
          </text>
        ))}
        <line
          data-testid="wind-travel-arrow"
          data-bearing={normalizeDegrees(deg + 180)}
          x1={CENTER}
          y1={CENTER}
          x2={travelEnd.x}
          y2={travelEnd.y}
          className="stroke-orange-600 dark:stroke-orange-400"
          strokeWidth={3}
          strokeLinecap="round"
          markerEnd="url(#wind-head-travel)"
        />
        <line
          data-testid="wind-from-arrow"
          data-bearing={deg}
          x1={CENTER}
          y1={CENTER}
          x2={fromEnd.x}
          y2={fromEnd.y}
          className="stroke-blue-600 dark:stroke-blue-400"
          strokeWidth={3}
          strokeLinecap="round"
          markerEnd="url(#wind-head-from)"
        />
        <circle cx={CENTER} cy={CENTER} r={3} className="fill-foreground" />
      </svg>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <li className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-blue-600 dark:bg-blue-400" />
          불어오는 쪽(풍향)
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-orange-600 dark:bg-orange-400" />
          이동 방향
        </li>
      </ul>
      <figcaption className="text-center text-sm font-medium" data-testid="wind-summary">
        {sentence}
      </figcaption>
    </figure>
  );
}
