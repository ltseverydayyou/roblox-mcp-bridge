export interface NilInstanceRecord {
  DebugId?: string;
  Name: string;
  ClassName: string;
  Path?: string;
  RelativePath?: string;
  ParentDebugId?: string;
  RootDebugId?: string;
  Depth: number;
  IsNilRoot: boolean;
  IsScript: boolean;
  Archivable?: boolean;
  ChildCount?: number;
}

export interface NilInstanceScan {
  scanVersion?: number;
  success: boolean;
  foundNilInstances: number;
  capturedRoots?: number;
  capturedInstances?: number;
  containedInstances?: number;
  recoveredScripts: number;
  capturedScripts?: number;
  functionScans?: number;
  tableScans?: number;
  operations?: number;
  sourcesUsed?: string[];
  instances?: NilInstanceRecord[];
  recovered?: Array<Record<string, unknown>>;
  recoveredTruncated?: boolean;
  treeTruncated?: boolean;
  maxTreeNodes?: number;
  note?: string;
  scannedAt?: string;
}

export interface NilInstanceStoreIdentity {
  clientId: string;
  placeId: number;
  jobId: string;
}

interface StoredNilInstanceScan extends NilInstanceScan {
  identity: NilInstanceStoreIdentity;
}

const scans = new Map<string, StoredNilInstanceScan>();

function keyOf(identity: NilInstanceStoreIdentity): string {
  return `${identity.clientId}\u0000${identity.placeId}\u0000${identity.jobId}`;
}

export function getNilInstanceScan(identity: NilInstanceStoreIdentity): StoredNilInstanceScan | null {
  return scans.get(keyOf(identity)) ?? null;
}

export function setNilInstanceScan(
  identity: NilInstanceStoreIdentity,
  scan: NilInstanceScan
): StoredNilInstanceScan {
  const stored: StoredNilInstanceScan = {
    ...scan,
    scannedAt: scan.scannedAt || new Date().toISOString(),
    identity: { ...identity },
  };
  const key = keyOf(identity);
  if (!scans.has(key) && scans.size >= 20) {
    const oldestKey = scans.keys().next().value as string | undefined;
    if (oldestKey) scans.delete(oldestKey);
  }
  scans.set(key, stored);
  return stored;
}

export function clearNilInstanceScan(identity: NilInstanceStoreIdentity): boolean {
  return scans.delete(keyOf(identity));
}
