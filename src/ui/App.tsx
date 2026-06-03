import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelJob,
  createJob,
  fetchAddressProfiles,
  fetchJobs,
  fetchWorkflows,
  queryAccounts,
  subscribeToJob,
  type AccountQueryFilters,
  type AddressProfileView,
  type JobView,
  type SubAccountView,
  type WorkflowView
} from "./api.js";
import { AccountQueryPanel } from "./components/AccountQueryPanel.js";
import { AppShell } from "./components/AppShell.js";
import { ConfigureStep } from "./components/ConfigureStep.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { JobHistoryPanel } from "./components/JobHistoryPanel.js";
import { RunStep } from "./components/RunStep.js";
import { ToastProvider, useToast } from "./components/Toast.js";
import { WizardNav } from "./components/WizardNav.js";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

type WizardStepId = "accounts" | "configure" | "run";

function AppContent() {
  const { addToast } = useToast();

  // Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStepId>("accounts");
  const [activeView, setActiveView] = useState<"run" | "history" | "editor">("run");

  // Account state
  const [accounts, setAccounts] = useState<SubAccountView[]>([]);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [filters, setFilters] = useState<AccountQueryFilters>({});
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | undefined>();
  const [totalAccounts, setTotalAccounts] = useState<number | undefined>();

  // Workflow state
  const [workflows, setWorkflows] = useState<WorkflowView[]>([]);
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState(new Set(["add-business-address"]));
  const [pipelineOrder, setPipelineOrder] = useState<string[]>(["add-business-address"]);
  const [profiles, setProfiles] = useState<AddressProfileView[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("australia_sydney");

  // Run settings
  const [dryRun, setDryRun] = useState(true);
  const [headless, setHeadless] = useState(true);
  const [concurrency, setConcurrency] = useState(1);
  const [retryAttempts, setRetryAttempts] = useState(2);

  // Job state
  const [job, setJob] = useState<JobView | undefined>();
  const [jobError, setJobError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // History
  const [jobHistory, setJobHistory] = useState<JobView[]>([]);

  // Derived
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const workflowNames = useMemo(() => new Map(workflows.map((w) => [w.id, w.name])), [workflows]);
  const isRunning = Boolean(job && ["queued", "running"].includes(job.status));

  // Load initial data
  useEffect(() => {
    void Promise.all([fetchAddressProfiles(), fetchWorkflows()])
      .then(([profilesRes, workflowsRes]) => {
        setProfiles(profilesRes.profiles);
        setWorkflows(workflowsRes.workflows);
        if (profilesRes.profiles.length > 0) setSelectedProfileId(profilesRes.profiles[0].id);
      })
      .catch(() => undefined);
  }, []);

  // SSE subscription for active job
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return undefined;
    const unsubscribe = subscribeToJob(
      job.id,
      (updatedJob) => {
        setJob(updatedJob);
        if (["completed", "failed", "cancelled"].includes(updatedJob.status)) {
          addToast(
            updatedJob.status === "completed" ? "success" : updatedJob.status === "cancelled" ? "warning" : "error",
            `Run ${updatedJob.status}: ${updatedJob.summary.completed} completed, ${updatedJob.summary.failed} failed`
          );
        }
      },
      () => undefined
    );
    return () => unsubscribe();
  }, [job?.id, job?.status]);

  // History refresh
  const refreshHistory = useCallback(() => {
    void fetchJobs().then((r) => setJobHistory(r.jobs)).catch(() => undefined);
  }, []);
  useEffect(() => { refreshHistory(); }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onStartRun: useCallback(() => {
      if (wizardStep === "configure" && pipelineOrder.length > 0) handleStartRequest();
    }, [wizardStep, pipelineOrder.length]),
    onCancelRun: useCallback(() => {
      if (isRunning) handleCancelJob();
    }, [isRunning]),
    onToggleHistory: useCallback(() => {
      setActiveView((v) => v === "run" ? "history" : "run");
    }, [])
  });

  // Handlers
  const handleQuery = async () => {
    setQueryLoading(true);
    setQueryError(undefined);
    try {
      const response = await queryAccounts(filters);
      setAccounts(response.accounts);
      setTotalAccounts(response.total);
      addToast("success", `Found ${response.accounts.length} accounts`);
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : String(error));
    } finally {
      setQueryLoading(false);
    }
  };

  const handleToggleAccount = (accountId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      return next;
    });
  };

  const handleTogglePage = (accountIds: string[], selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of accountIds) { if (selected) next.add(id); else next.delete(id); }
      return next;
    });
  };

  const handleToggleWorkflow = (workflowId: string) => {
    const workflow = workflows.find((w) => w.id === workflowId);
    if (!workflow?.enabled) return;
    const isSelected = selectedWorkflowIds.has(workflowId);
    if (isSelected) {
      setSelectedWorkflowIds((c) => { const n = new Set(c); n.delete(workflowId); return n; });
      setPipelineOrder((o) => o.filter((id) => id !== workflowId));
    } else {
      setSelectedWorkflowIds((c) => { const n = new Set(c); n.add(workflowId); return n; });
      setPipelineOrder((o) => [...o, workflowId]);
    }
  };

  const handleStartRequest = () => {
    if (!dryRun) { setConfirmOpen(true); return; }
    executeStartJob();
  };

  const executeStartJob = async () => {
    setConfirmOpen(false);
    setJobError(undefined);
    const selectedAccounts = accounts.filter((a) => selectedIds.has(a.id));
    try {
      const response = await createJob({
        accounts: selectedAccounts,
        accountIds: selectedAccounts.map((a) => a.id),
        workflowIds: pipelineOrder,
        addressProfile: selectedProfileId,
        dryRun,
        headless,
        concurrency,
        retryAttempts,
        retryBaseDelayMs: 5000,
        accountDelayMs: 0
      });
      setJob(response.job);
      setWizardStep("run");
      addToast("info", `Run started: ${selectedAccounts.length} accounts`);
    } catch (error) {
      setJobError(error instanceof Error ? error.message : String(error));
      addToast("error", `Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleCancelJob = async () => {
    if (!job) return;
    try {
      await cancelJob(job.id);
      addToast("warning", "Run cancellation requested");
    } catch (error) {
      addToast("error", `Cancel failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRetryFailed = (failedJob: JobView) => {
    const failedAccountIds = failedJob.accounts
      .filter((a) => a.status === "failed")
      .map((a) => a.accountId);
    setSelectedIds(new Set(failedAccountIds));
    setWizardStep("accounts");
    setActiveView("run");
    addToast("info", `${failedAccountIds.length} failed accounts selected for retry`);
  };

  // Wizard step definitions
  const wizardSteps = [
    {
      id: "accounts" as const,
      label: "Select Accounts",
      sublabel: selectedIds.size > 0 ? `${selectedIds.size} selected` : undefined,
      enabled: true,
      complete: selectedIds.size > 0
    },
    {
      id: "configure" as const,
      label: "Configure",
      sublabel: pipelineOrder.length > 0 ? `${pipelineOrder.length} workflow${pipelineOrder.length > 1 ? "s" : ""}` : undefined,
      enabled: selectedIds.size > 0,
      complete: selectedIds.size > 0 && pipelineOrder.length > 0
    },
    {
      id: "run" as const,
      label: "Run",
      sublabel: job ? statusLabel(job.status) : undefined,
      enabled: selectedIds.size > 0 && pipelineOrder.length > 0,
      complete: Boolean(job && ["completed", "failed", "cancelled"].includes(job.status))
    }
  ];

  return (
    <AppShell activeView={activeView} onViewChange={setActiveView}>
      <ConfirmDialog
        open={confirmOpen}
        title="Start live automation run?"
        message={`You're about to run ${pipelineOrder.length} workflow${pipelineOrder.length > 1 ? "s" : ""} on ${selectedIds.size} account${selectedIds.size !== 1 ? "s" : ""}. This is NOT a dry run — changes will be made to real Zoom accounts.`}
        confirmLabel="Start run"
        cancelLabel="Go back"
        variant="danger"
        onConfirm={executeStartJob}
        onCancel={() => setConfirmOpen(false)}
      />

      {activeView === "history" ? (
        <JobHistoryPanel jobs={jobHistory} onRetryFailed={handleRetryFailed} onRefresh={refreshHistory} />
      ) : (
        <div className="wizard-layout">
          <WizardNav
            steps={wizardSteps}
            activeStepId={wizardStep}
            onStepClick={(id) => setWizardStep(id as WizardStepId)}
          />

          <div className="wizard-content">
            {wizardStep === "accounts" ? (
              <div className="wizard-step-content">
                <AccountQueryPanel
                  filters={filters}
                  accounts={accounts}
                  selectedIds={selectedIds}
                  loading={queryLoading}
                  error={queryError}
                  total={totalAccounts}
                  onFiltersChange={setFilters}
                  onQuery={handleQuery}
                  onToggle={handleToggleAccount}
                  onTogglePage={handleTogglePage}
                />
                <div className="wizard-footer">
                  <span />
                  <button
                    className="primary-button"
                    onClick={() => setWizardStep("configure")}
                    disabled={selectedIds.size === 0}
                  >
                    Next: Configure ({selectedIds.size}) →
                  </button>
                </div>
              </div>
            ) : wizardStep === "configure" ? (
              <ConfigureStep
                workflows={workflows}
                selectedWorkflowIds={selectedWorkflowIds}
                pipelineOrder={pipelineOrder}
                profiles={profiles}
                selectedProfileId={selectedProfileId}
                dryRun={dryRun}
                headless={headless}
                concurrency={concurrency}
                retryAttempts={retryAttempts}
                accountCount={selectedIds.size}
                onToggleWorkflow={handleToggleWorkflow}
                onReorderPipeline={setPipelineOrder}
                onProfileChange={setSelectedProfileId}
                onDryRunChange={setDryRun}
                onHeadlessChange={setHeadless}
                onConcurrencyChange={setConcurrency}
                onRetryAttemptsChange={setRetryAttempts}
                onBack={() => setWizardStep("accounts")}
                onNext={handleStartRequest}
              />
            ) : (
              <RunStep
                job={job}
                accountsById={accountsById}
                pipelineOrder={pipelineOrder}
                workflowNames={workflowNames}
                onCancel={handleCancelJob}
                onBack={() => setWizardStep("configure")}
                onNewRun={() => { setJob(undefined); setWizardStep("accounts"); }}
              />
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { queued: "Queued", running: "Running", completed: "Done", failed: "Failed", cancelled: "Cancelled" };
  return labels[status] ?? status;
}
