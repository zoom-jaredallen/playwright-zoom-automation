import { useEffect, useMemo, useState } from "react";
import {
  createJob,
  fetchAddressProfiles,
  fetchJob,
  fetchWorkflows,
  queryAccounts,
  type AccountQueryFilters,
  type AddressProfileView,
  type JobView,
  type SubAccountView,
  type WorkflowView
} from "./api.js";
import { AccountQueryPanel } from "./components/AccountQueryPanel.js";
import { AddressProfilePanel } from "./components/AddressProfilePanel.js";
import { AppShell } from "./components/AppShell.js";
import { RunMonitor } from "./components/RunMonitor.js";
import { WorkflowPicker } from "./components/WorkflowPicker.js";

export function App() {
  const [profiles, setProfiles] = useState<AddressProfileView[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("australia_sydney");
  const [workflows, setWorkflows] = useState<WorkflowView[]>([]);
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState(new Set(["add-business-address"]));
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
  const [job, setJob] = useState<JobView | undefined>();
  const [jobError, setJobError] = useState<string | undefined>();

  useEffect(() => {
    void Promise.all([fetchAddressProfiles(), fetchWorkflows()])
      .then(([profileResponse, workflowResponse]) => {
        setProfiles(profileResponse.profiles);
        setSelectedProfileId(profileResponse.selectedProfile);
        setWorkflows(workflowResponse.workflows);
      })
      .catch((error) => setQueryError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      void fetchJob(job.id)
        .then((response) => setJob(response.job))
        .catch((error) => setJobError(error instanceof Error ? error.message : String(error)));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [job]);

  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

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
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : String(error));
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
    if (!workflow?.enabled) {
      return;
    }
    setSelectedWorkflowIds(new Set([workflowId]));
  };

  const handleStartJob = async () => {
    setJobError(undefined);
    const selectedAccounts = accounts.filter((account) => selectedIds.has(account.id));
    try {
      const response = await createJob({
        accounts: selectedAccounts,
        accountIds: selectedAccounts.map((account) => account.id),
        workflowIds: Array.from(selectedWorkflowIds),
        addressProfile: selectedProfileId,
        dryRun,
        headless,
        retryAttempts: 2,
        retryBaseDelayMs: 5_000,
        accountDelayMs: 2_000
      });
      setJob(response.job);
    } catch (error) {
      setJobError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <AppShell>
      <div className="content-header">
        <div>
          <h1>Automation runs</h1>
          <p>Query sub accounts, select workflows, and monitor account-level progress.</p>
        </div>
        <div className="header-metric">
          <span>Selected accounts</span>
          <strong>{selectedIds.size}</strong>
        </div>
      </div>

      <div className="content-grid">
        <div className="primary-column">
          <AccountQueryPanel
            filters={filters}
            accounts={accounts}
            selectedIds={selectedIds}
            loading={queryLoading}
            error={queryError}
            total={totalAccounts}
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
            running={Boolean(job && ["queued", "running"].includes(job.status))}
            onDryRunChange={setDryRun}
            onHeadlessChange={setHeadless}
            onStart={handleStartJob}
          />
          {jobError ? <div className="banner error">{jobError}</div> : null}
        </div>

        <aside className="secondary-column">
          <WorkflowPicker
            workflows={workflows}
            selectedWorkflowIds={selectedWorkflowIds}
            onToggle={handleToggleWorkflow}
          />
          <AddressProfilePanel
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            onChange={setSelectedProfileId}
          />
        </aside>
      </div>
    </AppShell>
  );
}
