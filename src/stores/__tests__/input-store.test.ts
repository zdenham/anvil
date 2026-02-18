// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useInputStore } from '../input-store.js';

describe('useInputStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useInputStore.setState({ content: '', focusRequested: false });
  });

  it('setContent updates content', () => {
    useInputStore.getState().setContent('hello');
    expect(useInputStore.getState().content).toBe('hello');
  });

  it('appendContent appends to existing content', () => {
    useInputStore.getState().setContent('hello');
    useInputStore.getState().appendContent(' world');
    expect(useInputStore.getState().content).toBe('hello world');
  });

  it('clearContent resets content to empty string', () => {
    useInputStore.getState().setContent('hello');
    useInputStore.getState().clearContent();
    expect(useInputStore.getState().content).toBe('');
  });

  it('requestFocus sets focusRequested to true', () => {
    useInputStore.getState().requestFocus();
    expect(useInputStore.getState().focusRequested).toBe(true);
  });

  it('clearFocusRequest sets focusRequested to false', () => {
    useInputStore.getState().requestFocus();
    useInputStore.getState().clearFocusRequest();
    expect(useInputStore.getState().focusRequested).toBe(false);
  });
});
