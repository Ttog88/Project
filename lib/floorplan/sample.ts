import type { Layout } from "./types";

/** 교육용 가상 아파트: 서쪽 침실, 동쪽 거실, 방문 1개, 창문 2개(서쪽 외벽·남쪽 외벽). */
export function createSampleLayout(): Layout {
  return {
    walls: [
      { x: 0, y: 0, w: 60, h: 2 },
      { x: 0, y: 40, w: 60, h: 2 },
      { x: 0, y: 0, w: 2, h: 42 },
      { x: 58, y: 0, w: 2, h: 42 },
      { x: 24, y: 2, w: 1, h: 16 },
      { x: 24, y: 26, w: 1, h: 14 },
    ],
    door: { x: 24, y: 18, w: 1, h: 8 },
    windows: [
      { id: "A", label: "침실 창(서)", side: "west", start: 14, length: 16 },
      { id: "B", label: "거실 창(남)", side: "south", start: 34, length: 16 },
    ],
    furniture: [
      { id: "bed", label: "침대", x: 4, y: 4, w: 10, h: 14 },
      { id: "wardrobe", label: "옷장", x: 3, y: 32, w: 10, h: 4 },
      { id: "desk", label: "책상", x: 16, y: 4, w: 6, h: 4 },
      { id: "sofa", label: "소파", x: 28, y: 5, w: 14, h: 6 },
      { id: "table", label: "식탁", x: 36, y: 18, w: 8, h: 6 },
      { id: "shelf", label: "수납장", x: 50, y: 6, w: 6, h: 12 },
    ],
  };
}
