import { readFileSync } from "node:fs";
import { parse } from "yaml";

export interface AddressProfile {
  country: string;
  numberType?: string;
  customerName: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
  };
  contact?: {
    name?: string;
    number?: string;
    email?: string;
  };
  documents?: {
    required?: boolean;
    idPath?: string;
    businessVerificationPath?: string;
  };
}

interface AddressProfilesFile {
  profiles?: Record<string, AddressProfile>;
}

export function loadAddressProfile(filePath: string, profileName: string): AddressProfile {
  const parsed = readAddressProfilesFile(filePath);
  const profile = parsed?.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Address profile not found: ${profileName}`);
  }

  validateProfile(profileName, profile);
  return profile;
}

export function listAddressProfiles(filePath: string): Array<{ id: string; profile: AddressProfile }> {
  const parsed = readAddressProfilesFile(filePath);
  return Object.entries(parsed?.profiles ?? {}).map(([id, profile]) => {
    validateProfile(id, profile);
    return { id, profile };
  });
}

function readAddressProfilesFile(filePath: string): AddressProfilesFile | null {
  const raw = readFileSync(filePath, "utf8");
  return parse(raw) as AddressProfilesFile | null;
}

function validateProfile(profileName: string, profile: AddressProfile): void {
  const missing = [
    ["country", profile.country],
    ["customerName", profile.customerName],
    ["address.line1", profile.address?.line1],
    ["address.city", profile.address?.city],
    ["address.postalCode", profile.address?.postalCode]
  ]
    .filter(([, value]) => !stringValue(value))
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Address profile ${profileName} is missing required fields: ${missing.join(", ")}`);
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
