import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Imperative handle for reading, undoing or clearing the drawing. */
export interface SignaturePadHandle {
    clear: () => void;
    /** Removes the last stroke (or the one being written). */
    undo: () => void;
    isEmpty: () => boolean;
    /** The drawing as a `data:image/png;base64,...` URI on a white background. */
    toDataURL: () => string;
}

interface SignaturePadProps {
    /** Called with the number of finished strokes whenever it changes. */
    onStrokesChange?: (count: number) => void;
    disabled?: boolean;
    /** Sizes the pad; the canvas fills it. */
    className?: string;
}

interface Point {
    x: number;
    y: number;
}

type InputKind = 'mouse' | 'touch';

const STROKE_COLOR = '#111827';
const STROKE_WIDTH = 3;
// The exported image is capped so a wide screen can't produce a file the server refuses.
const EXPORT_MAX_WIDTH = 1600;
const EXPORT_SCALE = 2;
// A press counts as a drag (pen lifts on release) only if the mouse moved this far AND the
// button was held this long. Anything less is a click, even if the hand shook a little, so a
// slightly shaky click never flips the pen into the opposite state.
const DRAG_MIN_DISTANCE = 12;
const DRAG_MIN_HOLD_MS = 200;

/** True on phones and tablets, where the main input is a finger, so instructions can match. */
export function prefersTouchInput(): boolean {
    return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
}

function drawStroke(ctx: CanvasRenderingContext2D, points: Point[]) {
    if (points.length === 0) return;
    if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, STROKE_WIDTH / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    // A curve through the midpoints smooths the jagged steps a mouse produces.
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
}

function paint(ctx: CanvasRenderingContext2D, width: number, height: number, strokes: Point[][]) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.strokeStyle = STROKE_COLOR;
    ctx.fillStyle = STROKE_COLOR;
    strokes.forEach((stroke) => drawStroke(ctx, stroke));
}

/**
 * A box the user writes a signature in.
 *
 * Laptop (mouse or touchpad): hold the Space bar while the pointer is over the box and move to
 * write; let go of Space to move without drawing. A touchpad can't tell the browser when a
 * finger lifts, so Space is the pen-up/pen-down signal that needs no clicking. Clicking also
 * works: click once to put the pen down, move to write, click again to lift it; holding the
 * button and dragging works too. Finger or stylus: press and write as usual.
 *
 * Strokes are kept as points, so a resize (a phone's address bar moving, a rotation) repaints
 * the drawing instead of wiping it, and Undo can drop the last stroke.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
    { onStrokesChange, disabled = false, className },
    ref
) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Point[][]>([]);
    const activeRef = useRef<Point[] | null>(null);
    const sizeRef = useRef({ width: 0, height: 0 });
    const frameRef = useRef<number | null>(null);
    // Set while the mouse button is held; null while the pen is down from a click.
    const pressRef = useRef<{ start: Point; at: number; moved: boolean } | null>(null);
    // Where the pointer last was over the box, and whether it is over it now (Space writing).
    const hoverPointRef = useRef<Point | null>(null);
    const overRef = useRef(false);
    // True while the Space bar holds the pen down.
    const spaceRef = useRef(false);
    const onStrokesChangeRef = useRef(onStrokesChange);
    onStrokesChangeRef.current = onStrokesChange;
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;

    const [penDown, setPenDown] = useState(false);
    // True while the pen is down from a click (writing without holding the button).
    const [clickWriting, setClickWriting] = useState(false);
    const [spaceWriting, setSpaceWriting] = useState(false);
    // Until the first touch or click, guess from the device so a phone never shows laptop hints.
    const [inputKind, setInputKind] = useState<InputKind | null>(() => (prefersTouchInput() ? 'touch' : null));
    const [strokeCount, setStrokeCount] = useState(0);

    const repaint = () => {
        frameRef.current = null;
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const { width, height } = sizeRef.current;
        const strokes = activeRef.current ? [...strokesRef.current, activeRef.current] : strokesRef.current;
        paint(ctx, width, height, strokes);
    };

    const scheduleRepaint = () => {
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(repaint);
    };

    const resize = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const ratio = window.devicePixelRatio || 1;
        // offsetWidth/Height ignore CSS transforms (the dialog's zoom-in), unlike getBoundingClientRect.
        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        sizeRef.current = { width, height };
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        repaint();
    };

    const notify = () => {
        const count = strokesRef.current.length;
        setStrokeCount(count);
        onStrokesChangeRef.current?.(count);
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        resize();
        notify();
        const observer = new ResizeObserver(() => {
            const { width, height } = sizeRef.current;
            if (canvas.offsetWidth !== width || canvas.offsetHeight !== height) resize();
        });
        observer.observe(canvas);
        return () => {
            observer.disconnect();
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        };
        // resize/notify read only refs; running once on mount is intended.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const startStroke = (point: Point) => {
        activeRef.current = [point];
        setPenDown(true);
        scheduleRepaint();
    };

    const liftPen = () => {
        activeRef.current = null;
        pressRef.current = null;
        spaceRef.current = false;
        setPenDown(false);
        setClickWriting(false);
        setSpaceWriting(false);
    };

    const finishStroke = () => {
        const active = activeRef.current;
        if (!active) {
            pressRef.current = null;
            if (spaceRef.current) {
                spaceRef.current = false;
                setSpaceWriting(false);
            }
            return;
        }
        liftPen();
        strokesRef.current = [...strokesRef.current, active];
        scheduleRepaint();
        notify();
    };

    // Space bar = pen down while held, but only while the pointer is over the box, so Space
    // keeps its normal meaning everywhere else on the page.
    useEffect(() => {
        const isSpace = (event: KeyboardEvent) => event.code === 'Space' || event.key === ' ';

        const onKeyDown = (event: KeyboardEvent) => {
            if (!isSpace(event) || !overRef.current || disabledRef.current) return;
            // Stop the page scrolling and a focused button (Sign & Submit) from being pressed.
            event.preventDefault();
            if (event.repeat || spaceRef.current || activeRef.current || !hoverPointRef.current) return;
            spaceRef.current = true;
            setSpaceWriting(true);
            setInputKind('mouse');
            startStroke(hoverPointRef.current);
        };

        const onKeyUp = (event: KeyboardEvent) => {
            if (!isSpace(event)) return;
            if (overRef.current || spaceRef.current) event.preventDefault();
            if (spaceRef.current) finishStroke();
        };

        // Switching windows while holding Space would never deliver the keyup.
        const onWindowBlur = () => {
            if (spaceRef.current) finishStroke();
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onWindowBlur);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onWindowBlur);
        };
        // The handlers read only refs and stable setters; registering once is intended.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const exportPng = () => {
        const { width, height } = sizeRef.current;
        if (!width || !height) return '';
        const scale = Math.min(EXPORT_SCALE, EXPORT_MAX_WIDTH / width);
        const out = document.createElement('canvas');
        out.width = Math.round(width * scale);
        out.height = Math.round(height * scale);
        const ctx = out.getContext('2d');
        if (!ctx) return '';
        ctx.scale(scale, scale);
        paint(ctx, width, height, strokesRef.current);
        return out.toDataURL('image/png');
    };

    useImperativeHandle(ref, () => ({
        clear: () => {
            liftPen();
            strokesRef.current = [];
            repaint();
            notify();
        },
        undo: () => {
            if (activeRef.current) {
                liftPen();
            } else {
                strokesRef.current = strokesRef.current.slice(0, -1);
            }
            repaint();
            notify();
        },
        isEmpty: () => strokesRef.current.length === 0,
        toDataURL: exportPng,
    }));

    const toPoint = (event: { clientX: number; clientY: number }): Point => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        // Map screen coordinates back to the untransformed layout box.
        const scaleX = rect.width ? canvas.offsetWidth / rect.width : 1;
        const scaleY = rect.height ? canvas.offsetHeight / rect.height : 1;
        return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (disabled) return;
        const isMouse = event.pointerType === 'mouse';
        if (isMouse && event.button !== 0) return;
        event.preventDefault();
        setInputKind(isMouse ? 'mouse' : 'touch');
        const point = toPoint(event);

        if (isMouse && activeRef.current && !pressRef.current) {
            // The pen is down from an earlier click or from Space: this click lifts it.
            activeRef.current.push(point);
            finishStroke();
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        pressRef.current = isMouse ? { start: point, at: performance.now(), moved: false } : null;
        startStroke(point);
    };

    const handlePointerEnter = (event: React.PointerEvent<HTMLCanvasElement>) => {
        overRef.current = true;
        hoverPointRef.current = toPoint(event);
    };

    const handlePointerLeave = () => {
        // Leaving the box lifts the pen, so no line runs out to the buttons.
        overRef.current = false;
        finishStroke();
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        overRef.current = true;
        hoverPointRef.current = toPoint(event);
        const active = activeRef.current;
        if (!active) return;
        // Coalesced events give the in-between points a fast stroke would otherwise skip.
        const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
        const points = (samples.length ? samples : [event.nativeEvent]).map(toPoint);
        active.push(...points);
        const press = pressRef.current;
        if (press && !press.moved) {
            const last = points[points.length - 1];
            if (Math.hypot(last.x - press.start.x, last.y - press.start.y) > DRAG_MIN_DISTANCE) press.moved = true;
        }
        scheduleRepaint();
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (event.pointerType !== 'mouse') {
            finishStroke();
            return;
        }
        const press = pressRef.current;
        if (!press) return; // the lifting click already finished the stroke
        if (press.moved && performance.now() - press.at >= DRAG_MIN_HOLD_MS) {
            finishStroke(); // held and dragged: an ordinary stroke
            return;
        }
        // A plain click: keep the pen down and follow the mouse until the next click.
        pressRef.current = null;
        setClickWriting(true);
    };

    const hint =
        inputKind === 'touch'
            ? 'Write with your finger. Lift it between words.'
            : spaceWriting
              ? 'Writing… let go of Space to move without drawing'
              : clickWriting
                ? 'Writing… click or tap again to lift the pen'
                : strokeCount > 0
                  ? 'Hold Space (or click) to write the next part'
                  : 'Hold Space and move to write, or click once to start';

    return (
        <div className={cn('relative h-56', className)}>
            <canvas
                ref={canvasRef}
                aria-label="Signature box: hold Space and move to write, or click once to start and again to stop"
                className={cn(
                    'block h-full w-full touch-none rounded-md border-2 bg-white',
                    penDown ? 'border-emerald-500' : 'border-dashed border-gray-300',
                    disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair'
                )}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={finishStroke}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
            />
            {/* Guide line and hint sit over the canvas but are not part of the exported image. */}
            <div className="pointer-events-none absolute inset-x-8 bottom-9 border-b border-gray-300" />
            <span
                className={cn(
                    'pointer-events-none absolute bottom-2.5 left-8 text-xs',
                    penDown ? 'font-medium text-emerald-700' : 'text-gray-400'
                )}
            >
                {hint}
            </span>
        </div>
    );
});
