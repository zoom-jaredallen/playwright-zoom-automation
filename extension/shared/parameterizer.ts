import type { ParameterHint } from "./types.js";

/**
 * Analyze a value entered by the user and detect if it looks like
 * account-specific data that should be parameterized.
 */
export function detectParameters(value: string, fieldContext: FieldContext): ParameterHint[] {
  const hints: ParameterHint[] = [];
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 2) return hints;

  // Phone number patterns
  if (/^\+?\d[\d\s\-().]{6,}$/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferPhoneParamName(fieldContext),
      reason: "looks_like_phone_number"
    });
  }

  // Email patterns
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferEmailParamName(fieldContext),
      reason: "looks_like_email"
    });
  }

  // Postal/zip code patterns (4-6 digits, or US format with dash)
  if (/^\d{4,6}$/.test(trimmed) || /^\d{5}-\d{4}$/.test(trimmed)) {
    if (isPostalCodeField(fieldContext)) {
      hints.push({
        originalValue: trimmed,
        suggestedName: "address.postalCode",
        reason: "looks_like_postal_code"
      });
    }
  }

  // Address-like values (multi-word, in address-labeled fields)
  if (isAddressField(fieldContext) && trimmed.includes(" ") && /\d/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferAddressParamName(fieldContext),
      reason: "looks_like_address"
    });
  }

  // Name-like values in name fields
  if (isNameField(fieldContext) && /^[A-Z][a-z]+ [A-Z]/.test(trimmed)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: inferNameParamName(fieldContext),
      reason: "looks_like_name"
    });
  }

  // Country selections
  if (isCountryField(fieldContext)) {
    hints.push({
      originalValue: trimmed,
      suggestedName: "address.country",
      reason: "looks_like_country"
    });
  }

  return hints;
}

export interface FieldContext {
  /** The label or aria-label of the field */
  label?: string;
  /** The placeholder text */
  placeholder?: string;
  /** The field's name attribute */
  name?: string;
  /** The role of the element */
  role?: string;
  /** Nearby heading or section text */
  sectionContext?: string;
}

function isPostalCodeField(ctx: FieldContext): boolean {
  const text = fieldText(ctx);
  return /zip|postal|postcode/i.test(text);
}

function isAddressField(ctx: FieldContext): boolean {
  const text = fieldText(ctx);
  return /address|street|line\s*[12]|suite|unit|apt/i.test(text);
}

function isNameField(ctx: FieldContext): boolean {
  const text = fieldText(ctx);
  return /name|customer|contact/i.test(text) && !/email|phone|number/i.test(text);
}

function isCountryField(ctx: FieldContext): boolean {
  const text = fieldText(ctx);
  return /country|region/i.test(text);
}

function inferPhoneParamName(ctx: FieldContext): string {
  const text = fieldText(ctx);
  if (/contact/i.test(text)) return "contact.number";
  return "phoneNumber";
}

function inferEmailParamName(ctx: FieldContext): string {
  const text = fieldText(ctx);
  if (/contact/i.test(text)) return "contact.email";
  return "contactEmail";
}

function inferAddressParamName(ctx: FieldContext): string {
  const text = fieldText(ctx);
  if (/line\s*2|suite|unit|apt|floor/i.test(text)) return "address.line2";
  if (/city/i.test(text)) return "address.city";
  if (/state|province|territory/i.test(text)) return "address.state";
  return "address.line1";
}

function inferNameParamName(ctx: FieldContext): string {
  const text = fieldText(ctx);
  if (/customer/i.test(text)) return "customerName";
  if (/contact/i.test(text)) return "contact.name";
  return "customerName";
}

function fieldText(ctx: FieldContext): string {
  return [ctx.label, ctx.placeholder, ctx.name, ctx.sectionContext].filter(Boolean).join(" ");
}
