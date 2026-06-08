import type { RecordedAction } from "../shared/types.js";
import { isElementVisible, replayClickElement, sleep, visibleText } from "./domHelpers.js";

export async function evaluatePreflightCondition(
  action: RecordedAction,
  findElementSync: (action: RecordedAction) => Element | undefined
): Promise<{ skip: boolean; message?: string }> {
  if (!action.condition) return { skip: false };
  const condition = action.condition;
  const conditionType = String(condition.type);
  const selector = conditionCssSelector(condition, action);
  switch (conditionType) {
    case "textExistsSkip":
    case "skipIfTextExists": {
      const text = condition.text ?? action.value ?? action.expected ?? "";
      if (text && visibleText(document.body).toLowerCase().includes(text.toLowerCase())) {
        return { skip: true, message: `Skipped because text exists: ${text}` };
      }
      return { skip: false };
    }
    case "elementVisibleClick":
    case "clickIfElementVisible": {
      if (!selector) return { skip: false };
      const element = document.querySelector(selector);
      if (element && isElementVisible(element)) {
        replayClickElement(element);
        await sleep(250);
      }
      return { skip: false };
    }
    case "fieldEmptyFill":
    case "fillIfEmpty": {
      const element = findElementSync(action);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (element.value.trim()) {
          return { skip: true, message: "Skipped fill because field already has a value." };
        }
      }
      return { skip: false };
    }
    case "addressAlreadyExistsSkipAccount":
    case "skipAccountIfAddressExists":
      if (condition.text && visibleText(document.body).toLowerCase().includes(condition.text.toLowerCase())) {
        return { skip: true, message: `Skipped because address text exists: ${condition.text}` };
      }
      return { skip: false };
    case "entityStateGuard":
    case "if": {
      const predicate = (condition as { predicate?: unknown }).predicate;
      if (predicate && await evalPredicateDom(predicate)) {
        return { skip: false };
      }
      return { skip: true, message: "Skipped because condition predicate was false." };
    }
    default:
      return { skip: false };
  }
}

function conditionCssSelector(condition: RecordedAction["condition"], action: RecordedAction): string | undefined {
  const selector = condition?.selector ?? action.selectors.css;
  if (typeof selector === "string") return selector;
  return selector?.css;
}

async function evalPredicateDom(predicate: any): Promise<boolean> {
  switch (predicate.kind) {
    case "textExists":
      return Boolean(predicate.text && visibleText(document.body).toLowerCase().includes(String(predicate.text).toLowerCase()));
    case "elementVisible": {
      const selector = predicate.selector?.css ?? predicate.selector;
      if (!selector) return false;
      const element = document.querySelector(selector);
      return Boolean(element && isElementVisible(element));
    }
    case "fieldEmpty": {
      const selector = predicate.selector?.css ?? predicate.selector;
      const element = selector ? document.querySelector(selector) : undefined;
      return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? !element.value.trim()
        : false;
    }
    case "urlMatches":
      return Boolean(predicate.pattern && new RegExp(String(predicate.pattern)).test(window.location.href));
    default:
      return false;
  }
}
