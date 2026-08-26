import * as React from 'react';
import { cn } from '@/lib/utils';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // A card paints its own light surface, so it sets its own text colour
        // rather than inheriting the tenant's page foreground — otherwise a dark
        // theme renders light text on a white card.
        'overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-800 shadow-sm transition-shadow',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-3', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';
