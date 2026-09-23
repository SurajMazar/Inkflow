const RECENT_KEY = 'inkflow.colors.recent';
const FAVORITES_KEY = 'inkflow.colors.favorites';
const MAX_RECENT = 10;

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string').slice(0, 40)
      : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode): colors are kept for this session only.
  }
}

export const colorMemory = {
  recent: () => read(RECENT_KEY),
  pushRecent(color: string) {
    if (color === 'transparent') return;
    write(RECENT_KEY, [color, ...read(RECENT_KEY).filter((c) => c !== color)].slice(0, MAX_RECENT));
  },
  favorites: () => read(FAVORITES_KEY),
  toggleFavorite(color: string): string[] {
    const favs = read(FAVORITES_KEY);
    const next = favs.includes(color)
      ? favs.filter((c) => c !== color)
      : [...favs, color].slice(0, 24);
    write(FAVORITES_KEY, next);
    return next;
  },
};
