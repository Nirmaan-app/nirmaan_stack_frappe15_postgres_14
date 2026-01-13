import * as React from 'react';
import { cn } from '@/lib/utils';
import { Check, LucideIcon } from 'lucide-react';
import { useBreakpoint } from '@/hooks/useMediaQuery';

export interface WizardStep {
  key: string;
  title: string;
  shortTitle?: string;
  icon?: LucideIcon;
}

interface WizardStepsProps {
  steps: WizardStep[];
  currentStep: number;
  completedSteps?: number[];
  onStepClick?: (stepIndex: number) => void;
  allowForwardNavigation?: boolean;
  className?: string;
}

/* ─────────────────────────────────────────────────────────────
   STEP CIRCLE COMPONENT
   ───────────────────────────────────────────────────────────── */
interface StepCircleProps {
  stepNumber: number;
  status: 'completed' | 'current' | 'upcoming';
  size?: 'sm' | 'md';
}

const StepCircle: React.FC<StepCircleProps> = ({ stepNumber, status, size = 'md' }) => {
  const sizeClasses = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full font-semibold transition-all duration-300',
        sizeClasses,
        status === 'completed' && 'bg-emerald-500 text-white',
        status === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
        status === 'upcoming' && 'bg-muted text-muted-foreground border-2 border-muted-foreground/30'
      )}
    >
      {status === 'completed' ? (
        <Check className={cn(size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} strokeWidth={3} />
      ) : (
        stepNumber
      )}

      {/* Pulse animation for current step */}
      {status === 'current' && (
        <span className="absolute inset-0 rounded-full animate-ping bg-primary/30" style={{ animationDuration: '2s' }} />
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   CONNECTOR LINE COMPONENT
   ───────────────────────────────────────────────────────────── */
interface ConnectorProps {
  status: 'completed' | 'active' | 'pending';
  className?: string;
}

const Connector: React.FC<ConnectorProps> = ({ status, className }) => {
  return (
    <div
      className={cn(
        'flex-1 h-0.5 mx-2 transition-all duration-500',
        status === 'completed' && 'bg-emerald-500',
        status === 'active' && 'bg-gradient-to-r from-emerald-500 via-primary to-muted',
        status === 'pending' && 'bg-muted',
        className
      )}
    />
  );
};

/* ─────────────────────────────────────────────────────────────
   MOBILE PROGRESS BAR VIEW
   ───────────────────────────────────────────────────────────── */
interface MobileProgressProps {
  steps: WizardStep[];
  currentStep: number;
}

const MobileProgress: React.FC<MobileProgressProps> = ({ steps, currentStep }) => {
  const percentage = Math.round(((currentStep + 1) / steps.length) * 100);
  const currentStepData = steps[currentStep];

  return (
    <div className="px-4 py-3 bg-card border border-border rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Step {currentStep + 1} of {steps.length}
        </span>
        <span className="text-xs font-semibold text-primary">
          {percentage}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-primary rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <p className="text-sm font-medium text-foreground">
        {currentStepData?.title}
      </p>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   TABLET COMPACT VIEW
   ───────────────────────────────────────────────────────────── */
interface TabletCompactProps {
  steps: WizardStep[];
  currentStep: number;
  completedSteps: number[];
  onStepClick?: (stepIndex: number) => void;
  allowForwardNavigation: boolean;
}

const TabletCompact: React.FC<TabletCompactProps> = ({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
  allowForwardNavigation,
}) => {
  const getStatus = (index: number): 'completed' | 'current' | 'upcoming' => {
    if (completedSteps.includes(index)) return 'completed';
    if (index === currentStep) return 'current';
    return 'upcoming';
  };

  const getConnectorStatus = (index: number): 'completed' | 'active' | 'pending' => {
    if (completedSteps.includes(index + 1)) return 'completed';
    if (index < currentStep) return 'completed';
    if (index === currentStep) return 'active';
    return 'pending';
  };

  const canClick = (index: number): boolean => {
    if (!onStepClick) return false;
    if (allowForwardNavigation) return true;
    return index <= currentStep || completedSteps.includes(index);
  };

  return (
    <div className="px-4 py-3">
      {/* Step indicators row */}
      <div className="flex items-center justify-center mb-3">
        {steps.map((step, index) => (
          <React.Fragment key={step.key}>
            <button
              type="button"
              onClick={() => canClick(index) && onStepClick?.(index)}
              disabled={!canClick(index)}
              className={cn(
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-full',
                canClick(index) ? 'cursor-pointer' : 'cursor-default'
              )}
            >
              <StepCircle
                stepNumber={index + 1}
                status={getStatus(index)}
                size="sm"
              />
            </button>

            {index < steps.length - 1 && (
              <Connector status={getConnectorStatus(index)} className="w-8 sm:w-12" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Current step title */}
      <p className="text-center text-sm font-medium text-foreground">
        {steps[currentStep]?.title}
      </p>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   DESKTOP FULL VIEW
   ───────────────────────────────────────────────────────────── */
interface DesktopFullProps {
  steps: WizardStep[];
  currentStep: number;
  completedSteps: number[];
  onStepClick?: (stepIndex: number) => void;
  allowForwardNavigation: boolean;
}

const DesktopFull: React.FC<DesktopFullProps> = ({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
  allowForwardNavigation,
}) => {
  const getStatus = (index: number): 'completed' | 'current' | 'upcoming' => {
    if (completedSteps.includes(index)) return 'completed';
    if (index === currentStep) return 'current';
    return 'upcoming';
  };

  const getConnectorStatus = (index: number): 'completed' | 'active' | 'pending' => {
    if (completedSteps.includes(index + 1)) return 'completed';
    if (index < currentStep) return 'completed';
    if (index === currentStep) return 'active';
    return 'pending';
  };

  const canClick = (index: number): boolean => {
    if (!onStepClick) return false;
    if (allowForwardNavigation) return true;
    return index <= currentStep || completedSteps.includes(index);
  };

  return (
    <div className="px-6 lg:px-10 py-4">
      <div className="flex items-center">
        {steps.map((step, index) => (
          <React.Fragment key={step.key}>
            {/* Step item */}
            <button
              type="button"
              onClick={() => canClick(index) && onStepClick?.(index)}
              disabled={!canClick(index)}
              className={cn(
                'flex flex-col items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg p-2 -m-2',
                canClick(index)
                  ? 'cursor-pointer hover:bg-accent/50 transition-colors'
                  : 'cursor-default'
              )}
            >
              <StepCircle stepNumber={index + 1} status={getStatus(index)} />
              <span
                className={cn(
                  'text-xs font-medium transition-colors whitespace-nowrap',
                  getStatus(index) === 'current' && 'text-primary',
                  getStatus(index) === 'completed' && 'text-emerald-600 dark:text-emerald-400',
                  getStatus(index) === 'upcoming' && 'text-muted-foreground'
                )}
              >
                {step.shortTitle || step.title}
              </span>
            </button>

            {/* Connector */}
            {index < steps.length - 1 && (
              <Connector status={getConnectorStatus(index)} className="min-w-8 lg:min-w-12" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   MAIN WIZARD STEPS COMPONENT
   ───────────────────────────────────────────────────────────── */
export const WizardSteps: React.FC<WizardStepsProps> = ({
  steps,
  currentStep,
  completedSteps = [],
  onStepClick,
  allowForwardNavigation = false,
  className,
}) => {
  const { isMobile, isTablet, isDesktop } = useBreakpoint();

  // Derive completed steps if not provided
  const derivedCompletedSteps = React.useMemo(() => {
    if (completedSteps.length > 0) return completedSteps;
    return Array.from({ length: currentStep }, (_, i) => i);
  }, [completedSteps, currentStep]);

  return (
    <div className={cn('w-full', className)}>
      {isMobile && (
        <MobileProgress steps={steps} currentStep={currentStep} />
      )}

      {isTablet && (
        <TabletCompact
          steps={steps}
          currentStep={currentStep}
          completedSteps={derivedCompletedSteps}
          onStepClick={onStepClick}
          allowForwardNavigation={allowForwardNavigation}
        />
      )}

      {isDesktop && (
        <DesktopFull
          steps={steps}
          currentStep={currentStep}
          completedSteps={derivedCompletedSteps}
          onStepClick={onStepClick}
          allowForwardNavigation={allowForwardNavigation}
        />
      )}
    </div>
  );
};

export default WizardSteps;
