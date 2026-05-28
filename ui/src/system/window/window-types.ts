export interface TaskMetadata {
  appId?: string;
  sourceId?: string;
  initialDate?: string;
  tab?: string;
  similarSourceId?: string;
  tagFilter?: unknown;
  [key: string]: unknown;
}

export interface WindowState {
  id: string;
  appId?: string;
  sourceId?: string;
  title?: string;
  metadata?: TaskMetadata;
}
