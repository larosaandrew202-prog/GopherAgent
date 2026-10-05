import { AppIcon } from '@/components/ui/AppIcon';
import { classNames } from '@/lib/format';

/**
 * Neutral brand mark shown where the old CowAgent avatar/logo used to be.
 * Renders a rounded badge with a generic robot glyph instead of a bitmap logo.
 */
export function BrandMark({
  className = 'w-8 h-8',
  rounded = 'rounded-lg',
  glyph = 'text-sm',
}: {
  className?: string;
  rounded?: string;
  glyph?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={classNames(
        'flex items-center justify-center flex-shrink-0 bg-primary-500 text-white shadow-sm',
        rounded,
        className,
      )}
    >
      <AppIcon className={classNames('fas fa-robot', glyph)} />
    </div>
  );
}
