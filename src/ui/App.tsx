import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelJob,
  createJob,
  fetchAddressProfiles,
  fetchJobs,
  fetchRecordedWorkflow,
  fetchRecordedWorkflows,
  fetchWorkflows,
  queryAccounts,
  saveRecordedWorkflow,
  subscribeToJob,
  type AccountQueryFilters,
  type AddressProfileView,
  type JobView,
  type RecordedWorkflowView,
  type SubAccountView,
  type WorkflowView
} from "./api.js";
import { AccountDrawer } from "./components/AccountDrawer.js";
import { AccountQueryPanel } from "./components/AccountQueryPanel.js";
import { StepIndicator } from "./components/StepIndicator.js";
import { WorkflowEditor } from "./components/WorkflowEditor.js";
import { AddressProfilePanel } from "./components/AddressProfilePanel.js";
import { AppShell } from "./components/AppShell.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { JobHistoryPanel } from "./components/JobHistoryPanel.js";
import { RunMonitor } from "./components/RunMonitor.js";
import { ToastProvider, useToast } from "./components/Toast.js";
import { WorkflowPicker } from "./components/WorkflowPicker.js";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";

function AppContent() {
  const { addToast } = useToast();
  const [profiles, setProfiles] = useState<AddressProfileView[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("australia_sydney");
  const [workflows, setWorkflows] = useState<WorkflowView[]>([]);
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState(new Set(["add-business-address"]));
  const [pipelineOrder, setPipelineOrder] = useState<string[]>(["add-business-address"]);
  const [filters, setFilters] = useState<AccountQueryFilters>({
    ownerRange: {
      from: "michael.chen@lab494-s301.zoomdemos.com",
      to: "michael.chen@lab494-s350.zoomdemos.com"
    }
  });
  const [accounts, setAccounts] = useState<SubAccountView[]>([]);
  const [totalAccounts, setTotalAccounts] = useState<number | undefined>();
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | undefined>();
  const [dryRun, setDryRun] = useState(true);
  const [headless, setHeadless] = useState(true);
  const [concurrency, setConcurrency] = useState(1);
  const [retryAttempts, setRetryAttempts] = useState(2);
  const [retryBaseDelayMs, setRetryBaseDelayMs] = useState(5_000);
  const [accountDelayMs, setAccountDelayMs] = useState(2_000);
  const [job, setJob] = useState<JobView | undefined>();
  const [jobError, setJobError] = useState<string | undefined>();
  const [jobHistory, setJobHistory] = useState<JobView[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activeView, setActiveView] = useState<"run" | "history" | "editor">("run");
  const [drawerAccountId, setDrawerAccountId] = useState<string | undefined>();
  const [editingWorkflow, setEditingWorkflow] = useState<RecordedWorkflowView | undefined>();
  const [recordedWorkflowList, setRecordedWorkflowList] = useState<Array<{ id: string; name: string; category: string; actionCount: number }>>([]);

  const isRunning = Boolean(job && ["queued", "running"].includes(job.status));

  useKeyboardShortcuts({
    onStartRun: useCallback(() => {
      if (selectedIds.size > 0 && !isRunning) handleStartRequest();
    }, [selectedIds.size, isRunning]),
    onQueryAccounts: useCallback(() => {
      if (!queryLoading) void handleQuery();
    }, [queryLoading]),
    onCancelRun: useCallback(() => {
      if (isRunning) void handleCancelJob();
    }, [isRunning]),
    onToggleHistory: useCallback(() => {
      setActiveView((v) => v === "history" ? "run" : "history");
    }, [])
  });

  useEffect(() => {
    void Promise.all([fetchAddressProfiles(), fetchWorkflows()])
      .then(([profileResponse, workflowResponse]) => {
        setProfiles(profileResponse.profiles);
        setSelectedProfileId(profileResponse.selectedProfile);
        setWorkflows(workflowResponse.workflows);
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        setQueryError(msg);
        addToast("error", `Failed to load configuration: ${msg}`);
      });
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) {
      return undefined;
    }
    const unsubscribe = subscribeToJob(
      job.id,
      (updatedJob) => {
        setJob(updatedJob);
        if (updatedJob.status === "completed") {
          addToast("success", `Run completed: ${updatedJob.summary.completed} succeeded, ${updatedJob.summary.skipped} skipped`);
          refreshHistory();
        } else if (updatedJob.status === "failed") {
          addToast("error", `Run finished with ${updatedJob.summary.failed} failures`);
          refreshHistory();
        } else if (updatedJob.status === "cancelled") {
          addToast("warning", "Run was cancelled");
          refreshHistory();
        }
      },
      (error) => setJobError(error.message)
    );
    return () => unsubscribe();
  }, [job?.id, job?.status]);

  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

  const accountStatuses = useMemo(() => {
    if (!job) return undefined;
    const map = new Map<string, { status: string; message?: string }>();
    for (const a of job.accounts) {
      if (a.status !== "queued") {
        map.set(a.accountId, { status: a.status, message: a.message ?? a.error });
      }
    }
    return map.size > 0 ? map : undefined;
  }, [job]);

  const refreshHistory = () => {
    void fetchJobs().then((response) => setJobHistory(response.jobs)).catch(() => undefined);
  };

  useEffect(() => { refreshHistory(); }, []);

  useEffect(() => {
    if (activeView === "editor" && !editingWorkflow) {
      void fetchRecordedWorkflows().then((r) => setRecordedWorkflowList(r.workflows)).catch(() => undefined);
    }
  }, [activeView, editingWorkflow]);

  const updateFilters = (nextFilters: AccountQueryFilters) => {
    const ownerRange = nextFilters.ownerRange;
    setFilters({
      ...nextFilters,
      ownerRange: ownerRange && (ownerRange.from || ownerRange.to) ? ownerRange : undefined
    });
  };

  const handleQuery = async () => {
    setQueryLoading(true);
    setQueryError(undefined);
    try {
      const response = await queryAccounts(filters);
      setAccounts(response.accounts);
      setTotalAccounts(response.total);
      setSelectedIds(new Set(response.accounts.map((account) => account.id)));
      addToast("info", `Found ${response.accounts.length} accounts (${response.total} total)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setQueryError(msg);
      addToast("error", msg);
    } finally {
      setQueryLoading(false);
    }
  };

  const handleToggleAccount = (accountId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const handleTogglePage = (accountIds: string[], selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const accountId of accountIds) {
        if (selected) {
          next.add(accountId);
        } else {
          next.delete(accountId);
        }
      }
      return next;
    });
  };

  const handleToggleWorkflow = (workflowId: string) => {
    const workflow = workflows.find((item) => item.id === workflowId);
    if (!workflow?.enabled) return;

    const isSelected = selectedWorkflowIds.has(workflowId);
    if (isSelected) {
      setSelectedWorkflowIds((current) => {
        const next = new Set(current);
        next.delete(workflowId);
        return next;
      });
      setPipelineOrder((order) => order.filter((id) => id !== workflowId));
    } else {
      setSelectedWorkflowIds((current) => {
        const next = new Set(current);
        next.add(workflowId);
        return next;
      });
      setPipelineOrder((order) => [...order, workflowId]);
    }
  };

  const handleReorderPipeline = (order: string[]) => {
    setPipelineOrder(order);
  };

  const handleStartRequest = () => {
    if (!dryRun && selectedIds.size > 0) {
      setConfirmOpen(true);
    } else {
      void executeStartJob();
    }
  };

  const executeStartJob = async () => {
    setConfirmOpen(false);
    setJobError(undefined);
    setActiveView("run");
    const selectedAccounts = accounts.filter((account) => selectedIds.has(account.id));
    try {
      const response = await createJob({
        accounts: selectedAccounts,
        accountIds: selectedAccounts.map((account) => account.id),
        workflowIds: pipelineOrder.length > 0 ? pipelineOrder : Array.from(selectedWorkflowIds),
        addressProfile: selectedProfileId,
        dryRun,
        headless,
        concurrency,
        retryAttempts,
        retryBaseDelayMs,
        accountDelayMs
      });
      setJob(response.job);
      addToast("info", `${dryRun ? "Dry run" : "Run"} started for ${selectedAccounts.length} accounts`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setJobError(msg);
      addToast("error", msg);
    }
  };

  const handleCancelJob = async () => {
    if (!job) return;
    try {
      const response = await cancelJob(job.id);
      setJob(response.job);
      addToast("warning", "Cancellation signalled — finishing current accounts");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setJobError(msg);
      addToast("error", msg);
    }
  };

  const handleRetryFailed = (failedJob: JobView) => {
    const failedAccountIds = failedJob.accounts
      .filter((a) => a.status === "failed")
      .map((a) => a.accountId);
    if (failedAccountIds.length === 0) return;
    setSelectedIds(new Set(failedAccountIds));
    setActiveView("run");
    addToast("info", `Selected ${failedAccountIds.length} failed accounts for retry`);
  };

  const selectedWorkflowName = workflows.find((w) => selectedWorkflowIds.has(w.id))?.name ?? "workflow";

  return (
    <AppShell activeView={activeView} onViewChange={setActiveView}>
      <ConfirmDialog
        open={confirmOpen}
        title="Start live automation run?"
        message={`You're about to run "${selectedWorkflowName}" on ${selectedIds.size} account${selectedIds.size !== 1 ? "s" : ""}. This is NOT a dry run — changes will be made to real Zoom accounts.`}
        confirmLabel="Start run"
        cancelLabel="Go back"
        variant="danger"
        onConfirm={executeStartJob}
        onCancel={() => setConfirmOpen(false)}
      />

      <AccountDrawer
        open={Boolean(drawerAccountId)}
        account={drawerAccountId ? accountsById.get(drawerAccountId) : undefined}
        accountState={drawerAccountId ? job?.accounts.find((a) => a.accountId === drawerAccountId) : undefined}
        onClose={() => setDrawerAccountId(undefined)}
      />

      <div className="content-header">
        <div>
          <h1>{activeView === "history" ? "Run history" : "Automation runs"}</h1>
          <p>
            {activeView === "history"
              ? "View past runs, inspect results, and retry failed accounts."
              : "Query sub accounts, select workflows, and monitor account-level progress."}
          </p>
        </div>
        <div className="header-metric">
          <span>Selected accounts</span>
          <strong>{selectedIds.size}</strong>
        </div>
      </div>

      {activeView === "editor" && editingWorkflow ? (
        <WorkflowEditor
          workflow={editingWorkflow}
          onSave={async (updated) => {
            const id = updated.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            try {
              await saveRecordedWorkflow(id, updated);
              setEditingWorkflow(updated);
              addToast("success", `Workflow "${updated.meta.name}" saved and recompiled`);
            } catch (error) {
              addToast("error", `Save failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          onClose={() => { setEditingWorkflow(undefined); setActiveView("run"); }}
        />
      ) : activeView === "editor" ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Workflow Editor</h2>
              <p>Select a recorded workflow to edit its steps, selectors, and parameters.</p>
            </div>
            <button className="primary-button" onClick={async () => {
              const response = await fetchRecordedWorkflows();
              setRecordedWorkflowList(response.workflows);
            }}>
              Refresh list
            </button>
          </div>
          <div className="workflow-list">
            {recordedWorkflowList.length === 0 ? (
              <div className="empty-run">No recorded workflows found. Record one with the Chrome extension.</div>
            ) : (
              recordedWorkflowList.map((wf) => (
                <button
                  key={wf.id}
                  className="workflow-item"
                  onClick={async () => {
                    try {
                      const response = await fetchRecordedWorkflow(wf.id);
                      setEditingWorkflow(response.workflow);
                    } catch (error) {
                      addToast("error", `Failed to load workflow: ${error instanceof Error ? error.message : String(error)}`);
                    }
                  }}
                >
                  <span className="workflow-check">✎</span>
                  <span className="workflow-copy">
                    <strong>{wf.name}</strong>
                    <small>{wf.actionCount} steps • {wf.category}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : activeView === "history" ? (
        <JobHistoryPanel jobs={jobHistory} onRetryFailed={handleRetryFailed} onRefresh={refreshHistory} />
      ) : (
        <>
        <StepIndicator steps={[
          { label: "Query accounts", complete: accounts.length > 0, active: accounts.length === 0 },
          { label: "Select workflow", complete: selectedWorkflowIds.size > 0, active: accounts.length > 0 && selectedWorkflowIds.size === 0 },
          { label: "Configure", complete: selectedIds.size > 0, active: accounts.length > 0 && selectedWorkflowIds.size > 0 && selectedIds.size === 0 },
          { label: "Run", complete: Boolean(job && !["queued", "running"].includes(job.status)), active: selectedIds.size > 0 && !isRunning }
        ]} />
        <div className="content-grid">
          <div className="primary-column">
            <AccountQueryPanel
              filters={filters}
              accounts={accounts}
              selectedIds={selectedIds}
              loading={queryLoading}
              error={queryError}
              total={totalAccounts}
              accountStatuses={accountStatuses}
              onFiltersChange={updateFilters}
              onQuery={handleQuery}
              onToggle={handleToggleAccount}
              onTogglePage={handleTogglePage}
            />
            <RunMonitor
              selectedCount={selectedIds.size}
              job={job}
              accountsById={accountsById}
              dryRun={dryRun}
              headless={headless}
              concurrency={concurrency}
              retryAttempts={retryAttempts}
              retryBaseDelayMs={retryBaseDelayMs}
              accountDelayMs={accountDelayMs}
              running={Boolean(job && ["queued", "running"].includes(job.status))}
              onDryRunChange={setDryRun}
              onHeadlessChange={setHeadless}
              onConcurrencyChange={setConcurrency}
              onRetryAttemptsChange={setRetryAttempts}
              onRetryBaseDelayMsChange={setRetryBaseDelayMs}
              onAccountDelayMsChange={setAccountDelayMs}
              onStart={handleStartRequest}
              onCancel={handleCancelJob}
              onAccountClick={setDrawerAccountId}
            />
            {jobError ? <div className="banner error">{jobError}</div> : null}
          </div>

          <aside className="secondary-column">
            <WorkflowPicker
              workflows={workflows}
              selectedWorkflowIds={selectedWorkflowIds}
              pipelineOrder={pipelineOrder}
              onToggle={handleToggleWorkflow}
              onReorder={handleReorderPipeline}
            />
            <AddressProfilePanel
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              onChange={setSelectedProfileId}
            />
          </aside>
        </div>
        </>
      )}
    </AppShell>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
