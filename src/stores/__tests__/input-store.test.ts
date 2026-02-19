// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createInputStore } from '../input-store.js';

describe('createInputStore', () => {
  let store: ReturnType<typeof createInputStore>;

  beforeEach(() => {
    store = createInputStore();
  });

  it('setContent updates content', () => {
    store.getState().setContent('hello');
    expect(store.getState().content).toBe('hello');
  });

  it('appendContent appends to existing content', () => {
    store.getState().setContent('hello');
    store.getState().appendContent(' world');
    expect(store.getState().content).toBe('hello world');
  });

  it('clearContent resets content to empty string', () => {
    store.getState().setContent('hello');
    store.getState().clearContent();
    expect(store.getState().content).toBe('');
  });

  it('requestFocus sets focusRequested to true', () => {
    store.getState().requestFocus();
    expect(store.getState().focusRequested).toBe(true);
  });

  it('clearFocusRequest sets focusRequested to false', () => {
    store.getState().requestFocus();
    store.getState().clearFocusRequest();
    expect(store.getState().focusRequested).toBe(false);
  });
});
