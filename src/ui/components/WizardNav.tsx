interface WizardStep {
  id: string;
  label: string;
  sublabel?: string;
  enabled: boolean;
  complete: boolean;
}

interface WizardNavProps {
  steps: WizardStep[];
  activeStepId: string;
  onStepClick(stepId: string): void;
}

export function WizardNav({ steps, activeStepId, onStepClick }: WizardNavProps) {
  return (
    <nav className="wizard-nav" aria-label="Workflow steps">
      {steps.map((step, index) => {
        const isActive = step.id === activeStepId;
        const isPast = step.complete;
        return (
          <button
            key={step.id}
            className={`wizard-step ${isActive ? "active" : ""} ${isPast ? "complete" : ""} ${!step.enabled ? "disabled" : ""}`}
            onClick={() => step.enabled && onStepClick(step.id)}
            disabled={!step.enabled}
            aria-current={isActive ? "step" : undefined}
          >
            <span className="wizard-step-number">
              {isPast ? "✓" : index + 1}
            </span>
            <span className="wizard-step-text">
              <span className="wizard-step-label">{step.label}</span>
              {step.sublabel ? <span className="wizard-step-sublabel">{step.sublabel}</span> : null}
            </span>
            {index < steps.length - 1 ? <span className="wizard-step-connector" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
