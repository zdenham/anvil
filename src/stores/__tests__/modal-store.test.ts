import { describe, it, expect, beforeEach } from 'vitest';
import { useModalStore, getModalState } from '../modal-store.js';

describe('useModalStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useModalStore.setState({ openCount: 0, isOpen: false });
  });

  it('openModal increments count and sets isOpen', () => {
    useModalStore.getState().openModal();
    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().isOpen).toBe(true);
  });

  it('closeModal decrements count and updates isOpen', () => {
    useModalStore.getState().openModal();
    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().isOpen).toBe(false);
  });

  it('handles nested modals correctly', () => {
    useModalStore.getState().openModal();
    useModalStore.getState().openModal();
    expect(useModalStore.getState().openCount).toBe(2);
    expect(useModalStore.getState().isOpen).toBe(true);

    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().isOpen).toBe(true); // Still open!

    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().isOpen).toBe(false);
  });

  it('closeModal does not go below zero', () => {
    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().isOpen).toBe(false);
  });

  it('getModalState returns current state', () => {
    useModalStore.getState().openModal();
    const state = getModalState();
    expect(state.isOpen).toBe(true);
    expect(state.openCount).toBe(1);
  });
});
