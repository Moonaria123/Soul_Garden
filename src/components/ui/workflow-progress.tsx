'use client';

import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { CheckCircle2, Circle, XCircle, Loader2, ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n';

export type WorkflowStepStatus = 'done' | 'active' | 'pending' | 'failed';

export interface WorkflowStep {
  id: string;
  label: string;
  status: WorkflowStepStatus;
}

interface WorkflowProgressProps {
  steps: WorkflowStep[];
  defaultOpen?: boolean;
}

const statusIcon: Record<WorkflowStepStatus, React.ReactNode> = {
  done: <CheckCircle2 className="h-3.5 w-3.5 text-primary" />,
  active: <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />,
  pending: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />,
  failed: <XCircle className="h-3.5 w-3.5 text-destructive" />,
};

export function WorkflowProgress({ steps, defaultOpen = false }: WorkflowProgressProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);

  if (steps.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 cursor-pointer select-none">
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`} />
        {open ? t('workflow.hideDetails') : t('workflow.viewDetails')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-1 pl-1">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`flex items-center gap-2 py-0.5 text-xs transition-opacity ${
                step.status === 'pending' ? 'opacity-50' : 'opacity-100'
              }`}
            >
              {statusIcon[step.status]}
              <span className={step.status === 'active' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
