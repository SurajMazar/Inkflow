import { describe, expect, it } from 'vitest';
import { escapeLike, safeNextPath, slugify } from './mappers';

describe('mappers', () => {
  it('only allows same-site redirect paths', () => {
    expect(safeNextPath('/boards/1?x=2')).toBe('/boards/1?x=2');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('/ok\r\nSet-Cookie: x')).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
  });

  it('slugifies names', () => {
    expect(slugify('Ünïcode Team — R&D!')).toBe('unicode-team-r-d');
    expect(slugify('***')).toBe('workspace');
  });
});
