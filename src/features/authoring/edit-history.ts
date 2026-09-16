'use client';

import { createContext, useCallback, useContext, useMemo, useReducer } from 'react';

/**
 * The editor's undo stack. A draft is one immutable value, so keeping the last hundred of them is
 * enough to take back anything this screen can do — a deleted step, a moved block, a paragraph
 * rewritten over. Nothing is stored on the server: this is the work in front of the author, and it
 * ends when they leave the draft.
 */
export type Step<T> = { value: T; signature: string; at: number };
export type HistoryState<T> = { past: Step<T>[]; present: Step<T> | null; future: Step<T>[] };
export type HistoryAction<T> =
  /** A change someone made, which is a step they may take back. */
  | { kind: 'write'; value: T; signature: string; at: number }
  /** The same document restated by the server. It is not a step, so it never becomes one. */
  | { kind: 'replace'; value: T | null; signature: string }
  /** A different document, which has no history of its own yet. */
  | { kind: 'open'; value: T | null; signature: string }
  | { kind: 'undo' }
  | { kind: 'redo' };

export const historyLimit = 100;
/** Keystrokes that follow this close on the same shape read as one continuous run of writing. */
export const coalesceMs = 800;
export const emptyHistory = <T,>(): HistoryState<T> => ({ past: [], present: null, future: [] });

/** A restored step never merges with what is typed next, so undo cannot swallow a fresh edit. */
const settled = <T,>(step: Step<T>): Step<T> => ({ ...step, at: 0 });

export function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.kind) {
    case 'open':
      return { past: [], present: action.value === null ? null : { value: action.value, signature: action.signature, at: 0 }, future: [] };
    case 'replace':
      return { ...state, present: action.value === null ? null : { value: action.value, signature: action.signature, at: 0 } };
    case 'write': {
      const step: Step<T> = { value: action.value, signature: action.signature, at: action.at };
      const present = state.present;
      if (!present) return { past: [], present: step, future: [] };
      // Typing is one step, not one step per letter: an edit that leaves the document's shape alone
      // and follows close behind the last one takes its place and keeps its starting moment, so a
      // long run of writing still breaks into steps rather than becoming a single one.
      const merges = present.signature === step.signature && present.at > 0 && action.at - present.at < coalesceMs;
      return {
        past: merges ? state.past : [...state.past, present].slice(-historyLimit),
        present: merges ? { ...step, at: present.at } : step,
        future: [],
      };
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous || !state.present) return state;
      return { past: state.past.slice(0, -1), present: settled(previous), future: [state.present, ...state.future].slice(0, historyLimit) };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next || !state.present) return state;
      return { past: [...state.past, state.present].slice(-historyLimit), present: settled(next), future: rest };
    }
  }
}

export type EditHistory<T> = {
  value: T | null;
  /** Records a step. */
  write: (next: T) => void;
  /** Takes the server's restatement of the same document without making it a step. */
  replace: (next: T) => void;
  /** Starts over on a different document, or on none. */
  open: (next: T | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useEditHistory<T>(signatureOf: (value: T) => string): EditHistory<T> {
  const [state, dispatch] = useReducer(historyReducer<T>, undefined, emptyHistory<T>);
  const write = useCallback((next: T) => dispatch({ kind: 'write', value: next, signature: signatureOf(next), at: Date.now() }), [signatureOf]);
  const replace = useCallback((next: T) => dispatch({ kind: 'replace', value: next, signature: signatureOf(next) }), [signatureOf]);
  const open = useCallback((next: T | null) => dispatch({ kind: 'open', value: next, signature: next === null ? '' : signatureOf(next) }), [signatureOf]);
  const undo = useCallback(() => dispatch({ kind: 'undo' }), []);
  const redo = useCallback(() => dispatch({ kind: 'redo' }), []);
  return useMemo(() => ({
    value: state.present?.value ?? null,
    write, replace, open, undo, redo,
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
  }), [state, write, replace, open, undo, redo]);
}

/**
 * Says what was just removed so the screen can offer it back. Removal is undone by the same stack
 * as everything else; this only carries the word for it out of the card that did the removing,
 * which may sit three components deep inside a question.
 */
export const RemovalNotice = createContext<(what: string) => void>(() => {});
export const useRemovalNotice = () => useContext(RemovalNotice);
