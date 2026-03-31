// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useTreeMenuStore } from '../tree-menu/store.js';
import type { TreeMenuPersistedState } from '../tree-menu/types.js';

describe('tree-menu refreshTree', () => {
  beforeEach(() => {
    useTreeMenuStore.setState({
      expandedSections: {},
      selectedItemId: null,
      pinnedWorktreeId: null,
      hiddenWorktreeIds: [],
      hiddenRepoIds: [],
      renamingNodeId: null,
      _hydrated: false,
    });
  });

  it('refreshTree preserves selectedItemId', () => {
    const initial: TreeMenuPersistedState = {
      expandedSections: { 'section-1': true },
      selectedItemId: 'thread-A',
      pinnedWorktreeId: null,
    };

    // Hydrate with initial state (simulates app startup)
    useTreeMenuStore.getState().hydrate(initial);
    expect(useTreeMenuStore.getState().selectedItemId).toBe('thread-A');

    // User navigates to thread-B
    useTreeMenuStore.getState()._applySetSelectedItem('thread-B');
    expect(useTreeMenuStore.getState().selectedItemId).toBe('thread-B');

    // refreshTree arrives with disk state still showing thread-A
    const diskState: TreeMenuPersistedState = {
      expandedSections: { 'section-1': true, 'section-2': false },
      selectedItemId: 'thread-A',
      pinnedWorktreeId: 'wt-1',
    };
    useTreeMenuStore.getState().refreshTree(diskState);

    // Selection must stay on thread-B
    expect(useTreeMenuStore.getState().selectedItemId).toBe('thread-B');
    // But other fields should update
    expect(useTreeMenuStore.getState().expandedSections).toEqual({ 'section-1': true, 'section-2': false });
    expect(useTreeMenuStore.getState().pinnedWorktreeId).toBe('wt-1');
  });

  it('hydrate does overwrite selectedItemId', () => {
    useTreeMenuStore.getState()._applySetSelectedItem('thread-B');

    const diskState: TreeMenuPersistedState = {
      expandedSections: {},
      selectedItemId: 'thread-A',
      pinnedWorktreeId: null,
    };
    useTreeMenuStore.getState().hydrate(diskState);

    // Full hydrate should restore the disk value
    expect(useTreeMenuStore.getState().selectedItemId).toBe('thread-A');
  });
});
