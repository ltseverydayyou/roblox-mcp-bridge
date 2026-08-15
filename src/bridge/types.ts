import type { WebSocket } from "ws";

export type InstanceRole = "primary" | "secondary";

export interface RobloxClient {
  clientId: string;
  sessionId?: string;
  username: string;
  userId: number;
  displayName?: string;
  placeId: number;
  gameId?: number;
  jobId: string;
  placeName: string;
  executorName?: string;
  executorVersion?: string;
  robloxVersion?: string;
  platform?: string;
  transport: "ws" | "http";
  ws?: WebSocket;
  lastHttpPoll: number;
  pendingHttpCommands: string[];
  pendingPollResolve: ((commands: string[]) => void) | null;
}

export interface RobloxResponse {
  id: string;
  output?: string;
  error?: string;
  [key: string]: unknown;
}

export type ResponseResolver = (data: RobloxResponse) => void;

export const NO_CLIENT_SENTINEL = null;
export const INVALID_CLIENT_SENTINEL = "INVALID_CLIENT";
export type DispatchResult = string | null | "INVALID_CLIENT";
