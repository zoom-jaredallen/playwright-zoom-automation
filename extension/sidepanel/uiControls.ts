export type StepToolbarIcon = "navigate" | "click" | "fill" | "select" | "validate" | "press" | "screenshot" | "wait" | "dismiss";

export function makeEditorSection(title: string, child?: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.className = "inline-editor-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);
  if (child) section.appendChild(child);
  return section;
}

export function makeTextField(labelText: string, value: string, placeholder: string, onCommit: (value: string) => Promise<void>): HTMLElement {
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("blur", () => void onCommit(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  const wrapper = document.createElement("div");
  wrapper.append(label, input);
  return wrapper;
}

export function makeNumberField(labelText: string, value: number, range: { min: number; max: number; step: number }, onCommit: (value: number) => Promise<void>): HTMLElement {
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  input.addEventListener("blur", () => void onCommit(Number(input.value) || 0));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  const wrapper = document.createElement("div");
  wrapper.append(label, input);
  return wrapper;
}

export function makeCheckbox(labelText: string, checked: boolean, onCommit: (checked: boolean) => Promise<void>): HTMLElement {
  const label = document.createElement("label");
  label.className = "checkbox-control";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => void onCommit(input.checked));
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  return label;
}

export function makeLabeledSelect(labelText: string, value: string, options: Array<[string, string]>, onCommit: (value: string) => Promise<void>): HTMLElement {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  wrapper.append(label, makeSelect(value, options, onCommit));
  return wrapper;
}

export function makeSelect(value: string, options: Array<[string, string]>, onCommit: (value: string) => Promise<void>): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener("change", () => void onCommit(select.value));
  return select;
}

export function makeActionButton(label: string, disabled: boolean, onClick: () => void, className?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button${className ? ` ${className}` : ""}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", () => onClick());
  return button;
}

export function makeParamButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.textContent = active ? `[${label}]` : label;
  button.addEventListener("click", () => onClick());
  return button;
}

export function makeRepairButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

export function makeInsertTool(icon: StepToolbarIcon, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "insert-tool";
  button.title = label;
  button.setAttribute("aria-label", label);
  const iconEl = document.createElement("span");
  iconEl.className = "insert-tool-icon";
  iconEl.innerHTML = toolbarIconSvg(icon);
  iconEl.setAttribute("aria-hidden", "true");
  button.append(iconEl);
  button.addEventListener("click", onClick);
  return button;
}

function toolbarIconSvg(icon: StepToolbarIcon): string {
  const icons: Record<StepToolbarIcon, string> = {
    navigate: '<svg viewBox="0 0 24 24"><path d="M5 19 19 5"></path><path d="M9 5h10v10"></path><path d="M5 19l5.5-1.5"></path></svg>',
    click: '<svg viewBox="0 0 24 24"><path d="m5 3 8 18 2-7 6-2L5 3Z"></path><path d="m13 13 5 5"></path></svg>',
    fill: '<svg viewBox="0 0 24 24"><path d="M8 5h8"></path><path d="M12 5v14"></path><path d="M9 19h6"></path></svg>',
    select: '<svg viewBox="0 0 24 24"><path d="M8 6h11"></path><path d="M8 12h11"></path><path d="M8 18h11"></path><path d="m3 12 1.5 1.5L7 10"></path></svg>',
    validate: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5.5c0 4.3 2.8 7.2 7 8.5 4.2-1.3 7-4.2 7-8.5V6l-7-3Z"></path><path d="m8.5 12 2.2 2.2L15.8 9"></path></svg>',
    press: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h6"></path></svg>',
    screenshot: '<svg viewBox="0 0 24 24"><path d="M6.5 8.5h2l1.4-2h4.2l1.4 2h2A2.5 2.5 0 0 1 20 11v5.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5V11a2.5 2.5 0 0 1 2.5-2.5Z"></path><circle cx="12" cy="13.5" r="3"></circle></svg>',
    wait: '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"></path><circle cx="12" cy="13" r="7"></circle><path d="M9 2h6"></path><path d="M12 2v3"></path></svg>',
    dismiss: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="m9 9 6 6"></path><path d="m15 9-6 6"></path></svg>'
  };
  return icons[icon];
}
