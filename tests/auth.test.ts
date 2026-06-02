import { describe, expect, it } from "vitest";
import { getZoomLoginBlockingReason, isUnsupportedSsoUrl } from "../src/zoom/auth.js";

describe("isUnsupportedSsoUrl", () => {
  it("treats Zoom native sign-in URLs as supported", () => {
    expect(isUnsupportedSsoUrl("https://zoom.us/signin#/login", "https://zoom.us")).toBe(false);
    expect(isUnsupportedSsoUrl("https://zoom.us/profile", "https://zoom.us")).toBe(false);
  });

  it("rejects known SSO redirects", () => {
    expect(isUnsupportedSsoUrl("https://success.zoom.us/saml/login", "https://zoom.us")).toBe(true);
    expect(isUnsupportedSsoUrl("https://zoom.okta.com/app/zoomus/example/sso/saml", "https://zoom.us")).toBe(true);
  });
});

describe("getZoomLoginBlockingReason", () => {
  it("ignores the generic reCAPTCHA footer on the normal sign-in page", () => {
    expect(
      getZoomLoginBlockingReason(
        "Zoom is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply."
      )
    ).toBeUndefined();
  });

  it("detects a real CAPTCHA error", () => {
    expect(getZoomLoginBlockingReason("You have entered the letters (CAPTCHA) incorrectly. Try again.")).toMatch(
      /CAPTCHA/
    );
  });

  it("detects MFA and bad credential blockers", () => {
    expect(getZoomLoginBlockingReason("Enter the verification code from your email.")).toMatch(/MFA/);
    expect(getZoomLoginBlockingReason("Incorrect email or password.")).toMatch(/credentials/);
  });
});
