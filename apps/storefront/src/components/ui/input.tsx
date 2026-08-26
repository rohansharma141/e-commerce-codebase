import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        // text-slate-800 rather than inheriting: the field paints its own light
        // background, so under a dark tenant theme the typed value would
        // otherwise be light-on-white and invisible as you type.
        'flex h-9 w-full rounded-md border border-slate-300 bg-white/90 px-3 py-1 text-sm text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
