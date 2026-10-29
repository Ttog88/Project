export { createSampleLayout } from "./sample";
export {
  FURNITURE_CATALOG,
  FURNITURE_MAX,
  FURNITURE_MIN,
  addFurniture,
  checkPlacement,
  placeFurniture,
  removeFurniture,
  type AddFurnitureResult,
  type FurnitureKind,
  type PlacementCheck,
  type PlacementReason,
  type PlacementResult,
  type RemoveFurnitureResult,
} from "./furniture";
export {
  OPENNESS_STEP_PERCENT,
  describeOpening,
  openCellsFor,
  type AppliedOpening,
} from "./opening";
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
