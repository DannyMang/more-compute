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
  // RunPod specific
  secure_cloud?: boolean;
  community_cloud?: boolean;
  // Vast.ai specific
  verified?: boolean;
  min_reliability?: number;
  min_gpu_ram?: number;
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
  gpuMemory?: number;
  security?: string;
  // Prime Intellect format
  prices?: {
    onDemand: number;
    communityPrice: number | null;
    isVariable: boolean | null;
    currency: string;
  };
  // Lambda Labs / other providers format
  priceHr?: number;
  gpuName?: string;
  regionDescription?: string;
  vcpus?: number;
  memoryGb?: number;
  storageGb?: number;
  images?: string[];
  region: string | null;
  dataCenter?: string | null;
  country?: string | null;
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
  // RunPod specific
  if (params?.secure_cloud !== undefined) {
    queryParams.set("secure_cloud", String(params.secure_cloud));
  }
  if (params?.community_cloud !== undefined) {
    queryParams.set("community_cloud", String(params.community_cloud));
  }
  // Vast.ai specific
  if (params?.verified !== undefined) {
    queryParams.set("verified", String(params.verified));
  }
  if (params?.min_reliability !== undefined) {
    queryParams.set("min_reliability", String(params.min_reliability));
  }
  if (params?.min_gpu_ram !== undefined) {
    queryParams.set("min_gpu_ram", String(params.min_gpu_ram));
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

// ============================================================================
// Multi-Provider GPU API Types & Functions
// ============================================================================

export interface ProviderInfo {
  name: string;
  display_name: string;
  api_key_env_name: string;
  supports_ssh: boolean;
  dashboard_url: string;
  configured: boolean;
  is_active: boolean;
}

export interface ProvidersListResponse {
  providers: ProviderInfo[];
  active_provider: string | null;
}

export interface ProviderConfigRequest {
  api_key: string;
  make_active?: boolean;
}

export interface ProviderConfigResponse {
  configured: boolean;
  provider: string;
  is_active: boolean;
}

export interface SetActiveProviderRequest {
  provider: string;
}

export interface SetActiveProviderResponse {
  active_provider: string;
  success: boolean;
}

// Extended pod response with provider info
export interface PodResponseWithProvider extends PodResponse {
  provider?: string;
}

// Extended connection status with provider info
export interface PodConnectionStatusWithProvider extends PodConnectionStatus {
  provider?: string;
}

/**
 * Fetch list of all available GPU providers with their configuration status.
 */
export async function fetchGpuProviders(): Promise<ProvidersListResponse> {
  const response = await fetch("/api/gpu/providers");
  if (!response.ok) {
    throw new Error(`Failed to fetch GPU providers: ${response.status}`);
  }
  return response.json();
}

/**
 * Configure a GPU provider with an API key.
 */
export async function configureGpuProvider(
  providerName: string,
  config: ProviderConfigRequest
): Promise<ProviderConfigResponse> {
  const response = await fetch(`/api/gpu/providers/${providerName}/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to configure provider: ${response.status} - ${errorText}`
    );
  }

  return response.json();
}

/**
 * Set the active GPU provider.
 */
export async function setActiveGpuProvider(
  providerName: string
): Promise<SetActiveProviderResponse> {
  const response = await fetch("/api/gpu/providers/active", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider: providerName }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to set active provider: ${response.status} - ${errorText}`
    );
  }

  return response.json();
}

/**
 * Fetch GPU availability from a specific provider.
 */
export async function fetchProviderGpuAvailability(
  providerName: string,
  params?: GpuAvailabilityParams
): Promise<GpuAvailabilityResponse & { provider: string }> {
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
  // RunPod specific
  if (params?.secure_cloud !== undefined) {
    queryParams.set("secure_cloud", String(params.secure_cloud));
  }
  if (params?.community_cloud !== undefined) {
    queryParams.set("community_cloud", String(params.community_cloud));
  }
  // Vast.ai specific
  if (params?.verified !== undefined) {
    queryParams.set("verified", String(params.verified));
  }
  if (params?.min_reliability !== undefined) {
    queryParams.set("min_reliability", String(params.min_reliability));
  }
  if (params?.min_gpu_ram !== undefined) {
    queryParams.set("min_gpu_ram", String(params.min_gpu_ram));
  }

  const query = queryParams.toString();
  const url = query
    ? `/api/gpu/providers/${providerName}/availability?${query}`
    : `/api/gpu/providers/${providerName}/availability`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch GPU availability from ${providerName}: ${response.status}`
    );
  }

  return response.json();
}

/**
 * Fetch pods from a specific provider.
 */
export async function fetchProviderPods(
  providerName: string,
  params?: PodsListParams
): Promise<PodsListResponse & { provider: string }> {
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
  const url = query
    ? `/api/gpu/providers/${providerName}/pods?${query}`
    : `/api/gpu/providers/${providerName}/pods`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch pods from ${providerName}: ${response.status}`
    );
  }

  return response.json();
}

/**
 * Create a pod with a specific provider.
 */
export async function createProviderPod(
  providerName: string,
  podRequest: CreatePodRequest
): Promise<PodResponseWithProvider> {
  const response = await fetch(`/api/gpu/providers/${providerName}/pods`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(podRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create pod with ${providerName}: ${response.status} - ${errorText}`
    );
  }

  return response.json();
}

/**
 * Fetch a specific pod from a provider.
 */
export async function fetchProviderPod(
  providerName: string,
  podId: string
): Promise<PodResponseWithProvider> {
  const response = await fetch(
    `/api/gpu/providers/${providerName}/pods/${podId}`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch pod from ${providerName}: ${response.status}`
    );
  }

  return response.json();
}

/**
 * Delete a pod from a specific provider.
 */
export async function deleteProviderPod(
  providerName: string,
  podId: string
): Promise<DeletePodResponse & { provider: string }> {
  const response = await fetch(
    `/api/gpu/providers/${providerName}/pods/${podId}`,
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to delete pod from ${providerName}: ${response.status} - ${errorText}`
    );
  }

  return response.json();
}

/**
 * Connect to a pod from a specific provider.
 */
export async function connectToProviderPod(
  providerName: string,
  podId: string
): Promise<PodConnectionResponse & { provider: string }> {
  const response = await fetch(
    `/api/gpu/providers/${providerName}/pods/${podId}/connect`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to connect to pod: ${response.status} - ${errorText}`
    );
  }

  return response.json();
}
