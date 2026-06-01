'use client';

import { useState, useTransition } from 'react';
import { addToCart } from '@/app/cart/actions';

interface AddToCartButtonProps {
  productId: string;
  sku: string;
  name: string;
  disabled?: boolean;
}

export function AddToCartButton({ productId, sku, name, disabled }: AddToCartButtonProps) {
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  const onClick = () => {
    setAdded(false);
    startTransition(async () => {
      await addToCart({ productId, sku, name, qty: 1 });
      setAdded(true);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className="mt-6 w-full rounded-md bg-brand py-3 text-base font-semibold text-brand-fg shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      aria-live="polite"
    >
      {pending ? 'Adding…' : added ? 'Added to cart ✓' : 'Add to cart'}
    </button>
  );
}
