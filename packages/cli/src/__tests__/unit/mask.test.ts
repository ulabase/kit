import { describe, expect, it } from 'vitest';
import { maskEcho } from '../../mask.js';

describe('maskEcho', () => {
  it('shows a dot for each character typed or pasted, never the character', () => {
    expect(maskEcho('a')).toBe('•');
    expect(maskEcho('ula_live_abc')).toBe('••••••••••••');
  });

  it('lets the line end through', () => {
    expect(maskEcho('\r\n')).toBe('\r\n');
  });

  it('lets the escape sequences of a redraw through, and masks the line between them', () => {
    // what readline writes after a backspace: to column 1, the line, clear to the end
    expect(maskEcho('\x1b[1Gabc\x1b[0K')).toBe('\x1b[1G•••\x1b[0K');
  });
});
