export interface SubAccountView {
  id: string;
  name: string;
  ownerEmail?: string;
  ownerName?: string;
}

export interface AddressProfileView {
  id: string;
  country: string;
  numberType: string;
  customerName: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
  };
  documentsRequired: boolean;
}

export interface WorkflowView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: "phone" | "settings" | "compliance";
}

export interface JobView {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  input: {
    accountIds: string[];
    workflowIds: string[];
    dryRun: boolean;
    addressProfile: string;
  };
  accounts: Array<{
    accountId: string;
    workflowId?: string;
    status: "queued" | "running" | "completed" | "skipped" | "failed";
    message?: string;
    error?: string;
  }>;
  summary: {
    queued: number;
    running: number;
    completed: number;
    skipped: number;
    failed: number;
  };
  events: Array<{
    timestamp: string;
    message: string;
  }>;
}

export interface AccountQueryFilters {
  ownerRange?: {
    from: string;
    to: string;
  };
  search?: string;
  limit?: number;
}

export async function fetchAddressProfiles(): Promise<{
  selectedProfile: string;
  adminEmail: string;
  profiles: AddressProfileView[];
}> {
  return requestJson("/api/address-profiles");
}

export async function fetchWorkflows(): Promise<{ workflows: WorkflowView[] }> {
  return requestJson("/api/workflows");
}

export async function queryAccounts(filters: AccountQueryFilters): Promise<{
  total: number;
  count: number;
  accounts: SubAccountView[];
}> {
  return requestJson("/api/accounts/query", {
    method: "POST",
    body: JSON.stringify({ filters })
  });
}

export async function createJob(input: {
  accounts: SubAccountView[];
  accountIds: string[];
  workflowIds: string[];
  addressProfile: string;
  dryRun: boolean;
  headless: boolean;
  retryAttempts: number;
  retryBaseDelayMs: number;
  accountDelayMs: number;
}): Promise<{ job: JobView }> {
  return requestJson("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function fetchJob(jobId: string): Promise<{ job: JobView }> {
  return requestJson(`/api/jobs/${jobId}`);
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return body;
}
