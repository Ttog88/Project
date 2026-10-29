const NAMES = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

/** 각도(0=북, 시계 방향)를 8방위 이름으로 바꾼다. 예: 270 → "서" */
export function directionName(deg: number): string {
  return NAMES[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** 각도를 0~359 범위로 맞춘다. */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
