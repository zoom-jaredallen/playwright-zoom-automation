import { inputElementValue } from "./domHelpers.js";

export interface FillDebouncer {
  queue(target: Element): void;
  flush(): boolean;
  recordNow(target: Element, value: string): boolean;
}

export function createFillDebouncer(recordFill: (target: Element, value: string) => boolean): FillDebouncer {
  let lastFillTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastFillElement: Element | null = null;
  let lastFillValue = "";
  let lastRecordedFill: { element: Element; value: string; recordedAt: number } | undefined;

  const clearPending = (): void => {
    lastFillElement = null;
    lastFillValue = "";
    clearTimeout(lastFillTimeout);
  };

  const recordNow = (target: Element, value: string): boolean => {
    const recorded = recordFill(target, value);
    if (recorded) {
      lastRecordedFill = {
        element: target,
        value,
        recordedAt: Date.now()
      };
    }
    return recorded;
  };

  const flush = (): boolean => {
    if (!lastFillElement || !lastFillValue) {
      clearPending();
      return false;
    }

    if (
      lastRecordedFill &&
      lastRecordedFill.element === lastFillElement &&
      lastRecordedFill.value === lastFillValue &&
      Date.now() - lastRecordedFill.recordedAt < 1_500
    ) {
      clearPending();
      return false;
    }

    const recorded = recordNow(lastFillElement, lastFillValue);
    clearPending();
    return recorded;
  };

  return {
    queue(target: Element): void {
      const value = inputElementValue(target);
      if (lastFillElement === target) {
        lastFillValue = value;
        clearTimeout(lastFillTimeout);
        lastFillTimeout = setTimeout(() => flush(), 800);
        return;
      }

      flush();
      lastFillElement = target;
      lastFillValue = value;
      lastFillTimeout = setTimeout(() => flush(), 800);
    },
    flush,
    recordNow
  };
}
