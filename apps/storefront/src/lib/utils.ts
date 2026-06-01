import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn convention: merge clsx + tailwind-merge so conflicting classes win deterministically. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
