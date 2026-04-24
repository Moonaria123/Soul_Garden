'use client';

import { cn } from '@/lib/utils';

interface StepperProps {
  currentStep: number;
  steps: { label: string }[];
}

export function Stepper({ currentStep, steps }: StepperProps) {
  return (
    <div className="flex items-center justify-center w-full py-6">
      <div className="flex items-center gap-0">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const isLast = index === steps.length - 1;

          return (
            <div key={index} className="flex items-center">
              {/* Step node */}
              <div className="flex flex-col items-center gap-2">
                {/* Circle */}
                <div
                  className={cn(
                    'relative flex items-center justify-center size-5 rounded-full border transition-all duration-300',
                    isCompleted && 'border-primary bg-primary-highlight text-primary',
                    isActive && 'border-primary bg-primary text-primary-foreground shadow-[var(--shadow-warm-sm)]',
                    !isCompleted && !isActive && 'border-[hsl(var(--border))] bg-transparent'
                  )}
                >
                  {isCompleted ? <span className="text-[10px]">✓</span> : <div className={cn('size-2 rounded-full', isActive ? 'bg-primary-foreground' : 'bg-transparent')} />}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    'text-xs whitespace-nowrap transition-colors duration-300',
                    isCompleted && 'text-foreground',
                    isActive && 'text-primary font-medium',
                    !isCompleted && !isActive && 'text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line */}
              {!isLast && (
                <div className="relative mx-2 mt-[-1.5rem] w-12 sm:w-16 md:w-20">
                  {/* Background line */}
                  <div className="h-px w-full bg-[hsl(var(--border))]" />
                  {/* Active/completed fill */}
                  <div
                    className={cn(
                      'absolute top-0 left-0 h-px transition-all duration-500 ease-out',
                      isCompleted
                        ? 'w-full bg-primary/70'
                        : 'w-0 bg-transparent'
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
