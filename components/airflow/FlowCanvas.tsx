"use client";

import { useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";

import {
  GRID,
  rasterize,
  type Layout,
  type Rect,
  type WindowOpenness,
} from "@/lib/floorplan";
import { advanceParticles, createParticles, seededRandom, type Particle } from "@/lib/flow";
import type { VentilationResult } from "@/lib/ventilation";
import { cn } from "@/lib/utils";

const SCALE = 12;
const PARTICLE_COUNT = 380;
const TIME_SCALE = 4;

type EditorProps = {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 이동·크기 변경 요청. 충돌 판정과 반영은 호출한 쪽이 한곳에서 처리한다. */
  onEdit: (id: string, rect: Rect) => void;
  /** 새 가구를 놓을 위치를 고르는 중이면 true */
  placing: boolean;
  onPlaceAt: (cell: { x: number; y: number }) => void;
  /** 선택한 가구 삭제 요청(Delete 키) */
  onDelete: (id: string) => void;
};

type Props = {
  layout: Layout;
  openness: WindowOpenness;
  result: VentilationResult | null;
  showParticles: boolean;
  showTracer: boolean;
  showWeak: boolean;
  editor?: EditorProps;
  className?: string;
  ariaLabel: string;
};

/** 남은 추적 물질 농도(0~1)를 색으로 바꾼다. 0=신선(옅은 하늘색), 1=정체(주황). */
function tracerColor(c: number): [number, number, number] {
  const t = Math.min(Math.max(c, 0), 1);
  return [
    Math.round(226 + (249 - 226) * t),
    Math.round(240 + (168 - 240) * t),
    Math.round(250 + (84 - 250) * t),
  ];
}

function buildBackground(
  layout: Layout,
  openness: WindowOpenness,
  result: VentilationResult | null,
  showTracer: boolean,
  showWeak: boolean
): HTMLCanvasElement {
  const { nx, ny } = GRID;
  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(nx, ny);
  const walls = rasterize({ ...layout, furniture: [] }, openness).solid;
  for (let c = 0; c < nx * ny; c++) {
    let rgb: [number, number, number];
    if (walls[c]) rgb = [71, 76, 86];
    else if (result && showTracer) rgb = tracerColor(result.tracer[c]);
    else rgb = [240, 244, 248];
    if (!walls[c] && result && showWeak && result.weak[c]) {
      rgb = [
        Math.round(rgb[0] * 0.6 + 220 * 0.4),
        Math.round(rgb[1] * 0.6 + 38 * 0.4),
        Math.round(rgb[2] * 0.6 + 38 * 0.4),
      ];
    }
    image.data[c * 4] = rgb[0];
    image.data[c * 4 + 1] = rgb[1];
    image.data[c * 4 + 2] = rgb[2];
    image.data[c * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  props: Pick<Props, "layout" | "openness" | "result">,
  background: HTMLCanvasElement,
  particles: Particle[],
  previous: Float32Array,
  showParticles: boolean
) {
  const { layout, openness, result } = props;
  const w = GRID.nx * SCALE;
  const h = GRID.ny * SCALE;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(background, 0, 0, w, h);

  // 방문(항상 열린 통로)
  ctx.fillStyle = "#b45309";
  const door = layout.door;
  ctx.fillRect(door.x * SCALE - 1, door.y * SCALE, SCALE * 0.5 + 2, 2);
  ctx.fillRect(door.x * SCALE - 1, (door.y + door.h) * SCALE - 2, SCALE * 0.5 + 2, 2);

  // 창: 외벽을 따라 전체 길이를 표시하고, 열린 만큼 강조한다.
  for (const win of layout.windows) {
    const horizontal = win.side === "north" || win.side === "south";
    const level = openness[win.id];
    const openLen = Math.round(win.length * level);
    const offset = win.start + Math.floor((win.length - openLen) / 2);
    const thickness = 2 * SCALE;
    const place = (from: number, len: number) => {
      const long = len * SCALE;
      const start = from * SCALE;
      if (win.side === "west") return [0, start, thickness, long];
      if (win.side === "east") return [w - thickness, start, thickness, long];
      if (win.side === "north") return [start, 0, long, thickness];
      return [start, h - thickness, long, thickness];
    };
    const [fx, fy, fw, fh] = place(win.start, win.length);
    ctx.strokeStyle = "#0ea5e9";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
    ctx.setLineDash([]);
    if (openLen > 0) {
      const [ox, oy, ow, oh] = place(offset, openLen);
      ctx.fillStyle = "rgba(14,165,233,0.25)";
      ctx.fillRect(ox, oy, ow, oh);
    }
    // 이름표와 흐름 방향
    const role =
      result?.flow.inletIds.includes(win.id) ? " 유입" : result?.flow.outletIds.includes(win.id) ? " 유출" : "";
    ctx.font = "600 11px sans-serif";
    ctx.fillStyle = "#0369a1";
    ctx.textAlign = "center";
    const label = `${win.id} ${Math.round(level * 100)}%${role}`;
    const cx = fx + fw / 2;
    const cy = fy + fh / 2;
    if (horizontal) {
      ctx.fillText(label, cx, win.side === "north" ? fy + fh + 12 : fy - 5);
    } else {
      ctx.save();
      ctx.translate(win.side === "west" ? fx + fw + 13 : fx - 5, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  // 가구
  for (const f of layout.furniture) {
    ctx.fillStyle = "rgba(180,140,90,0.92)";
    ctx.strokeStyle = "rgba(120,85,45,1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(f.x * SCALE + 0.5, f.y * SCALE + 0.5, f.w * SCALE - 1, f.h * SCALE - 1, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff8ec";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.label, (f.x + f.w / 2) * SCALE, (f.y + f.h / 2) * SCALE + 4);
  }

  // 입자: 계산된 속도장을 따라 움직이는 점과 짧은 꼬리
  if (showParticles && result) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(15,23,42,0.55)";
    ctx.beginPath();
    for (let n = 0; n < particles.length; n++) {
      const p = particles[n];
      const px = previous[n * 2];
      const py = previous[n * 2 + 1];
      if (p.age > 1 && Math.hypot(p.x - px, p.y - py) < 3) {
        ctx.moveTo(px * SCALE, py * SCALE);
        ctx.lineTo(p.x * SCALE, p.y * SCALE);
      }
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    for (const p of particles) {
      ctx.fillRect(p.x * SCALE - 1, p.y * SCALE - 1, 2.5, 2.5);
    }
  }
}

export function FlowCanvas(props: Props) {
  const { layout, openness, result, showParticles, showTracer, showWeak, editor, className, ariaLabel } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const latest = useRef({ layout, openness, result, showParticles });

  // 그리기 루프가 항상 최신 값을 읽도록 렌더 뒤에 ref를 갱신한다.
  useEffect(() => {
    latest.current = { layout, openness, result, showParticles };
  }, [layout, openness, result, showParticles]);

  const backgroundRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    backgroundRef.current = buildBackground(layout, openness, result, showTracer, showWeak);
  }, [layout, openness, result, showTracer, showWeak]);

  // 입자는 결과가 바뀔 때만 새로 만들고, 같은 결과에서는 같은 난수열을 쓴다.
  const particleState = useRef<{
    particles: Particle[];
    previous: Float32Array;
    random: () => number;
  } | null>(null);
  useEffect(() => {
    if (!result) {
      particleState.current = null;
      return;
    }
    const random = seededRandom(20260601);
    const particles = createParticles(result.field, PARTICLE_COUNT, random);
    const previous = new Float32Array(particles.length * 2);
    particles.forEach((p, n) => {
      previous[n * 2] = p.x;
      previous[n * 2 + 1] = p.y;
    });
    particleState.current = { particles, previous, random };
  }, [result]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    const tick = () => {
      const state = particleState.current;
      const { result: res, showParticles: animate } = latest.current;
      if (state && res && animate) {
        for (let n = 0; n < state.particles.length; n++) {
          state.previous[n * 2] = state.particles[n].x;
          state.previous[n * 2 + 1] = state.particles[n].y;
        }
        advanceParticles(res.field, state.particles, 1 / 60, TIME_SCALE, state.random);
      }
      if (backgroundRef.current) {
        drawScene(
          ctx,
          latest.current,
          backgroundRef.current,
          state?.particles ?? [],
          state?.previous ?? new Float32Array(0),
          animate
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg ring-1 ring-foreground/10", className)}
      style={{ aspectRatio: `${GRID.nx} / ${GRID.ny}` }}
    >
      <canvas
        ref={canvasRef}
        width={GRID.nx * SCALE}
        height={GRID.ny * SCALE}
        className="absolute inset-0 size-full"
        role="img"
        aria-label={ariaLabel}
      />
      {editor ? (
        <FurnitureLayer svgRef={svgRef} layout={layout} editor={editor} />
      ) : null}
      {/* 평면도의 위쪽이 북쪽이다. */}
      <div
        data-testid="north-arrow"
        role="img"
        aria-label="북쪽(평면도 위쪽)"
        className="pointer-events-none absolute top-1.5 right-1.5 flex flex-col items-center rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] leading-tight font-bold ring-1 ring-foreground/20"
      >
        <ArrowUp className="size-3.5 text-destructive" aria-hidden />
        N
      </div>
    </div>
  );
}

type DragState =
  | { mode: "move"; id: string; dx: number; dy: number }
  | { mode: "resize"; id: string };

function FurnitureLayer({
  svgRef,
  layout,
  editor,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  layout: Layout;
  editor: EditorProps;
}) {
  const drag = useRef<DragState | null>(null);

  const toCell = (event: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * GRID.nx,
      y: ((event.clientY - rect.top) / rect.height) * GRID.ny,
    };
  };

  const apply = (id: string, next: Rect) => editor.onEdit(id, next);

  const onMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const f = layout.furniture.find((item) => item.id === state.id);
    if (!f) return;
    const p = toCell(event);
    if (state.mode === "move") {
      apply(f.id, { x: p.x - state.dx, y: p.y - state.dy, w: f.w, h: f.h });
    } else {
      apply(f.id, { x: f.x, y: f.y, w: p.x - f.x, h: p.y - f.y });
    }
  };

  const onKey = (event: React.KeyboardEvent, id: string) => {
    const f = layout.furniture.find((item) => item.id === id);
    if (!f) return;
    if (event.key === "Delete") {
      event.preventDefault();
      editor.onDelete(id);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    apply(id, { x: f.x + move[0], y: f.y + move[1], w: f.w, h: f.h });
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${GRID.nx} ${GRID.ny}`}
      className={cn("absolute inset-0 size-full touch-none", editor.placing && "cursor-crosshair")}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (editor.placing) editor.onPlaceAt(toCell(event));
        else editor.onSelect(null);
      }}
    >
      {layout.furniture.map((f) => {
        const selected = editor.selectedId === f.id;
        return (
          <g key={f.id}>
            <rect
              data-testid={`furniture-${f.id}`}
              x={f.x}
              y={f.y}
              width={f.w}
              height={f.h}
              rx={0.3}
              fill="transparent"
              stroke={selected ? "#2563eb" : "transparent"}
              strokeWidth={0.3}
              className="cursor-move outline-none"
              tabIndex={0}
              role="button"
              aria-label={`${f.label} 가구, 화살표 키로 이동`}
              onFocus={() => editor.onSelect(f.id)}
              onKeyDown={(event) => onKey(event, f.id)}
              onPointerDown={(event) => {
                event.stopPropagation();
                (event.currentTarget as Element).setPointerCapture(event.pointerId);
                const p = toCell(event);
                drag.current = { mode: "move", id: f.id, dx: p.x - f.x, dy: p.y - f.y };
                editor.onSelect(f.id);
              }}
            />
            {selected ? (
              <rect
                data-testid={`resize-${f.id}`}
                x={f.x + f.w - 1.2}
                y={f.y + f.h - 1.2}
                width={1.6}
                height={1.6}
                rx={0.3}
                fill="#2563eb"
                className="cursor-nwse-resize"
                aria-label={`${f.label} 크기 조절`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  (event.currentTarget as Element).setPointerCapture(event.pointerId);
                  drag.current = { mode: "resize", id: f.id };
                }}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
