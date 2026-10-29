export { createSampleLayout } from "./sample";
export {
  FURNITURE_CATALOG,
  FURNITURE_MAX,
  FURNITURE_MIN,
  addFurniture,
  checkPlacement,
  placeFurniture,
  type AddFurnitureResult,
  type FurnitureKind,
  type PlacementCheck,
  type PlacementReason,
  type PlacementResult,
} from "./furniture";
export { rasterize } from "./rasterize";
export type { Cell, RasterPlan, RasterOpening } from "./rasterize";
export {
  GRID,
  OPENNESS_LEVELS,
  type Furniture,
  type Layout,
  type Openness,
  type Rect,
  type WindowDef,
  type WindowId,
  type WindowOpenness,
  type WindowSide,
} from "./types";
