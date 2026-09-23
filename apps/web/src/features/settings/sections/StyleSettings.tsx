import { Check } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from '@inkflow/ui';
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from '@inkflow/shared';
import { SettingRow, SettingsSection, useSavePreferences } from '../components';

type DefaultStyles = UserPreferences['defaultStyles'];

const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#6741d9'];
const BACKGROUND_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#d0bfff'];
const COLOR_NAMES: Record<string, string> = {
  '#1e1e1e': 'Black',
  '#e03131': 'Red',
  '#2f9e44': 'Green',
  '#1971c2': 'Blue',
  '#f08c00': 'Orange',
  '#6741d9': 'Violet',
  transparent: 'Transparent',
  '#ffc9c9': 'Light red',
  '#b2f2bb': 'Light green',
  '#a5d8ff': 'Light blue',
  '#ffec99': 'Light yellow',
  '#d0bfff': 'Light violet',
};

export const FONT_FAMILIES = [
  { value: 'hand', label: 'Hand-drawn', css: 'var(--font-hand)' },
  { value: 'sans', label: 'Sans serif', css: 'var(--font-sans)' },
  { value: 'serif', label: 'Serif', css: 'var(--font-serif)' },
  { value: 'mono', label: 'Monospace', css: 'var(--font-mono)' },
] as const;

function fontCss(family: string): string {
  return FONT_FAMILIES.find((f) => f.value === family)?.css ?? 'var(--font-hand)';
}

function ColorSwatches({
  colors,
  value,
  onChange,
  label,
  id,
}: {
  colors: string[];
  value: string;
  onChange: (color: string) => void;
  label: string;
  id: string;
}) {
  const custom = !colors.includes(value);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="radiogroup"
      aria-label={label}
      id={id}
    >
      {colors.map((color) => {
        const selected = value.toLowerCase() === color.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={COLOR_NAMES[color] ?? color}
            onClick={() => onChange(color)}
            className={cn(
              'relative flex size-7 items-center justify-center rounded-md border outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/40 pointer-coarse:size-10',
              selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
            )}
            style={
              color === 'transparent'
                ? {
                    backgroundImage:
                      'linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%), linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%)',
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 4px 4px',
                  }
                : { backgroundColor: color }
            }
          >
            {selected ? (
              <Check
                className={cn(
                  'size-3.5',
                  color === '#1e1e1e' || color === '#6741d9' || color === '#1971c2'
                    ? 'text-white'
                    : 'text-zinc-900',
                )}
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}
      <label
        className={cn(
          'relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-md border text-[10px] font-medium text-muted-foreground has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 pointer-coarse:size-10',
          custom && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
        style={custom && value !== 'transparent' ? { backgroundColor: value } : undefined}
        title="Custom color"
      >
        {custom ? null : '+'}
        <input
          type="color"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Custom ${label.toLowerCase()}`}
        />
      </label>
    </div>
  );
}

export function StyleSettings() {
  const { preferences, save } = useSavePreferences();
  const styles = preferences.defaultStyles;
  const update = (patch: Partial<DefaultStyles>) =>
    void save({ defaultStyles: patch }, 'Default style saved');

  return (
    <div className="grid gap-8">
      <SettingsSection
        title="Default styles"
        description="Used for new shapes and text you create."
        action={
          <button
            type="button"
            className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() =>
              void save(
                { defaultStyles: DEFAULT_USER_PREFERENCES.defaultStyles },
                'Default styles reset',
              )
            }
            data-testid="styles-reset"
          >
            Reset to defaults
          </button>
        }
      >
        <div className="border-b p-4">
          <StylePreview styles={styles} />
        </div>
        <SettingRow label="Stroke color">
          {({ id }) => (
            <ColorSwatches
              id={id}
              label="Stroke color"
              colors={STROKE_COLORS}
              value={styles.strokeColor}
              onChange={(strokeColor) => update({ strokeColor })}
            />
          )}
        </SettingRow>
        <SettingRow label="Background">
          {({ id }) => (
            <ColorSwatches
              id={id}
              label="Background color"
              colors={BACKGROUND_COLORS}
              value={styles.backgroundColor}
              onChange={(backgroundColor) => update({ backgroundColor })}
            />
          )}
        </SettingRow>
        <SettingRow label="Stroke width">
          {(props) => (
            <ToggleGroup
              {...props}
              type="single"
              variant="outline"
              size="sm"
              value={String(styles.strokeWidth)}
              onValueChange={(value) => value && update({ strokeWidth: Number(value) })}
              aria-label="Stroke width"
            >
              {[
                { value: 1, label: 'Thin' },
                { value: 2, label: 'Bold' },
                { value: 4, label: 'Extra bold' },
              ].map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={String(option.value)}
                  aria-label={option.label}
                  className="px-3"
                >
                  <span
                    className="block w-6 rounded-full bg-current"
                    style={{ height: option.value + 0.5 }}
                    aria-hidden
                  />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </SettingRow>
        <SettingRow label="Sloppiness">
          {(props) => (
            <ToggleGroup
              {...props}
              type="single"
              variant="outline"
              size="sm"
              value={String(styles.roughness)}
              onValueChange={(value) => value && update({ roughness: Number(value) })}
              aria-label="Sloppiness"
            >
              <ToggleGroupItem value="0" className="px-3">
                Architect
              </ToggleGroupItem>
              <ToggleGroupItem value="1" className="px-3">
                Artist
              </ToggleGroupItem>
              <ToggleGroupItem value="2" className="px-3">
                Cartoonist
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </SettingRow>
        <SettingRow label="Font">
          {(props) => (
            <Select
              value={styles.fontFamily}
              onValueChange={(fontFamily) => update({ fontFamily })}
            >
              <SelectTrigger {...props} className="w-44" aria-label="Font family">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    <span style={{ fontFamily: font.css }}>{font.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
        <SettingRow label="Font size">
          {(props) => (
            <ToggleGroup
              {...props}
              type="single"
              variant="outline"
              size="sm"
              value={String(styles.fontSize)}
              onValueChange={(value) => value && update({ fontSize: Number(value) })}
              aria-label="Font size"
            >
              {[
                { value: 16, label: 'S' },
                { value: 20, label: 'M' },
                { value: 28, label: 'L' },
                { value: 36, label: 'XL' },
              ].map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={String(option.value)}
                  aria-label={`${option.value}px`}
                  className="min-w-10 px-2"
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </SettingRow>
      </SettingsSection>
    </div>
  );
}

function StylePreview({ styles }: { styles: DefaultStyles }) {
  return (
    <div
      className="flex items-center justify-center gap-6 rounded-lg bg-background py-4 dark:bg-muted/30"
      aria-label="Style preview"
      role="img"
    >
      <svg width="140" height="72" viewBox="0 0 140 72" aria-hidden>
        <rect
          x="6"
          y="6"
          width="128"
          height="60"
          rx={styles.roughness === 0 ? 2 : 10}
          fill={styles.backgroundColor === 'transparent' ? 'none' : styles.backgroundColor}
          stroke={styles.strokeColor}
          strokeWidth={styles.strokeWidth}
          className="dark:[filter:invert(0.93)_hue-rotate(180deg)]"
        />
      </svg>
      <span
        style={{
          fontFamily: fontCss(styles.fontFamily),
          fontSize: Math.min(styles.fontSize, 36),
          color: styles.strokeColor,
        }}
        className="dark:[filter:invert(0.93)_hue-rotate(180deg)]"
      >
        Aa Inkflow
      </span>
    </div>
  );
}
