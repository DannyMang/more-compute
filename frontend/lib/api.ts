export interface FileTreeItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

export interface FileTreeResponse {
  root: string;
  path: string;
  items: FileTreeItem[];
}

export async function fetchFileTree(
  path: string = ".",
): Promise<FileTreeResponse> {
  const query = new URLSearchParams({ path }).toString();
  const response = await fetch(`/api/files?${query}`);

  if (!response.ok) {
    throw new Error(`Failed to load file tree: ${response.status}`);
  }

  return response.json();
}

export async function fetchFilePreview(
  path: string,
  maxBytes = 256_000,
): Promise<string> {
  const query = new URLSearchParams({
    path,
    max_bytes: String(maxBytes),
  }).toString();
  const response = await fetch(`/api/file?${query}`);

  if (!response.ok) {
    throw new Error(`Failed to load file: ${response.status}`);
  }

  return response.text();
}

export interface PackageInfo {
  name: string;
  version: string;
}
export interface PackagesResponse {
  packages: PackageInfo[];
}

export async function fetchInstalledPackages(forceRefresh: boolean = false): Promise<PackageInfo[]> {
  // Add timestamp to prevent browser caching
  const timestamp = forceRefresh ? `&t=${Date.now()}` : '';
  const url = forceRefresh ? `/api/packages?force_refresh=true${timestamp}` : `/api/packages`;
  const response = await fetch(url, {
    cache: forceRefresh ? 'no-store' : 'default'
  });
  if (!response.ok) {
    throw new Error(`Failed to load packages: ${response.status}`);
  }
  const data = (await response.json()) as PackagesResponse;
  return data.packages || [];
}

export interface MetricsSnapshot {
  timestamp: number;
  cpu?: { percent?: number; frequency_mhz?: number; cores?: number };
  memory?: {
    total?: number;
    available?: number;
    used?: number;
    percent?: number;
  };
  gpu?: Array<{
    power_w?: number;
    clock_sm_mhz?: number;
    temperature_c?: number;
    util_percent?: number;
    mem_used_mb?: number;
    mem_total_mb?: number;
  }> | null;
  storage?: {
    total?: number;
    used?: number;
    percent?: number;
    read_bytes?: number;
    write_bytes?: number;
  };
  network?: {
    bytes_sent?: number;
    bytes_recv?: number;
    packets_sent?: number;
    packets_recv?: number;
  };
  process?: {
    rss?: number;
    vms?: number;
    threads?: number;
    cpu_percent?: number;
  };
}

export async function fetchMetrics(): Promise<MetricsSnapshot> {
  const response = await fetch(`/api/metrics`);
  if (!response.ok)
    throw new Error(`Failed to load metrics: ${response.status}`);
  return response.json();
}

// Prime Intellect GPU API Types
export interface EnvVar {
  key: string;
  value: string;
}

export interface PodConfig {
  // Required fields for pod creation
  name: string;
  cloudId: string;
  gpuType: string;
  socket: string;
  gpuCount: number;

  // Optional fields
  diskSize?: number | null;
  vcpus?: number | null;
  memory?: number | null;
  maxPrice?: number | null;
  image?: string | null;
  customTemplateId?: string | null;
  dataCenterId?: string | null;
  country?: string | null;
  security?: string | null;
  envVars?: EnvVar[] | null;
  jupyterPassword?: string | null;
  autoRestart?: boolean | null;
}

export interface ProviderConfig {
  type?: string;
}

export interface TeamConfig {
  teamId?: string | null;
}

export interface CreatePodRequest {
  pod: PodConfig;
  provider: ProviderConfig;
  team?: TeamConfig | null;
}

export interface PodResponse {
  id: string;
  userId: string;
  teamId: string | null;
  name: string;
  status: string;
  gpuName: string;
  gpuCount: number;
  priceHr: number;
  sshConnection: string | null;
  ip: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GpuAvailabilityParams {
  regions?: string[];
  gpu_count?: number;
  gpu_type?: string;
  socket?: string;
  security?: string;
}

export interface PodsListParams {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface GpuAvailability {
  cloudId: string;
  gpuType: string;
  socket: string;
  provider: string;
  gpuCount: number;
  gpuMemory: number;
  security: string;
  prices: {
    onDemand: number;
    communityPrice: number | null;
    isVariable: boolean | null;
    currency: string;
  };
  images: string[];
  region: string | null;
  dataCenter: string | null;
  country: string | null;
  disk?: {
    minCount: number | null;
    defaultCount: number | null;
    maxCount: number | null;
    pricePerUnit: number | null;
    step: number | null;
    defaultIncludedInPrice: boolean | null;
    additionalInfo: string | null;
  };
  sharedDisk?: {
    minCount: number | null;
    defaultCount: number | null;
    maxCount: number | null;
    pricePerUnit: number | null;
    step: number | null;
    defaultIncludedInPrice: boolean | null;
    additionalInfo: string | null;
  };
  vcpu?: {
    minCount: number | null;
    defaultCount: number | null;
    maxCount: number | null;
    pricePerUnit: number | null;
    step: number | null;
    defaultIncludedInPrice: boolean | null;
    additionalInfo: string | null;
  };
  memory?: {
    minCount: number | null;
    defaultCount: number | null;
    maxCount: number | null;
    pricePerUnit: number | null;
    step: number | null;
    defaultIncludedInPrice: boolean | null;
    additionalInfo: string | null;
  };
  internetSpeed: number | null;
  interconnect: number | null;
  interconnectType: string | null;
  provisioningTime: number | null;
  stockStatus?: string;
  isSpot: boolean | null;
  prepaidTime: number | null;
}

export interface GpuAvailabilityResponse {
  [key: string]: GpuAvailability[];
}

export interface PodsListResponse {
  total_count?: number;
  offset?: number;
  limit?: number;
  data?: PodResponse[];
}

export interface DeletePodResponse {
  [key: string]: unknown;
}

export async function fetchGpuConfig(): Promise<{ configured: boolean }> {
  const response = await fetch("/api/gpu/config");
  if (!response.ok) {
    throw new Error(`Failed to fetch GPU config: ${response.status}`);
  }
  return response.json();
}

export async function setGpuApiKey(
  apiKey: string,
): Promise<{ configured: boolean; message: string }> {
  const response = await fetch("/api/gpu/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ api_key: apiKey }),
  });

  if (!response.ok) {
    throw new Error(`Failed to set API key: ${response.status}`);
  }

  return response.json();
}

export async function fetchGpuAvailability(
  params?: GpuAvailabilityParams,
): Promise<GpuAvailabilityResponse> {
  const queryParams = new URLSearchParams();

  if (params?.regions) {
    params.regions.forEach((region) => queryParams.append("regions", region));
  }
  if (params?.gpu_count !== undefined) {
    queryParams.set("gpu_count", String(params.gpu_count));
  }
  if (params?.gpu_type) {
    queryParams.set("gpu_type", params.gpu_type);
  }
  if (params?.socket) {
    queryParams.set("socket", params.socket);
  }
  if (params?.security) {
    queryParams.set("security", params.security);
  }

  const query = queryParams.toString();
  const url = query
    ? `/api/gpu/availability?${query}`
    : "/api/gpu/availability";
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch GPU availability: ${response.status}`);
  }

  return response.json();
}

export async function fetchGpuPods(
  params?: PodsListParams,
): Promise<PodsListResponse> {
  const queryParams = new URLSearchParams();

  if (params?.status) {
    queryParams.set("status", params.status);
  }
  if (params?.limit !== undefined) {
    queryParams.set("limit", String(params.limit));
  }
  if (params?.offset !== undefined) {
    queryParams.set("offset", String(params.offset));
  }

  const query = queryParams.toString();
  const url = query ? `/api/gpu/pods?${query}` : "/api/gpu/pods";
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch GPU pods: ${response.status}`);
  }

  return response.json();
}

export async function createGpuPod(
  podRequest: CreatePodRequest,
): Promise<PodResponse> {
  const response = await fetch("/api/gpu/pods", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(podRequest),
  });

  if (!response.ok) {
    throw new Error(`Failed to create GPU pod: ${response.status}`);
  }

  return response.json();
}

export async function fetchGpuPod(podId: string): Promise<PodResponse> {
  const response = await fetch(`/api/gpu/pods/${podId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch GPU pod: ${response.status}`);
  }

  return response.json();
}

export async function deleteGpuPod(podId: string): Promise<DeletePodResponse> {
  const response = await fetch(`/api/gpu/pods/${podId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to delete GPU pod: ${response.status} - ${errorText}`,
    );
  }

  return response.json();
}

export interface PodConnectionResponse {
  status: string;
  message: string;
  ssh_host?: string;
  ssh_port?: string;
  tunnel_ports?: {
    cmd: string;
    pub: string;
  };
}

export interface PodConnectionStatus {
  connected: boolean;
  pod: {
    id: string;
    name: string;
    status: string;
    gpu_type: string;
    gpu_count: number;
    price_hr: number;
    ssh_connection: string;
  } | null;
  tunnel?: {
    alive: boolean;
    local_cmd_port: number;
    local_pub_port: number;
  };
  executor_attached?: boolean;
}

export async function connectToPod(
  podId: string,
): Promise<PodConnectionResponse> {
  const response = await fetch(`/api/gpu/pods/${podId}/connect`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to connect to pod: ${response.status}`);
  }

  return response.json();
}

export async function disconnectFromPod(): Promise<{
  status: string;
  messages: string[];
}> {
  const response = await fetch("/api/gpu/pods/disconnect", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to disconnect from pod: ${response.status}`);
  }

  return response.json();
}

export async function getPodConnectionStatus(): Promise<PodConnectionStatus> {
  const response = await fetch("/api/gpu/pods/connection/status");

  if (!response.ok) {
    throw new Error(`Failed to get connection status: ${response.status}`);
  }

  return response.json();
}

export async function fixIndentation(code: string): Promise<string> {
  const response = await fetch("/api/fix-indentation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fix indentation: ${response.status}`);
  }

  const data = await response.json();
  return data.fixed_code;
}
