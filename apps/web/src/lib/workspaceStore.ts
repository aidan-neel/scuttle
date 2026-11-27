import { type Action, reduceWorkspaceState, type WorkspaceState } from "./workspaceReducer.ts";

export interface WorkspaceStore {
  readonly getState: () => WorkspaceState;
  readonly dispatch: (action: Action) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export const createWorkspaceStore = (initialState: WorkspaceState): WorkspaceStore => {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: (action) => {
      const nextState = reduceWorkspaceState(state, action);
      if (nextState === state) return;
      state = nextState;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
