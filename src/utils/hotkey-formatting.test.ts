import { formatKeyDisplay, formatHotkeyDisplay } from './hotkey-formatting';

describe('Hotkey Formatting', () => {
  describe('formatKeyDisplay', () => {
    it('should format arrow keys with symbols', () => {
      expect(formatKeyDisplay('ArrowUp')).toBe('↑');
      expect(formatKeyDisplay('ArrowDown')).toBe('↓');
      expect(formatKeyDisplay('ArrowLeft')).toBe('←');
      expect(formatKeyDisplay('ArrowRight')).toBe('→');
    });

    it('should format special keys', () => {
      expect(formatKeyDisplay(' ')).toBe('Space');
      expect(formatKeyDisplay('Escape')).toBe('Esc');
      expect(formatKeyDisplay('Tab')).toBe('Tab');
    });

    it('should uppercase single character keys', () => {
      expect(formatKeyDisplay('a')).toBe('A');
      expect(formatKeyDisplay('z')).toBe('Z');
    });

    it('should return other keys unchanged', () => {
      expect(formatKeyDisplay('Control')).toBe('Control');
      expect(formatKeyDisplay('Meta')).toBe('Meta');
    });
  });

  describe('formatHotkeyDisplay', () => {
    it('should format hotkey strings with arrow keys compactly', () => {
      expect(formatHotkeyDisplay('Shift+Down')).toBe('Shift+↓');
      expect(formatHotkeyDisplay('Shift+Up')).toBe('Shift+↑');
      expect(formatHotkeyDisplay('Command+ArrowLeft')).toBe('Command+←');
      expect(formatHotkeyDisplay('Ctrl+ArrowRight')).toBe('Ctrl+→');
    });

    it('should format other hotkey combinations', () => {
      expect(formatHotkeyDisplay('Command+Space')).toBe('Command+Space');
      expect(formatHotkeyDisplay('Shift+A')).toBe('Shift+A');
      expect(formatHotkeyDisplay('Ctrl+Alt+T')).toBe('Ctrl+Alt+T');
    });

    it('should handle single keys', () => {
      expect(formatHotkeyDisplay('Escape')).toBe('Esc');
      expect(formatHotkeyDisplay('ArrowUp')).toBe('↑');
      expect(formatHotkeyDisplay('a')).toBe('A');
    });
  });
});