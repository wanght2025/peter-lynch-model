import { cn } from '@/lib/utils';
import { Loader2Icon } from 'lucide-react';

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG spinner keeps its public SVG props and announces loading state. */
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}
/* oxlint-enable jsx-a11y/prefer-tag-over-role */

export { Spinner };
