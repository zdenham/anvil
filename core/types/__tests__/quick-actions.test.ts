import { describe, it, expect } from 'vitest';
import {
  QuickActionContextSchema,
  QuickActionManifestSchema,
  QuickActionMetadataSchema,
  QuickActionsRegistrySchema,
  QuickActionOverrideSchema,
} from '../quick-actions';

describe('QuickActionContextSchema', () => {
  it('accepts valid contexts', () => {
    expect(QuickActionContextSchema.parse('thread')).toBe('thread');
    expect(QuickActionContextSchema.parse('plan')).toBe('plan');
    expect(QuickActionContextSchema.parse('empty')).toBe('empty');
    expect(QuickActionContextSchema.parse('all')).toBe('all');
  });

  it('rejects invalid contexts', () => {
    expect(() => QuickActionContextSchema.parse('invalid')).toThrow();
    expect(() => QuickActionContextSchema.parse('settings')).toThrow();
  });
});

describe('QuickActionManifestSchema', () => {
  it('accepts valid manifest', () => {
    const manifest = {
      version: 1,
      sdkVersion: '1.0.0',
      actions: [
        {
          slug: 'archive-and-next',
          title: 'Archive & Next',
          description: 'Archives current thread and navigates to next unread',
          entryPoint: 'actions/archive-and-next.js',
          contexts: ['thread'],
        },
      ],
    };
    expect(() => QuickActionManifestSchema.parse(manifest)).not.toThrow();
  });

  it('rejects manifest with wrong version', () => {
    const manifest = { version: 2, sdkVersion: '1.0.0', actions: [] };
    expect(() => QuickActionManifestSchema.parse(manifest)).toThrow();
  });

  it('rejects manifest missing required fields', () => {
    expect(() => QuickActionManifestSchema.parse({})).toThrow();
    expect(() => QuickActionManifestSchema.parse({ version: 1 })).toThrow();
  });
});

describe('QuickActionMetadataSchema', () => {
  it('accepts valid metadata with UUID', () => {
    const metadata = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      slug: 'archive',
      title: 'Archive',
      entryPoint: 'actions/archive.js',
      projectPath: '/Users/test/.mort/quick-actions',
      contexts: ['thread'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(() => QuickActionMetadataSchema.parse(metadata)).not.toThrow();
  });

  it('rejects non-UUID id', () => {
    const metadata = {
      id: 'not-a-uuid',
      slug: 'archive',
      title: 'Archive',
      entryPoint: 'actions/archive.js',
      projectPath: '/path',
      contexts: ['thread'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(() => QuickActionMetadataSchema.parse(metadata)).toThrow();
  });

  it('validates hotkey range 0-9', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      slug: 'test',
      title: 'Test',
      entryPoint: 'test.js',
      projectPath: '/path',
      contexts: ['all'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Valid hotkeys
    expect(() => QuickActionMetadataSchema.parse({ ...base, hotkey: 0 })).not.toThrow();
    expect(() => QuickActionMetadataSchema.parse({ ...base, hotkey: 9 })).not.toThrow();

    // Invalid hotkeys
    expect(() => QuickActionMetadataSchema.parse({ ...base, hotkey: -1 })).toThrow();
    expect(() => QuickActionMetadataSchema.parse({ ...base, hotkey: 10 })).toThrow();
  });

  it('enforces title length limits (1-50 chars)', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      slug: 'test',
      entryPoint: 'test.js',
      projectPath: '/path',
      contexts: ['all'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(() => QuickActionMetadataSchema.parse({ ...base, title: '' })).toThrow();
    expect(() => QuickActionMetadataSchema.parse({ ...base, title: 'A'.repeat(51) })).toThrow();
    expect(() => QuickActionMetadataSchema.parse({ ...base, title: 'Valid Title' })).not.toThrow();
  });

  it('enforces description length limit (200 chars)', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      slug: 'test',
      title: 'Test',
      entryPoint: 'test.js',
      projectPath: '/path',
      contexts: ['all'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(() => QuickActionMetadataSchema.parse({ ...base, description: 'A'.repeat(201) })).toThrow();
    expect(() => QuickActionMetadataSchema.parse({ ...base, description: 'A'.repeat(200) })).not.toThrow();
  });
});

describe('QuickActionsRegistrySchema', () => {
  it('accepts valid registry', () => {
    const registry = {
      actionOverrides: {
        '550e8400-e29b-41d4-a716-446655440000': {
          hotkey: 1,
          customOrder: 0,
          enabled: true,
        },
      },
      slugToId: {
        'archive': '550e8400-e29b-41d4-a716-446655440000',
      },
    };
    expect(() => QuickActionsRegistrySchema.parse(registry)).not.toThrow();
  });

  it('validates slugToId values are UUIDs', () => {
    const registry = {
      actionOverrides: {},
      slugToId: {
        'archive': 'not-a-uuid',
      },
    };
    expect(() => QuickActionsRegistrySchema.parse(registry)).toThrow();
  });
});

describe('QuickActionOverrideSchema', () => {
  it('accepts valid override with all fields', () => {
    const override = {
      hotkey: 5,
      customOrder: 10,
      enabled: false,
    };
    expect(() => QuickActionOverrideSchema.parse(override)).not.toThrow();
  });

  it('accepts empty override', () => {
    expect(() => QuickActionOverrideSchema.parse({})).not.toThrow();
  });

  it('validates hotkey range 0-9 in overrides', () => {
    expect(() => QuickActionOverrideSchema.parse({ hotkey: 0 })).not.toThrow();
    expect(() => QuickActionOverrideSchema.parse({ hotkey: 9 })).not.toThrow();
    expect(() => QuickActionOverrideSchema.parse({ hotkey: -1 })).toThrow();
    expect(() => QuickActionOverrideSchema.parse({ hotkey: 10 })).toThrow();
  });
});
