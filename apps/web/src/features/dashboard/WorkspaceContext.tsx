import * as React from 'react';
import type { WorkspaceDto } from '@inkflow/shared';

export interface CurrentWorkspace {
  workspace: WorkspaceDto;
  workspaces: WorkspaceDto[];
}

const WorkspaceContext = React.createContext<CurrentWorkspace | null>(null);

export function WorkspaceProvider({ value, children }: { value: CurrentWorkspace; children: React.ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** The workspace of the current `/w/:workspaceId` route. */
export function useCurrentWorkspace(): CurrentWorkspace {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error('useCurrentWorkspace must be used inside the dashboard layout');
  return ctx;
}
