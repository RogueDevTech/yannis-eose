import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';

type BranchInfo = { id: string; name: string; code: string };

export function BranchContextRequiredModal({
  open,
  branches,
  selectedBranchId,
  actionLabel,
  onSelectedBranchChange,
  onSwitchBranch,
  onClose,
}: {
  open: boolean;
  branches: BranchInfo[];
  selectedBranchId: string;
  actionLabel: string;
  onSelectedBranchChange: (branchId: string) => void;
  onSwitchBranch: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" contentClassName="p-5" aria-labelledby="branch-context-required-title">
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 id="branch-context-required-title" className="text-base font-semibold text-app-fg">
            Branch required
          </h2>
          <p className="text-sm text-app-fg-muted">
            You are in <span className="font-medium">All Branches</span>. Pick a branch to continue with {actionLabel}.
          </p>
        </div>

        <FormSelect
          label="Branch"
          value={selectedBranchId}
          onChange={(e) => onSelectedBranchChange(e.target.value)}
          options={branches.map((branch) => ({
            value: branch.id,
            label: `${branch.name} (${branch.code})`,
          }))}
        />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="primary" onClick={onSwitchBranch} disabled={!selectedBranchId}>
            Switch to selected branch
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
