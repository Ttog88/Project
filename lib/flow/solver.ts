// 2D 비압축성 Stable Fluids(semi-Lagrangian 이류 + 압력 투영) Solver.
// 평면도나 환기 개념을 모르는 순수 계산 모듈이며, 격자와 경계조건만 받는다.

export const CELL_FLUID = 0;
export const CELL_SOLID = 1;
/** 압력이 0으로 고정된 유출 셀(창을 통해 공기가 빠져나가는 곳) */
export const CELL_OUTLET = 2;

export type FaceVelocity = {
  /** u: 수직 면(동서 방향 속도), v: 수평 면(남북 방향 속도) */
  axis: "u" | "v";
  index: number;
  value: number;
};

export type FlowSetup = {
  nx: number;
  ny: number;
  /** 셀 한 변의 길이(m) */
  cellSize: number;
  cellType: Uint8Array;
  /** 속도가 지정된 유입 면. 바깥 경계 면이어야 한다. */
  inletFaces: FaceVelocity[];
  /** 추적 물질을 집계하는 셀(1) */
  tracked: Uint8Array;
  /** 매 스텝 추적 물질 농도를 0으로 되돌리는 셀(신선한 외기가 들어오는 곳) */
  freshAirCells: number[];
  /** 시간 간격(s) */
  dt: number;
  /** 압력 방정식 반복 횟수 */
  pressureIterations?: number;
};

export type FlowSnapshot = {
  nx: number;
  ny: number;
  /** 셀 중심 속도(m/s) */
  u: Float32Array;
  v: Float32Array;
  /** 셀 추적 물질 농도 */
  tracer: Float32Array;
  /** 집계 셀의 처음 총량 대비 현재 남은 비율(0~1) */
  residual: number;
  stepsDone: number;
};

const SOR_OMEGA = 1.7;

export class FlowSimulation {
  private readonly nx: number;
  private readonly ny: number;
  private readonly h: number;
  private readonly dt: number;
  private readonly iterations: number;
  private readonly type: Uint8Array;
  private readonly tracked: Uint8Array;
  private readonly trackedCount: number;
  private readonly freshAir: number[];

  private U: Float64Array;
  private V: Float64Array;
  private U0: Float64Array;
  private V0: Float64Array;
  private readonly fixedU: Uint8Array;
  private readonly fixedV: Uint8Array;
  private readonly valueU: Float64Array;
  private readonly valueV: Float64Array;
  private readonly pressure: Float64Array;
  private readonly divergence: Float64Array;
  private tracer: Float64Array;
  private tracer0: Float64Array;
  private steps = 0;

  constructor(setup: FlowSetup) {
    const { nx, ny } = setup;
    this.nx = nx;
    this.ny = ny;
    this.h = setup.cellSize;
    this.dt = setup.dt;
    this.iterations = setup.pressureIterations ?? 50;
    this.type = setup.cellType;
    this.tracked = setup.tracked;
    this.freshAir = setup.freshAirCells;

    this.U = new Float64Array((nx + 1) * ny);
    this.V = new Float64Array(nx * (ny + 1));
    this.U0 = new Float64Array(this.U.length);
    this.V0 = new Float64Array(this.V.length);
    this.fixedU = new Uint8Array(this.U.length);
    this.fixedV = new Uint8Array(this.V.length);
    this.valueU = new Float64Array(this.U.length);
    this.valueV = new Float64Array(this.V.length);
    this.pressure = new Float64Array(nx * ny);
    this.divergence = new Float64Array(nx * ny);
    this.tracer = new Float64Array(nx * ny);
    this.tracer0 = new Float64Array(nx * ny);

    this.classifyFaces();
    for (const f of setup.inletFaces) {
      if (f.axis === "u") {
        this.fixedU[f.index] = 1;
        this.valueU[f.index] = f.value;
        this.U[f.index] = f.value;
      } else {
        this.fixedV[f.index] = 1;
        this.valueV[f.index] = f.value;
        this.V[f.index] = f.value;
      }
    }

    let count = 0;
    for (let c = 0; c < nx * ny; c++) {
      if (this.tracked[c]) {
        this.tracer[c] = 1;
        count++;
      }
    }
    this.trackedCount = count;
  }

  /**
   * 면의 양쪽 셀을 보고 고정 면(벽·바깥 경계, 속도 0)과 자유 면을 구분한다.
   * 고정 면의 속도는 계산 내내 바뀌지 않으므로 벽을 통과하는 유동이 생기지 않는다.
   */
  private classifyFaces() {
    const { nx, ny, type } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const left = i > 0 ? type[j * nx + i - 1] : -1;
        const right = i < nx ? type[j * nx + i] : -1;
        this.fixedU[j * (nx + 1) + i] = this.isFreeFace(left, right) ? 0 : 1;
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const up = j > 0 ? type[(j - 1) * nx + i] : -1;
        const down = j < ny ? type[j * nx + i] : -1;
        this.fixedV[j * nx + i] = this.isFreeFace(up, down) ? 0 : 1;
      }
    }
  }

  private isFreeFace(a: number, b: number): boolean {
    if (a < 0 || b < 0) return false;
    if (a === CELL_SOLID || b === CELL_SOLID) return false;
    return a === CELL_FLUID || b === CELL_FLUID;
  }

  step(count = 1) {
    for (let n = 0; n < count; n++) {
      this.advectVelocity();
      this.project();
      this.advectTracer();
      this.steps++;
    }
  }

  get stepsDone(): number {
    return this.steps;
  }

  // ---- 속도장 보간 -------------------------------------------------------

  private sampleU(arr: Float64Array, x: number, y: number): number {
    const { nx, ny } = this;
    const gx = Math.min(Math.max(x, 0), nx - 1e-9);
    const gy = Math.min(Math.max(y - 0.5, 0), ny - 1 - 1e-9);
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const fx = gx - i0;
    const fy = gy - j0;
    const w = nx + 1;
    const a = arr[j0 * w + i0];
    const b = arr[j0 * w + i0 + 1];
    const c = arr[(j0 + 1) * w + i0];
    const d = arr[(j0 + 1) * w + i0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  private sampleV(arr: Float64Array, x: number, y: number): number {
    const { nx, ny } = this;
    const gx = Math.min(Math.max(x - 0.5, 0), nx - 1 - 1e-9);
    const gy = Math.min(Math.max(y, 0), ny - 1e-9);
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const fx = gx - i0;
    const fy = gy - j0;
    const a = arr[j0 * nx + i0];
    const b = arr[j0 * nx + i0 + 1];
    const c = arr[(j0 + 1) * nx + i0];
    const d = arr[(j0 + 1) * nx + i0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  // ---- 이류 --------------------------------------------------------------

  private advectVelocity() {
    const { nx, ny, h, dt } = this;
    const k = dt / h;
    this.U0.set(this.U);
    this.V0.set(this.V);

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const f = j * (nx + 1) + i;
        if (this.fixedU[f]) {
          this.U[f] = this.valueU[f];
          continue;
        }
        const x = i;
        const y = j + 0.5;
        const u = this.U0[f];
        const v = this.sampleV(this.V0, x, y);
        this.U[f] = this.sampleU(this.U0, x - u * k, y - v * k);
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const f = j * nx + i;
        if (this.fixedV[f]) {
          this.V[f] = this.valueV[f];
          continue;
        }
        const x = i + 0.5;
        const y = j;
        const u = this.sampleU(this.U0, x, y);
        const v = this.V0[f];
        this.V[f] = this.sampleV(this.V0, x - u * k, y - v * k);
      }
    }
  }

  private advectTracer() {
    const { nx, ny, h, dt, type } = this;
    const k = dt / h;
    this.tracer0.set(this.tracer);
    const src = this.tracer0;
    const dst = this.tracer;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (type[c] !== CELL_FLUID) continue;
        const u = 0.5 * (this.U[j * (nx + 1) + i] + this.U[j * (nx + 1) + i + 1]);
        const v = 0.5 * (this.V[j * nx + i] + this.V[(j + 1) * nx + i]);
        const x = i + 0.5 - u * k;
        const y = j + 0.5 - v * k;
        dst[c] = this.sampleCell(src, x, y, src[c]);
      }
    }
    // 유출 셀은 안쪽 이웃의 농도를 그대로 내보낸다(경계에서 농도가 쌓이지 않게).
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (type[c] !== CELL_OUTLET) continue;
        let sum = 0;
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const t = type[jj * nx + ii];
          if (t === CELL_FLUID) {
            sum += dst[jj * nx + ii];
            n++;
          }
        }
        dst[c] = n ? sum / n : 0;
      }
    }
    for (const c of this.freshAir) dst[c] = 0;
  }

  /** 셀 중심 값 보간. 고체·경계 밖 셀은 기준 값(fallback)으로 대체해 물질이 사라지지 않게 한다. */
  private sampleCell(arr: Float64Array, x: number, y: number, fallback: number): number {
    const { nx, ny, type } = this;
    const gx = Math.min(Math.max(x - 0.5, 0), nx - 1 - 1e-9);
    const gy = Math.min(Math.max(y - 0.5, 0), ny - 1 - 1e-9);
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const fx = gx - i0;
    const fy = gy - j0;
    const at = (i: number, j: number) => {
      const c = j * nx + i;
      return type[c] === CELL_SOLID ? fallback : arr[c];
    };
    return (
      (at(i0, j0) * (1 - fx) + at(i0 + 1, j0) * fx) * (1 - fy) +
      (at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * fx) * fy
    );
  }

  // ---- 압력 투영(비압축성) ------------------------------------------------

  private project() {
    const { nx, ny, type, pressure, divergence } = this;
    const w = nx + 1;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        divergence[c] =
          type[c] === CELL_FLUID
            ? this.U[j * w + i + 1] -
              this.U[j * w + i] +
              this.V[(j + 1) * nx + i] -
              this.V[j * nx + i]
            : 0;
        if (type[c] !== CELL_FLUID) pressure[c] = 0;
      }
    }

    for (let it = 0; it < this.iterations; it++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i;
          if (type[c] !== CELL_FLUID) continue;
          let sum = 0;
          let free = 0;
          if (!this.fixedU[j * w + i]) {
            sum += pressure[c - 1];
            free++;
          }
          if (!this.fixedU[j * w + i + 1]) {
            sum += pressure[c + 1];
            free++;
          }
          if (!this.fixedV[j * nx + i]) {
            sum += pressure[c - nx];
            free++;
          }
          if (!this.fixedV[(j + 1) * nx + i]) {
            sum += pressure[c + nx];
            free++;
          }
          if (free === 0) continue;
          const gs = (sum - divergence[c]) / free;
          pressure[c] += SOR_OMEGA * (gs - pressure[c]);
        }
      }
    }

    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const f = j * w + i;
        if (!this.fixedU[f]) this.U[f] -= pressure[j * nx + i] - pressure[j * nx + i - 1];
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const f = j * nx + i;
        if (!this.fixedV[f]) this.V[f] -= pressure[j * nx + i] - pressure[(j - 1) * nx + i];
      }
    }
  }

  // ---- 결과 --------------------------------------------------------------

  snapshot(): FlowSnapshot {
    const { nx, ny } = this;
    const u = new Float32Array(nx * ny);
    const v = new Float32Array(nx * ny);
    const tracer = new Float32Array(nx * ny);
    let remaining = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (this.type[c] === CELL_SOLID) continue;
        u[c] = 0.5 * (this.U[j * (nx + 1) + i] + this.U[j * (nx + 1) + i + 1]);
        v[c] = 0.5 * (this.V[j * nx + i] + this.V[(j + 1) * nx + i]);
        tracer[c] = this.tracer[c];
        if (this.tracked[c]) remaining += this.tracer[c];
      }
    }
    return {
      nx,
      ny,
      u,
      v,
      tracer,
      residual: this.trackedCount ? remaining / this.trackedCount : 0,
      stepsDone: this.steps,
    };
  }

  /** 테스트와 점검용: 면 속도 배열(읽기 전용 복사본) */
  faceVelocities(): { u: Float64Array; v: Float64Array } {
    return { u: this.U.slice(), v: this.V.slice() };
  }
}
