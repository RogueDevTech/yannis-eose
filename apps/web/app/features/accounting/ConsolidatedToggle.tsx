import { useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';

/**
 * Consolidated toggle — URL param ?consolidated=true switches the report
 * to aggregate across all companies (branch groups). SuperAdmin/Admin only.
 */
export function ConsolidatedToggle({ active }: { active?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const toggle = () => {
    const next = new URLSearchParams(searchParams);
    if (active) {
      next.delete('consolidated');
    } else {
      next.set('consolidated', 'true');
    }
    setSearchParams(next);
  };

  return (
    <Button
      type="button"
      variant={active ? 'primary' : 'secondary'}
      size="sm"
      onClick={toggle}
    >
      {active ? 'Consolidated' : 'Consolidate'}
    </Button>
  );
}
