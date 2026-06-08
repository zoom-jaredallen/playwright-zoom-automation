import type { RecordedAction } from "../types.js";
import { actionSearchText } from "./actionText.js";
import type { EntityFingerprintField, EntityModel, WorkflowIntentAnalysis } from "./types.js";

export interface ApplicationAdapter {
  readonly name: string;
  enhanceEntityModel(input: {
    entity: EntityModel;
    actions: RecordedAction[];
    analysis: WorkflowIntentAnalysis;
  }): EntityModel;
}

export function createZoomAdminAdapter(): ApplicationAdapter {
  return new ZoomAdminAdapter();
}

class ZoomAdminAdapter implements ApplicationAdapter {
  readonly name = "zoom-admin";

  enhanceEntityModel(input: { entity: EntityModel; actions: RecordedAction[]; analysis: WorkflowIntentAnalysis }): EntityModel {
    const entityKind = inferZoomEntityKind(input.actions) ?? input.entity.entityKind;
    const fingerprintFields = normalizeZoomFingerprintFields(input.entity.fingerprintFields, entityKind, input.actions);
    return {
      ...input.entity,
      entityKind,
      fingerprintFields,
      desiredState: {
        ...input.entity.desiredState,
        values: Object.fromEntries(fingerprintFields.map((field) => [field.label, field.value]))
      },
      confidence: fingerprintFields.length >= 2 && entityKind !== "unknown" ? "high" : input.entity.confidence
    };
  }
}

function inferZoomEntityKind(actions: RecordedAction[]): string | undefined {
  const text = actions.map(actionSearchText).join(" ");
  if (/phoneNumbers#\/get-number|add number|get number|phone number|\+\d[\d\s().-]{5,}/i.test(text)) return "phoneNumber";
  if (/phoneNumbers#\/(?:add-)?business-address|business address/i.test(text)) return "businessAddress";
  if (/contactCenter.*queues|\/queues\b|\bqueue\b/i.test(text)) return "queue";
  if (/contactCenter.*users|\/users\b|\buser\b|email address/i.test(text)) return "user";
  if (/account.*settings|\/settings\b|\bpolicy\b|\bsetting\b/i.test(text)) return "accountSetting";
  if (/10dlc|brand|campaign/i.test(text)) return "campaign";
  return undefined;
}

function normalizeZoomFingerprintFields(
  fields: EntityFingerprintField[],
  entityKind: string,
  actions: RecordedAction[]
): EntityFingerprintField[] {
  const normalized = fields.flatMap((field): EntityFingerprintField[] => {
    if (entityKind === "phoneNumber" && field.source === "toggle" && field.value === "checked") {
      const phoneNumber = extractPhoneNumber(field.label);
      if (!phoneNumber) return [];
      return [{
        ...field,
        label: "Phone Number",
        value: phoneNumber,
        source: "adapter",
        confidence: "high"
      }];
    }

    if (/number type/i.test(field.label)) {
      return [{
        ...field,
        label: "Number Type",
        value: normalizeZoomNumberType(field.value),
        source: "adapter"
      }];
    }
    return [field];
  });
  const deduped = dedupeZoomFields([...normalized, ...phoneNumberFieldsFromActions(actions)]);
  if (entityKind === "phoneNumber") {
    const phoneNumberFields = deduped.filter((field) => field.label === "Phone Number");
    if (phoneNumberFields.length > 0) return phoneNumberFields;
  }
  return deduped;
}

function phoneNumberFieldsFromActions(actions: RecordedAction[]): EntityFingerprintField[] {
  return actions.flatMap((action): EntityFingerprintField[] => {
    if (action.type === "selectRows" && action.rowSelection?.entityKind === "phoneNumber") {
      return [{
        label: "Phone Number",
        value: `{{${action.rowSelection.outputName ?? "selected.phoneNumbers"}}}`,
        source: "adapter",
        actionId: action.id,
        confidence: "high"
      }];
    }
    if (action.type !== "click") return [];
    if (action.selectors.role?.role !== "checkbox" && !/checkbox/i.test(action.description ?? "")) return [];
    const phoneNumber = extractPhoneNumber([
      action.selectors.anchor?.text,
      action.selectors.role?.name,
      action.selectors.text,
      action.description
    ].filter(Boolean).join(" "));
    if (!phoneNumber) return [];
    return [{
      label: "Phone Number",
      value: phoneNumber,
      source: "adapter",
      actionId: action.id,
      confidence: "high"
    }];
  });
}

function normalizeZoomNumberType(value: string): string {
  if (/virtual service/i.test(value)) return "Virtual Service";
  if (/toll[-\s]?free/i.test(value)) return "Toll-free";
  if (/\btoll\b/i.test(value)) return "Toll";
  return value;
}

function extractPhoneNumber(value: string): string | undefined {
  return value.match(/\+\d[\d\s().-]{5,}/)?.[0]?.replace(/\s+/g, " ").trim();
}

function dedupeZoomFields(fields: EntityFingerprintField[]): EntityFingerprintField[] {
  const seen = new Set<string>();
  const result: EntityFingerprintField[] = [];
  for (const field of fields) {
    const key = `${field.label.toLowerCase()}\u0000${field.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}
