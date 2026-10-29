import type { PlacementReason } from "@/lib/floorplan";

const REASON_TEXT: Record<PlacementReason | "nospace", string> = {
  furniture: "다른 가구와 겹치는 위치입니다.",
  wall: "벽과 겹치는 위치입니다.",
  outside: "아파트 밖으로 나가는 위치입니다.",
  opening: "창문이나 방문 개구부를 막는 위치입니다.",
  size: "가구 크기는 최소 2칸, 최대 30칸입니다.",
  nospace: "가구를 놓을 빈 공간이 부족합니다.",
};

/** 배치가 거부됐을 때 사용자에게 보여 줄 한 줄 안내. */
export function placementMessage(reason: PlacementReason | "nospace", action: "edit" | "add"): string {
  if (action === "add") return `가구를 추가하지 않았습니다. ${REASON_TEXT[reason]}`;
  return `${REASON_TEXT[reason]} 마지막 유효한 배치를 유지합니다.`;
}
