import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
  {
    variants: {
      variant: {
        default: 'bg-slate-100 text-slate-600',
        outline: 'border border-slate-300 text-slate-700',
        success: 'bg-emerald-50 text-emerald-700',
        danger: 'bg-rose-50 text-rose-700',
        brand: 'bg-brand/10 text-brand',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
