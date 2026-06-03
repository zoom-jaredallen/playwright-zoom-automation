/**
 * A lightweight Express mock that simulates the Zoom web portal and API
 * endpoints needed by the automation flows. Used for integration testing
 * without hitting real Zoom infrastructure.
 */
import express from "express";
import type { Server } from "node:http";

export interface MockZoomServerOptions {
  /** Sub accounts returned by GET /v2/accounts. */
  accounts?: Array<{ id: string; account_name: string; owner_email: string }>;
  /** Whether the business address page should show an existing address. */
  addressAlreadyExists?: boolean;
  /** Simulate a form field that requires contact number. */
  requireContactNumber?: boolean;
  /** Simulate a document upload field. */
  requireDocumentUpload?: boolean;
  /** Simulate login failure. */
  loginShouldFail?: boolean;
  /** Simulate impersonation failure. */
  impersonationShouldFail?: boolean;
}

export interface MockZoomServer {
  baseUrl: string;
  port: number;
  server: Server;
  /** Track which accounts were impersonated. */
  impersonatedAccounts: string[];
  /** Track which accounts had addresses submitted. */
  submittedAccounts: string[];
  close(): Promise<void>;
}

export async function startMockZoomServer(options: MockZoomServerOptions = {}): Promise<MockZoomServer> {
  const app = express();
  const impersonatedAccounts: string[] = [];
  const submittedAccounts: string[] = [];
  const accounts = options.accounts ?? [
    { id: "sub-001", account_name: "Test Account 1", owner_email: "owner1@test.com" },
    { id: "sub-002", account_name: "Test Account 2", owner_email: "owner2@test.com" }
  ];

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // --- OAuth token endpoint ---
  app.post("/oauth/token", (_req, res) => {
    res.json({ access_token: "mock-access-token", token_type: "bearer", expires_in: 3600 });
  });

  // --- API: List sub accounts ---
  app.get("/v2/accounts", (_req, res) => {
    res.json({ accounts });
  });

  // --- Web: Sign-in page ---
  app.get("/signin", (_req, res) => {
    if (options.loginShouldFail) {
      res.send(loginPageHtml("Incorrect email or password"));
      return;
    }
    res.send(loginPageHtml());
  });

  // --- Web: Sign-in form submission ---
  app.post("/signin", (_req, res) => {
    if (options.loginShouldFail) {
      res.send(loginPageHtml("Incorrect email or password"));
      return;
    }
    res.cookie("cred", "mock-cred");
    res.cookie("zm_cluster", "mock-cluster");
    res.cookie("zm_aid", "mock-aid");
    res.cookie("zm_haid", "mock-haid");
    res.cookie("_zm_page_auth", "mock-page-auth");
    res.redirect("/profile");
  });

  // --- Web: Profile page (indicates successful login) ---
  app.get("/profile", (_req, res) => {
    res.send("<html><body><h1>Profile</h1></body></html>");
  });

  app.get("/account", (_req, res) => {
    res.send("<html><body><h1>Account</h1></body></html>");
  });

  // --- Web: Sub-account impersonation ---
  app.get("/account/sub/:accountId/login", (req, res) => {
    const accountId = req.params.accountId;
    if (options.impersonationShouldFail) {
      res.status(403).send("Forbidden");
      return;
    }
    impersonatedAccounts.push(accountId);
    res.cookie("_zm_login_acctype", "sub");
    res.redirect(`/submanage/profile?accountId=${accountId}`);
  });

  // --- Web: Sub-account profile (impersonated context) ---
  app.get("/submanage/profile", (_req, res) => {
    res.send("<html><body><h1>Sub Account Profile</h1><p>Not a master account</p></body></html>");
  });

  // --- Web: Business address page ---
  app.get("/cpw/page/phoneNumbers", (req, res) => {
    const accountId = req.query.accountId as string | undefined;
    if (options.addressAlreadyExists) {
      res.send(businessAddressPageHtml({ existing: true }));
    } else {
      res.send(businessAddressPageHtml({ existing: false, requireContactNumber: options.requireContactNumber }));
    }
  });

  // --- Web: Business address form submission ---
  app.post("/cpw/page/phoneNumbers/save", (req, res) => {
    submittedAccounts.push(req.body?.accountId ?? "unknown");
    res.json({ success: true });
  });

  // --- Cookie acceptance ---
  app.get("/cookies/accept", (_req, res) => {
    res.json({ ok: true });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        port,
        server,
        impersonatedAccounts,
        submittedAccounts,
        close: () => new Promise<void>((closeResolve) => server.close(() => closeResolve()))
      });
    });
  });
}

function loginPageHtml(error?: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Zoom Sign In</title></head>
<body>
  ${error ? `<div class="error">${error}</div>` : ""}
  <form action="/signin" method="POST">
    <input id="email" name="account" type="email" placeholder="Email" />
    <button id="signin_btn_next" type="button">Next</button>
    <input type="password" name="password" placeholder="Password" />
    <button id="signin_btn" type="submit">Sign In</button>
  </form>
</body>
</html>`;
}

function businessAddressPageHtml(options: { existing: boolean; requireContactNumber?: boolean }): string {
  if (options.existing) {
    return `<!DOCTYPE html>
<html>
<head><title>Business Address</title></head>
<body>
  <h1>Business Address</h1>
  <div class="address-list">
    <div class="address-row">
      <span>9 Castlereagh St</span>
      <span>Level 1</span>
      <span>Sydney</span>
      <span>NSW</span>
      <span>2000</span>
      <span>Australia</span>
      <span>Toll</span>
      <span class="status">Verified</span>
    </div>
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<head><title>Business Address</title></head>
<body>
  <h1>Business Address</h1>
  <div class="address-list"></div>
  <button role="button">Add Address</button>
  <div class="address-form" style="display:none;">
    <div role="combobox" aria-label="Country/Region">
      <input type="text" />
    </div>
    <div role="combobox" aria-label="Number Type & Capability">
      <input type="text" />
    </div>
    <label>
      <span>Address Line 1</span>
      <input type="text" aria-label="Address Line 1" />
    </label>
    <label>
      <span>Address Line 2</span>
      <input type="text" aria-label="Address Line 2" />
    </label>
    <label>
      <span>City</span>
      <input type="text" aria-label="City" />
    </label>
    <label>
      <span>State/Province/Territory</span>
      <input type="text" aria-label="State/Province/Territory" />
    </label>
    <label>
      <span>Zip/Postal Code</span>
      <input type="text" aria-label="Zip/Postal Code" />
    </label>
    <label>
      <span>Customer Name</span>
      <input type="text" aria-label="Customer Name" />
    </label>
    <label>
      <span>Contact Name</span>
      <input type="text" aria-label="Contact Name" />
    </label>
    ${options.requireContactNumber ? `<label><span>Contact Number</span><input type="text" aria-label="Contact Number" /></label>` : ""}
    <label>
      <span>Contact Email Address</span>
      <input type="text" aria-label="Contact Email Address" />
    </label>
    <button role="button">Save</button>
  </div>
</body>
</html>`;
}
