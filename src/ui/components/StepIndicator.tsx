interface Step {
  label: string;
  complete: boolean;
  active: boolean;
}

interface StepIndicatorProps {
  steps: Step[];
}

export function StepIndicator({ steps }: StepIndicatorProps) {
  return (
    <nav className="step-indicator" aria-label="Workflow steps">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className={`step-item ${step.active ? "step-active" : ""} ${step.complete ? "step-complete" : ""}`}
          aria-current={step.active ? "step" : undefined}
        >
          <span className="step-number">
            {step.complete ? "✓" : index + 1}
          </span>
          <span className="step-label">{step.label}</span>
          {index < steps.length - 1 ? <span className="step-connector" /> : null}
        </div>
      ))}
    </nav>
  );
}
