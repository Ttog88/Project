// 평면도는 격자 셀 단위로 표현한다. x는 동쪽, y는 남쪽(화면 아래)으로 커진다.
export const GRID = { nx: 60, ny: 42, cellMeters: 1 / 6 } as const;

/** 외벽 두께(셀). 창 개구부는 이 두께만큼의 통로가 된다. */
export const WALL_THICKNESS = 2;

export type Rect = { x: number; y: number; w: number; h: number };

export type Furniture = Rect & { id: string; label: string };

/** 창 ID. 창이 몇 개든 고유한 문자열이면 된다(예: "A", "B", "W3"). */
export type WindowId = string;
export type WindowSide = "north" | "south" | "east" | "west";

export type WindowDef = {
  id: WindowId;
  label: string;
  side: WindowSide;
  /** 외벽을 따라 창이 시작하는 셀 위치 */
  start: number;
  /** 100% 개방 시 창의 길이(셀) */
  length: number;
};

export type Layout = {
  walls: Rect[];
  /** 방문(항상 열린 통로). 표시용이며 계산에서는 벽이 없는 틈이다. */
  door: Rect;
  windows: WindowDef[];
  furniture: Furniture[];
};

export const OPENNESS_LEVELS = [0, 0.5, 1] as const;
/** 창 개방률(0~1). 수동 조절은 5% 단위이고, 자동 탐색은 OPENNESS_LEVELS를 쓴다. */
export type Openness = number;
export type WindowOpenness = Record<WindowId, Openness>;
