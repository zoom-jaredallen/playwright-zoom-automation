import type { Predicate, SelectorStrategy } from "@zoom-automation/workflow-core";

interface PredicateEditorProps {
  value: Predicate;
  onChange(next: Predicate): void;
  depth?: number;
}

type PredicateKind = Predicate["kind"];

const KIND_OPTIONS: { value: PredicateKind; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "and", label: "All of (AND)" },
  { value: "or", label: "Any of (OR)" },
  { value: "not", label: "Not" },
  { value: "textVisible", label: "Text is visible" },
  { value: "urlContains", label: "URL contains" },
  { value: "elementVisible", label: "Element is visible" },
  { value: "fieldEmpty", label: "Field is empty" },
  { value: "fieldValue", label: "Field value" }
];

/** Build a default predicate when switching kinds. */
function defaultFor(kind: PredicateKind): Predicate {
  switch (kind) {
    case "and":
    case "or":
      return { kind, operands: [{ kind: "textVisible", text: "" }] };
    case "not":
      return { kind: "not", operand: { kind: "textVisible", text: "" } };
    case "textVisible":
    case "urlContains":
      return { kind, text: "" };
    case "elementVisible":
      return { kind: "elementVisible", selector: {} };
    case "fieldEmpty":
      return { kind: "fieldEmpty", selector: {} };
    case "fieldValue":
      return { kind: "fieldValue", selector: {}, contains: "" };
    default:
      return { kind: "always" };
  }
}

/** A predicate's selector leaf is edited as a single "text or .css" input. */
function selectorToInput(selector: SelectorStrategy): string {
  return selector.css ?? selector.text ?? "";
}
function inputToSelector(raw: string): SelectorStrategy {
  const value = raw.trim();
  if (!value) return {};
  return /^[.#\[]/.test(value) ? { css: value } : { text: value };
}

export function PredicateEditor({ value, onChange, depth = 0 }: PredicateEditorProps) {
  const changeKind = (kind: PredicateKind) => onChange(defaultFor(kind));

  return (
    <div className="predicate-node" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div className="predicate-row">
        <select className="detail-select" value={value.kind} onChange={(e) => changeKind(e.target.value as PredicateKind)}>
          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {(value.kind === "textVisible" || value.kind === "urlContains") ? (
          <input
            className="detail-input"
            value={value.text}
            placeholder={value.kind === "urlContains" ? "#/business-address" : "text on the page"}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
        ) : null}

        {(value.kind === "elementVisible" || value.kind === "fieldEmpty" || value.kind === "fieldValue") ? (
          <input
            className="detail-input mono"
            value={selectorToInput(value.selector)}
            placeholder="visible text or .css selector"
            onChange={(e) => onChange({ ...value, selector: inputToSelector(e.target.value) })}
          />
        ) : null}
      </div>

      {value.kind === "fieldValue" ? (
        <div className="predicate-row">
          <input
            className="detail-input"
            value={value.contains ?? ""}
            placeholder="value contains…"
            onChange={(e) => onChange({ kind: "fieldValue", selector: value.selector, contains: e.target.value || undefined, equals: value.equals })}
          />
        </div>
      ) : null}

      {value.kind === "not" ? (
        <PredicateEditor value={value.operand} onChange={(operand) => onChange({ kind: "not", operand })} depth={depth + 1} />
      ) : null}

      {value.kind === "and" || value.kind === "or" ? (
        <div className="predicate-operands">
          {value.operands.map((operand, index) => (
            <div key={index} className="predicate-operand">
              <PredicateEditor
                value={operand}
                onChange={(next) => onChange({ ...value, operands: value.operands.map((o, i) => (i === index ? next : o)) })}
                depth={depth + 1}
              />
              <button
                className="step-action-btn danger"
                title="Remove condition"
                onClick={() => onChange({ ...value, operands: value.operands.filter((_, i) => i !== index) })}
              >×</button>
            </div>
          ))}
          <button
            className="step-add-btn"
            onClick={() => onChange({ ...value, operands: [...value.operands, { kind: "textVisible", text: "" }] })}
          >+ condition</button>
        </div>
      ) : null}
    </div>
  );
}
