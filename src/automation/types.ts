export interface SubAccount {
  id: string;
  name: string;
  ownerEmail?: string;
  ownerName?: string;
}

export interface FlowInput {
  account: SubAccount;
}

export interface FlowResult {
  status: "completed" | "skipped";
  message?: string;
}

export interface AutomationFlow {
  name: string;
  run(input: FlowInput): Promise<FlowResult>;
}

export interface ProgressAdapter {
  shouldSkip(account: SubAccount): Promise<boolean>;
  markRunning(account: SubAccount): Promise<void>;
  markCompleted(account: SubAccount, message?: string): Promise<void>;
  markSkipped(account: SubAccount, message?: string): Promise<void>;
  markFailed(account: SubAccount, error: Error, retryable: boolean): Promise<void>;
}

export interface RunSummary {
  completed: number;
  failed: number;
  skipped: number;
}

export interface RetryableError extends Error {
  retryable?: boolean;
  retryAfterMs?: number;
}
