import { stat } from "node:fs/promises";

const maxZoomUploadBytes = 10 * 1024 * 1024;
const allowedDocumentExtensions = new Set([".jpg", ".jpeg", ".png", ".pdf", ".doc", ".docx"]);

export interface DocumentPreflightInput {
  required: boolean;
  idPath?: string;
  businessVerificationPath?: string;
}

export async function validateDocumentFiles(documents: DocumentPreflightInput): Promise<void> {
  if (!documents.required && !documents.idPath && !documents.businessVerificationPath) {
    return;
  }

  if (documents.required && !documents.idPath && !documents.businessVerificationPath) {
    throw new Error(
      "Document preflight failed: DOCUMENT_ID_PATH or DOCUMENT_BUSINESS_VERIFICATION_PATH is required for the selected address profile"
    );
  }

  const results = await Promise.all([
    validateDocument("DOCUMENT_ID_PATH", documents.idPath),
    validateDocument("DOCUMENT_BUSINESS_VERIFICATION_PATH", documents.businessVerificationPath)
  ]);
  const failures = results.filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`Document preflight failed: ${failures.join("; ")}`);
  }
}

async function validateDocument(envName: string, filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }

  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (!allowedDocumentExtensions.has(extension)) {
    return `${envName} must use one of: ${Array.from(allowedDocumentExtensions).join(", ")}`;
  }

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return `${envName} is not a file: ${filePath}`;
    }
    if (stats.size > maxZoomUploadBytes) {
      return `${envName} exceeds Zoom's 10MB upload limit: ${filePath}`;
    }
  } catch {
    return `${envName} does not exist or is not readable: ${filePath}`;
  }

  return undefined;
}
