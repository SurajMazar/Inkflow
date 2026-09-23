import { COLOR_PALETTE } from '@inkflow/elements';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@inkflow/ui';
import { Check, Pipette, Star } from 'lucide-react';
import * as React from 'react';
import {
  contrastColor,
  hsvToRgb,
  parseColor,
  rgbToHsl,
  rgbToHsv,
  toHex,
  type Hsva,
} from '../lib/color';
import { colorMemory } from '../lib/color-memory';

const PALETTE_ROWS: string[][] = [
  ['transparent', COLOR_PALETTE.black, COLOR_PALETTE.white, ...COLOR_PALETTE.gray.slice(2)],
  ...(
    ['red', 'pink', 'grape', 'violet', 'blue', 'cyan', 'teal', 'green', 'yellow', 'orange'] as const
  ).map((k) => [...COLOR_PALETTE[k]]),
];

const CHECKER = 'repeating-conic-gradient(#d4d4d8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px';

export function ColorSwatch({
  color,
  size = 20,
  className,
}: {
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-[5px] border border-black/10 dark:border-white/15',
        className,
      )}
      style={{
        width: size,
        height: size,
        background:
          color === 'transparent' ? CHECKER : `linear-gradient(${color}, ${color}), ${CHECKER}`,
      }}
    />
  );
}

interface DragAreaProps {
  className?: string;
  style?: React.CSSProperties;
  label: string;
  valueText: string;
  onChange(x: number, y: number): void;
  onKey(dx: number, dy: number): void;
  children?: React.ReactNode;
}

/** Pointer-draggable area reporting normalized coordinates, with arrow-key support. */
function DragArea({
  className,
  style,
  label,
  valueText,
  onChange,
  onKey,
  children,
}: DragAreaProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const update = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    onChange(
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    );
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuetext={valueText}
      className={cn(
        'relative touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      style={style}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) update(e);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        const map: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const d = map[e.key];
        if (d) {
          e.preventDefault();
          onKey(d[0], d[1]);
        }
      }}
    >
      {children}
    </div>
  );
}

function CustomColor({ value, onChange }: { value: string; onChange(color: string): void }) {
  const parsed = parseColor(value) ?? { r: 30, g: 30, b: 30, a: 1 };
  const [hsv, setHsv] = React.useState<Hsva>(() =>
    rgbToHsv(parsed.a === 0 ? { ...parsed, a: 1 } : parsed),
  );
  const rgb = hsvToRgb(hsv);
  const hsl = rgbToHsl(rgb);
  const [hexDraft, setHexDraft] = React.useState(toHex({ ...rgb, a: hsv.a }));

  React.useEffect(() => {
    const c = parseColor(value);
    if (!c || c.a === 0) return;
    const current = toHex(hsvToRgb(hsv));
    if (current.toLowerCase() !== value.toLowerCase()) {
      setHsv(rgbToHsv(c));
      setHexDraft(toHex(c));
    }
    // Only react to external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: Hsva) => {
    setHsv(next);
    const hex = toHex(hsvToRgb(next));
    setHexDraft(hex);
    onChange(hex);
  };
  const setRgb = (patch: Partial<{ r: number; g: number; b: number }>) =>
    commit(rgbToHsv({ ...rgb, ...patch, a: hsv.a }));
  const setHsl = (patch: Partial<{ h: number; s: number; l: number }>) => {
    const n = { ...hsl, ...patch };
    const c = parseColor(`hsl(${n.h}, ${n.s}%, ${n.l}%)`);
    if (c) commit(rgbToHsv({ ...c, a: hsv.a }));
  };
  const pure = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1, a: 1 }));
  const opaque = toHex({ ...rgb, a: 1 });

  const numberInput = (label: string, val: number, max: number, set: (n: number) => void) => (
    <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
      <Input
        aria-label={label}
        className="h-7 w-full px-1 text-center text-xs"
        inputMode="numeric"
        value={Math.round(val)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set(Math.min(max, Math.max(0, n)));
        }}
      />
      {label}
    </label>
  );

  const eyeDropper = (
    globalThis as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }
  ).EyeDropper;

  return (
    <div className="flex flex-col gap-3">
      <DragArea
        label="Saturation and brightness"
        valueText={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        className="h-32 w-full cursor-crosshair"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})`,
        }}
        onChange={(x, y) => commit({ ...hsv, s: x, v: 1 - y })}
        onKey={(dx, dy) =>
          commit({
            ...hsv,
            s: Math.min(1, Math.max(0, hsv.s + dx)),
            v: Math.min(1, Math.max(0, hsv.v - dy)),
          })
        }
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: opaque }}
        />
      </DragArea>
      <DragArea
        label="Hue"
        valueText={`${Math.round(hsv.h)} degrees`}
        className="h-3 w-full cursor-pointer"
        style={{
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
        onChange={(x) => commit({ ...hsv, h: Math.min(359.9, x * 360) })}
        onKey={(dx) => commit({ ...hsv, h: (hsv.h + dx * 360 + 360) % 360 })}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }}
        />
      </DragArea>
      <DragArea
        label="Opacity"
        valueText={`${Math.round(hsv.a * 100)}%`}
        className="h-3 w-full cursor-pointer"
        style={{ background: `linear-gradient(to right, transparent, ${opaque}), ${CHECKER}` }}
        onChange={(x) => commit({ ...hsv, a: Math.round(x * 100) / 100 })}
        onKey={(dx) =>
          commit({ ...hsv, a: Math.min(1, Math.max(0.01, Math.round((hsv.a + dx) * 100) / 100)) })
        }
      >
        <span
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.a * 100}%`, background: opaque }}
        />
      </DragArea>
      <div className="flex items-center gap-2">
        <ColorSwatch color={toHex({ ...rgb, a: hsv.a })} size={28} />
        <Input
          aria-label="Hex color"
          className="h-8 font-mono text-xs"
          value={hexDraft}
          onChange={(e) => {
            setHexDraft(e.target.value);
            const c = parseColor(e.target.value);
            if (c && c.a > 0) {
              setHsv(rgbToHsv(c));
              onChange(toHex(c));
            }
          }}
        />
        {eyeDropper && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Pick a color from the screen"
            onClick={async () => {
              try {
                const res = await new eyeDropper().open();
                const c = parseColor(res.sRGBHex);
                if (c) commit(rgbToHsv({ ...c, a: hsv.a }));
              } catch {
                // User cancelled the eyedropper.
              }
            }}
          >
            <Pipette className="size-4" />
          </Button>
        )}
      </div>
      <Tabs defaultValue="rgb">
        <TabsList className="h-7 w-full">
          <TabsTrigger value="rgb" className="h-6 text-xs">
            RGB
          </TabsTrigger>
          <TabsTrigger value="hsl" className="h-6 text-xs">
            HSL
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rgb" className="mt-2 grid grid-cols-4 gap-1.5">
          {numberInput('R', rgb.r, 255, (r) => setRgb({ r }))}
          {numberInput('G', rgb.g, 255, (g) => setRgb({ g }))}
          {numberInput('B', rgb.b, 255, (b) => setRgb({ b }))}
          {numberInput('A %', hsv.a * 100, 100, (a) => commit({ ...hsv, a: a / 100 }))}
        </TabsContent>
        <TabsContent value="hsl" className="mt-2 grid grid-cols-4 gap-1.5">
          {numberInput('H', hsl.h, 360, (h) => setHsl({ h }))}
          {numberInput('S %', hsl.s, 100, (s) => setHsl({ s }))}
          {numberInput('L %', hsl.l, 100, (l) => setHsl({ l }))}
          {numberInput('A %', hsv.a * 100, 100, (a) => commit({ ...hsv, a: a / 100 }))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export interface ColorPickerProps {
  label: string;
  value: string;
  onChange(color: string): void;
  allowTransparent?: boolean;
  /** Quick swatches shown inline next to the trigger. */
  quick?: readonly string[];
  testId?: string;
}

/** Color control: quick swatches + popover with palette, custom picker, recent colors and favorites. */
export function ColorPicker({
  label,
  value,
  onChange,
  allowTransparent = false,
  quick = [],
  testId,
}: ColorPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>(() => colorMemory.recent());
  const [favorites, setFavorites] = React.useState<string[]>(() => colorMemory.favorites());

  const pick = (color: string, remember = true) => {
    onChange(color);
    if (remember) {
      colorMemory.pushRecent(color);
      setRecent(colorMemory.recent());
    }
  };

  const swatchButton = (color: string, key: string, size = 22) => {
    const selected = color.toLowerCase() === value.toLowerCase();
    return (
      <button
        key={key}
        type="button"
        aria-label={color === 'transparent' ? 'Transparent' : color}
        aria-pressed={selected}
        title={color}
        onClick={() => pick(color)}
        className={cn(
          'relative rounded-[7px] p-[3px] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'ring-[1.5px] ring-primary',
        )}
      >
        <ColorSwatch color={color} size={size} />
        {selected && color !== 'transparent' && (
          <Check
            className="pointer-events-none absolute inset-0 m-auto size-3"
            style={{ color: contrastColor(color) }}
          />
        )}
      </button>
    );
  };

  const palette = allowTransparent
    ? PALETTE_ROWS
    : PALETTE_ROWS.map((row, i) => (i === 0 ? row.filter((c) => c !== 'transparent') : row));

  return (
    <div className="flex items-center gap-1" data-testid={testId}>
      {quick
        .filter((c) => allowTransparent || c !== 'transparent')
        .map((c) => swatchButton(c, `q-${c}`, 20))}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${value}. Open color picker`}
            className="rounded-md p-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={testId ? `${testId}-open` : undefined}
          >
            <ColorSwatch color={value} size={24} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="left"
          align="start"
          className="w-64 p-3"
          data-inkflow-ui
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Tabs defaultValue="palette">
            <TabsList className="mb-3 h-8 w-full">
              <TabsTrigger value="palette" className="text-xs">
                Palette
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-xs">
                Custom
              </TabsTrigger>
            </TabsList>
            <TabsContent value="palette" className="flex flex-col gap-3">
              <div className="grid grid-cols-5 gap-1" role="group" aria-label={`${label} palette`}>
                {palette.flatMap((row, r) => row.map((c, i) => swatchButton(c, `p-${r}-${i}`)))}
              </div>
              {recent.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Recent</p>
                  <div className="flex flex-wrap gap-1">
                    {recent.map((c) => swatchButton(c, `r-${c}`, 18))}
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] font-medium text-muted-foreground">Favorites</p>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setFavorites(colorMemory.toggleFavorite(value))}
                    disabled={value === 'transparent'}
                  >
                    <Star
                      className={cn(
                        'size-3',
                        favorites.includes(value) && 'fill-current text-amber-500',
                      )}
                    />
                    {favorites.includes(value) ? 'Remove' : 'Save current'}
                  </button>
                </div>
                {favorites.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {favorites.map((c) => swatchButton(c, `f-${c}`, 18))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">No favorites yet.</p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="custom">
              <CustomColor value={value} onChange={(c) => pick(c, false)} />
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    </div>
  );
}
