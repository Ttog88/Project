import { GRID } from "./types";

/** 수동 개방률 조절 단위(%) */
export const OPENNESS_STEP_PERCENT = 5;

/**
 * 설정 개방률이 격자에서 실제로 열리는 칸 수. 창 길이(칸) × 설정을 가장 가까운 정수로 반올림한다(.5는 올림).
 * rasterize(고체 마스크)가 쓰는 규칙과 같다.
 */
export function openCellsFor(lengthCells: number, openness: number): number {
  return Math.round(lengthCells * openness);
}

export type AppliedOpening = {
  /** 사용자가 설정한 개방률(%) */
  settingPercent: number;
  /** 격자에서 실제로 열린 칸 수 */
  openCells: number;
  lengthCells: number;
  /** 격자에 실제로 적용된 개방률(%) = 열린 칸 수 ÷ 창 길이 */
  appliedPercent: number;
  /** 실제 열린 폭(m) */
  widthMeters: number;
  /** 같은 열린 칸 수가 되는 5% 단위 설정의 범위. 하나뿐이면 null */
  sameSettings: { fromPercent: number; toPercent: number } | null;
};

/** 설정 개방률이 격자에서 어떻게 적용되는지 설명하는 값들을 계산한다. */
export function describeOpening(lengthCells: number, openness: number): AppliedOpening {
  const openCells = openCellsFor(lengthCells, openness);
  const settingPercent = Math.round(openness * 100);
  const sameSteps: number[] = [];
  for (let percent = 0; percent <= 100; percent += OPENNESS_STEP_PERCENT) {
    if (openCellsFor(lengthCells, percent / 100) === openCells) sameSteps.push(percent);
  }
  return {
    settingPercent,
    openCells,
    lengthCells,
    appliedPercent: lengthCells > 0 ? Math.round((openCells / lengthCells) * 100) : 0,
    widthMeters: openCells * GRID.cellMeters,
    sameSettings:
      sameSteps.length > 1 && sameSteps.includes(settingPercent)
        ? { fromPercent: sameSteps[0], toPercent: sameSteps[sameSteps.length - 1] }
        : null,
  };
}
