import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelJob,
  checkRunReadiness,
  createJob,
  duplicateRecordedWorkflow,
  fetchAddressProfiles,
  fetchJobs,
  fetchRecordedWorkflow,
  fetchRecordedWorkflows,
  fetchWorkflows,
  queryAccounts,
  retryJob,
  saveRecordedWorkflow,
  subscribeToJob,
  type AccountQueryFilters,
  type AddressProfileView,
  type JobView,
  type RecordedWorkflowView,
  type RunReadinessView,
  type SubAccountView,
  type WorkflowView
} from "./api.js";
import { AccountQueryPanel } from "./components/AccountQueryPanel.js";
import { AppShell } from "./components/AppShell.js";
import { ConfigureStep } from "./components/ConfigureStep.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ImportWorkflow } from "./components/ImportWorkflow.js";
import { JobHistoryPanel } from "./components/JobHistoryPanel.js";
import { NameDialog } from "./components/NameDialog.js";
import { RunStep } from "./components/RunStep.js";
import { ToastProvider, useToast } from "./components/Toast.js";
import { WizardNav } from "./components/WizardNav.js";
import { WorkflowEditor } from "./components/WorkflowEditor.js";
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
  const [headless, setHeadless] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [retryAttempts, setRetryAttempts] = useState(2);
  const [accountValues, setAccountValues] = useState<Record<string, Record<string, string>> | undefined>();
  const [readiness, setReadiness] = useState<RunReadinessView | undefined>();
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | undefined>();

  // Job state
  const [job, setJob] = useState<JobView | undefined>();
  const [jobError, setJobError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // History
  const [jobHistory, setJobHistory] = useState<JobView[]>([]);

  // Workflow editor
  const [recordedWorkflows, setRecordedWorkflows] = useState<Array<{ id: string; name: string; category: string; actionCount: number }>>([]);
  const [selectedRecordedWorkflowId, setSelectedRecordedWorkflowId] = useState<string | undefined>();
  const [selectedRecordedWorkflow, setSelectedRecordedWorkflow] = useState<RecordedWorkflowView | undefined>();
  const [recordedLoading, setRecordedLoading] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<{ id: string; name: string } | undefined>();

  // Derived
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const workflowNames = useMemo(() => new Map(workflows.map((w) => [w.id, w.name])), [workflows]);
  const isRunning = Boolean(job && ["queued", "running"].includes(job.status));
  const selectedAccounts = useMemo(() => accounts.filter((a) => selectedIds.has(a.id)), [accounts, selectedIds]);

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

  useEffect(() => {
    if (wizardStep !== "configure") return;
    setReadinessLoading(true);
    setReadinessError(undefined);
    void checkRunReadiness({
      accounts: selectedAccounts,
      workflowIds: pipelineOrder,
      addressProfile: selectedProfileId,
      dryRun,
      parameterValues: {}
    })
      .then((response) => setReadiness(response.readiness))
      .catch((error) => {
        setReadiness(undefined);
        setReadinessError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setReadinessLoading(false));
  }, [wizardStep, selectedAccounts, pipelineOrder, selectedProfileId, dryRun]);

  const refreshRecordedWorkflows = useCallback(() => {
    setRecordedLoading(true);
    void fetchRecordedWorkflows()
      .then((response) => setRecordedWorkflows(response.workflows))
      .catch((error) => addToast("error", `Workflow list failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setRecordedLoading(false));
  }, [addToast]);

  useEffect(() => {
    if (activeView === "editor") {
      refreshRecordedWorkflows();
    }
  }, [activeView, refreshRecordedWorkflows]);

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
    if (readiness && !readiness.ready) {
      addToast("error", `Run blocked: ${readiness.blocking[0]?.message ?? "readiness checks failed"}`);
      return;
    }
    if (!dryRun) { setConfirmOpen(true); return; }
    executeStartJob();
  };

  const executeStartJob = async () => {
    setConfirmOpen(false);
    setJobError(undefined);
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
        accountDelayMs: 0,
        accountValues
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

  const handleRetryJob = async (sourceJob: JobView, statuses: Array<"failed" | "skipped">) => {
    const retryAccountIds = sourceJob.accounts
      .filter((a) => statuses.includes(a.status as "failed" | "skipped"))
      .map((a) => a.accountId);
    try {
      const response = await retryJob({
        jobId: sourceJob.id,
        accounts,
        statuses,
        dryRun: sourceJob.input.dryRun,
        headless,
        concurrency,
        retryAttempts,
        retryBaseDelayMs: 5000,
        accountDelayMs: 0,
        addressProfile: sourceJob.input.addressProfile
      });
      setSelectedIds(new Set(retryAccountIds));
      setJob(response.job);
      setWizardStep("run");
      setActiveView("run");
      addToast("info", `Retry started for ${retryAccountIds.length} account${retryAccountIds.length === 1 ? "" : "s"}`);
    } catch (error) {
      addToast("error", `Retry failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenRecordedWorkflow = async (workflowId: string) => {
    setRecordedLoading(true);
    try {
      const response = await fetchRecordedWorkflow(workflowId);
      setSelectedRecordedWorkflowId(workflowId);
      setSelectedRecordedWorkflow(response.workflow);
    } catch (error) {
      addToast("error", `Workflow load failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRecordedLoading(false);
    }
  };

  const handleSaveRecordedWorkflow = async (workflow: RecordedWorkflowView) => {
    if (!selectedRecordedWorkflowId) {
      return;
    }
    try {
      await saveRecordedWorkflow(selectedRecordedWorkflowId, workflow);
      setSelectedRecordedWorkflow(workflow);
      refreshRecordedWorkflows();
      addToast("success", `Workflow "${workflow.meta.name}" saved`);
    } catch (error) {
      addToast("error", `Workflow save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleConfirmDuplicate = async (name: string) => {
    if (!duplicateSource) return;
    const sourceId = duplicateSource.id;
    setDuplicateSource(undefined);
    try {
      const result = await duplicateRecordedWorkflow(sourceId, name);
      addToast("success", `Created "${result.name}"`);
      refreshRecordedWorkflows();
      // Refresh the runnable workflow list so the copy appears in Configure.
      void fetchWorkflows().then((r) => setWorkflows(r.workflows)).catch(() => undefined);
      await handleOpenRecordedWorkflow(result.id);
    } catch (error) {
      addToast("error", `Duplicate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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

      <NameDialog
        open={Boolean(duplicateSource)}
        title="Duplicate workflow"
        label="New workflow name"
        initialValue={duplicateSource ? `${duplicateSource.name} (copy)` : ""}
        confirmLabel="Duplicate"
        onConfirm={(name) => void handleConfirmDuplicate(name)}
        onCancel={() => setDuplicateSource(undefined)}
      />

      {importOpen ? (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <ImportWorkflow
              onImported={(result) => {
                setImportOpen(false);
                addToast("success", `Workflow "${result.name}" imported and compiled`);
                if (result.warnings && result.warnings.length > 0) {
                  addToast("warning", `${result.warnings.length} warning(s): ${result.warnings[0]}`);
                }
                // Refresh workflows list
                void fetchWorkflows().then((r) => setWorkflows(r.workflows)).catch(() => undefined);
              }}
              onCancel={() => setImportOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {activeView === "history" ? (
        <JobHistoryPanel jobs={jobHistory} onRetry={handleRetryJob} onRefresh={refreshHistory} />
      ) : activeView === "editor" ? (
        selectedRecordedWorkflow ? (
          <WorkflowEditor
            workflow={selectedRecordedWorkflow}
            onSave={handleSaveRecordedWorkflow}
            onDuplicate={() =>
              selectedRecordedWorkflowId &&
              setDuplicateSource({ id: selectedRecordedWorkflowId, name: selectedRecordedWorkflow.meta.name })
            }
            onClose={() => {
              setSelectedRecordedWorkflow(undefined);
              setSelectedRecordedWorkflowId(undefined);
            }}
          />
        ) : (
          <section className="panel workflow-editor-list">
            <div className="panel-header">
              <div>
                <h2>Workflow editor</h2>
                <p>Open an imported recording to inspect, reorder, and edit its steps.</p>
              </div>
              <div className="table-toolbar-actions">
                <button className="tertiary-button" onClick={refreshRecordedWorkflows} disabled={recordedLoading}>
                  {recordedLoading ? "Loading" : "Refresh"}
                </button>
                <button className="primary-button" onClick={() => setImportOpen(true)}>
                  Import recorded
                </button>
              </div>
            </div>
            {recordedWorkflows.length === 0 ? (
              <div className="empty-run">No recorded workflows imported yet.</div>
            ) : (
              <div className="history-list">
                {recordedWorkflows.map((workflow) => (
                  <div key={workflow.id} className="history-item history-item-row">
                    <button
                      className="history-item-open"
                      onClick={() => void handleOpenRecordedWorkflow(workflow.id)}
                    >
                      <div className="history-row">
                        <div className="history-row-main">
                          <strong>{workflow.name}</strong>
                          <span className="history-row-info">{workflow.category} · {workflow.actionCount} steps</span>
                        </div>
                        <span className="status-badge neutral">Recorded</span>
                      </div>
                    </button>
                    <button
                      className="tertiary-button"
                      onClick={() => setDuplicateSource({ id: workflow.id, name: workflow.name })}
                      title="Duplicate this workflow"
                    >
                      Duplicate
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
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
                readiness={readiness}
                readinessLoading={readinessLoading}
                readinessError={readinessError}
                onToggleWorkflow={handleToggleWorkflow}
                onReorderPipeline={setPipelineOrder}
                onProfileChange={setSelectedProfileId}
                onDryRunChange={setDryRun}
                onHeadlessChange={setHeadless}
                onConcurrencyChange={setConcurrency}
                onRetryAttemptsChange={setRetryAttempts}
                onImportWorkflow={() => setImportOpen(true)}
                onAccountValuesChange={setAccountValues}
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
