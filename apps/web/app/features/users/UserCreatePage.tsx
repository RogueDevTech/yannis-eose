import { useState, useEffect, useRef, useMemo } from 'react';
import { Form, useActionData, useNavigation, Link } from '@remix-run/react';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { Checkbox } from '~/components/ui/checkbox';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { RadioGroup } from '~/components/ui/radio-group';
import type {
  UserCreateLoaderData,
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserCreateBranch,
} from './types';
import { formatRole, ROLE_AVATAR_GRADIENTS } from './types';
import { PermissionMatrix } from './PermissionMatrix';

// HoCS / HoM / HoLogistics + HR_MANAGER: existing ACTIVE+PENDING holders shown
// as a soft warning only. Multiple holders are allowed; HR is company-wide too.
import { ORG_WIDE_DEPARTMENT_HEAD_ROLES } from '~/lib/rbac';
import { isRoleProbationEligible } from '@yannis/shared';

const HEAD_ROLES = ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS', 'HR_MANAGER'];

/** Roles where Marketing/CS squad placement on create is optional (org-first staff). */
const COMPANY_WIDE_OPTIONAL_SQUAD_ROLES = new Set([
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'LOGISTICS_MANAGER',
]);

/**
 * Roles that belong in the branching system. Mirrors the backend's
 * `BRANCH_ELIGIBLE_ROLES` set in `branches.router.ts::assignUser` (CEO directive
 * 2026-05-10): Marketing, CS, Branch Admin, and HR (added 2026-05-19) live in
 * branches. Every other role is org-wide — Finance, Stock Manager, Logistics
 * (which has its own location-scoping via `logistics_locations`), Admin, etc.
 * — and the Branch Memberships section hides for them entirely.
 *
 * Keep this list in lockstep with the backend; if the two diverge a tampered
 * client could submit branches the server rejects, or a legitimate role would
 * lose its UI section while still being branch-eligible on the server.
 */
const BRANCH_ELIGIBLE_ROLES = new Set([
  'MEDIA_BUYER',
  'HEAD_OF_MARKETING',
  'CS_CLOSER',
  'HEAD_OF_CS',
  'BRANCH_ADMIN',
  'HR_MANAGER',
]);

// ─── Constants ──────────────────────────────────────────

// SUPER_ADMIN is intentionally excluded — it's a singleton created only via /auth/setup.
// ADMIN + BRANCH_ADMIN are admin-class: if an HR user picks them, the backend will route the
// request through the SuperAdmin approval flow (permission_requests).
const ROLES = [
  {
    value: 'ADMIN',
    label: 'Admin',
    description:
      'Full platform access except managing other admins. Creating requires SuperAdmin approval.',
  },
  {
    value: 'BRANCH_ADMIN',
    label: 'Branch Admin',
    description: 'Admin scoped to a single branch — users, settings, reports for that branch.',
  },
  {
    value: 'HEAD_OF_MARKETING',
    label: 'Head of Marketing',
    description: 'Oversees all marketing campaigns and media buyers',
  },
  {
    value: 'MEDIA_BUYER',
    label: 'Media Buyer',
    description: 'Runs ad campaigns and manages ad spend',
  },
  {
    value: 'HEAD_OF_CS',
    label: 'Head of CS',
    description: 'Manages customer service team and order processing',
  },
  {
    value: 'CS_CLOSER',
    label: 'Sales Closer',
    description: 'Handles customer calls and order confirmation',
  },
  {
    value: 'FINANCE_OFFICER',
    label: 'Finance Officer',
    description: 'Manages financials, invoices, and payouts',
  },
  {
    value: 'HEAD_OF_LOGISTICS',
    label: 'Head of Logistics',
    description: 'Oversees logistics operations, logistics companies, 3PL partners, and transfers',
  },
  {
    value: 'STOCK_MANAGER',
    label: 'Stock Manager',
    description: 'Manages inventory and stock movements',
  },
  {
    value: 'TPL_MANAGER',
    label: '3PL Manager',
    description: 'Manages a third-party logistics location',
  },
  { value: 'TPL_RIDER', label: '3PL Rider', description: 'Handles deliveries for a 3PL location' },
  {
    value: 'HR_MANAGER',
    label: 'HR Manager',
    description: 'Manages payroll, commissions, and staff',
  },
];

// ─── Component ──────────────────────────────────────────

export interface EditingUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  capacity: number | null;
  logisticsLocationId: string | null;
  productIds: string[];
  restrictProductAccess: boolean;
  primaryBranchId: string | null;
  branchIds: string[];
  roleTemplateId: string | null;
  permissionOverrides: Record<string, boolean>;
}

/** Type guard — distinguishes a pre-resolved payload (clientLoader cache hit
 *  OR ad-hoc sync caller) from a Promise (first paint). */
function isResolvedUserPicklists<T>(v: T | Promise<T>): v is T {
  return typeof v === 'object' && v != null && !('then' in (v as object));
}

const EMPTY_USER_PICKLISTS: UserCreateLoaderData = {
  products: [],
  locations: [],
  plans: [],
  branches: [],
  activeHeads: [],
  roleTemplates: [],
  permissionCatalog: [],
  templatePermissionsById: {},
  defaultMembershipBranchId: null,
};

export function UserCreatePage({
  picklistsPromise,
  usersBasePath = '/hr/users',
  editingUser,
}: {
  /**
   * Resolved picklists OR a Promise that resolves them. When a Promise, the
   * form chrome (name, email, phone, role, status, password notice, save
   * button, probation flag) renders instantly and only the picklist-driven
   * dropdowns/sections (branch matrix, role template, logistics location,
   * product restrictions, commission plan, permission overrides preview,
   * conflict warning) show "Loading…" until the data lands.
   */
  picklistsPromise: Promise<UserCreateLoaderData> | UserCreateLoaderData;
  usersBasePath?: string;
  editingUser?: EditingUser;
}) {
  // Bridge the deferred picklists to local state so the rest of the form
  // renders immediately with empty arrays (the dropdowns are inert + the
  // selects show "Loading…"). Once the promise resolves the dropdowns light up.
  const [picklists, setPicklists] = useState<UserCreateLoaderData | null>(
    isResolvedUserPicklists(picklistsPromise) ? picklistsPromise : null,
  );
  useEffect(() => {
    if (isResolvedUserPicklists(picklistsPromise)) {
      setPicklists(picklistsPromise);
      return;
    }
    let cancelled = false;
    Promise.resolve(picklistsPromise)
      .then((p) => {
        if (!cancelled) setPicklists(p);
      })
      .catch(() => {
        if (!cancelled) setPicklists(EMPTY_USER_PICKLISTS);
      });
    return () => {
      cancelled = true;
    };
  }, [picklistsPromise]);
  const picklistsLoading = picklists === null;
  const {
    products,
    locations,
    plans,
    branches,
    activeHeads,
    roleTemplates,
    permissionCatalog,
    templatePermissionsById,
    defaultMembershipBranchId,
  } = picklists ?? EMPTY_USER_PICKLISTS;
  const isEditMode = !!editingUser;
  const actionData = useActionData<{
    error?: string;
    success?: boolean;
    requiresApproval?: boolean;
    message?: string;
  }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const errorRef = useRef<HTMLDivElement>(null);
  const branchesAutoFilledRef = useRef(false);
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
  }, [actionData?.error]);

  useEffect(() => {
    if (actionData?.error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [actionData?.error]);

  const [selectedRole, setSelectedRole] = useState(editingUser?.role ?? '');
  const [accountName, setAccountName] = useState(editingUser?.name ?? '');
  const [selectedBranchId, setSelectedBranchId] = useState(editingUser?.primaryBranchId ?? '');
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(
    editingUser?.branchIds ?? [],
  );
  /**
   * True only for roles that the backend's `branches.assignUser` accepts —
   * Marketing, CS, and Branch Admin. Org-wide roles (Finance, Stock Manager,
   * Logistics, HR, Admin, etc.) hide the Branch Memberships block entirely
   * and skip its validation/submit gating. Mirrors the server-side allowlist.
   */
  const roleNeedsBranch = !!selectedRole && BRANCH_ELIGIBLE_ROLES.has(selectedRole);

  useEffect(() => {
    // Skip auto-fill when editing — the user already has assigned branches we shouldn't override.
    if (isEditMode) return;
    if (branchesAutoFilledRef.current) return;
    if (!defaultMembershipBranchId) return;
    if (selectedBranchIds.length > 0) return;
    branchesAutoFilledRef.current = true;
    setSelectedBranchIds([defaultMembershipBranchId]);
    setSelectedBranchId(defaultMembershipBranchId);
  }, [defaultMembershipBranchId, selectedBranchIds.length, isEditMode]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(
    editingUser?.productIds ?? [],
  );
  const [compensationMode, setCompensationMode] = useState<'existing' | 'inline'>('inline');
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  // CEO directive 2026-05-03: head roles + HR Manager are no longer singletons.
  // The form still surfaces a conflict warning so admins see existing holders,
  // but they can confirm and proceed. `confirmedConflict` flips after the user
  // clicks Continue in the modal so the next form submission goes through
  // unblocked. Reset whenever the role / branch changes — different conflict
  // = re-confirm.
  const [confirmedConflict, setConfirmedConflict] = useState(false);
  const [logisticsLocationId, setLogisticsLocationId] = useState(
    editingUser?.logisticsLocationId ?? '',
  );
  const [commissionPlanId, setCommissionPlanId] = useState('');
  // Local 10-digit phone (the part after +234). Validated to start with 7/8/9
  // so we never submit a number outside the Nigerian mobile prefix range.
  // In edit mode: pre-fill with the user's current phone so the editor sees
  // the existing number and can edit in place (CEO-asked behaviour 2026-05).
  // The submission logic still only sends a phone update when the value is a
  // complete 10-digit number, so re-saving without changes is a no-op at the
  // API layer.
  const [phoneLocal, setPhoneLocal] = useState(() => {
    const raw = editingUser?.phone ?? '';
    if (!raw) return '';
    // Strip everything except digits, drop +234 prefix and any leading 0 the
    // way the input's onChange does, then cap at 10 digits.
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('234')) digits = digits.slice(3);
    if (digits.startsWith('0')) digits = digits.slice(1);
    return digits.slice(0, 10);
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(editingUser?.roleTemplateId ?? '');
  const [permissionOverrides, setPermissionOverrides] = useState<Record<string, boolean>>(
    editingUser?.permissionOverrides ?? {},
  );
  const phoneIsComplete = /^[789]\d{9}$/.test(phoneLocal);
  const phoneError =
    phoneLocal.length > 0 && !phoneIsComplete
      ? phoneLocal.length < 10
        ? 'Enter all 10 digits.'
        : 'Number must start with 7, 8, or 9.'
      : undefined;

  // In edit mode, suppress the conflict warning when the role isn't actually changing —
  // the existing user already holds that head slot and re-saving shouldn't trigger a warning
  // about themselves. Also exclude the user being edited from the conflict candidates.
  const conflictingHead =
    HEAD_ROLES.includes(selectedRole) && !(isEditMode && selectedRole === editingUser?.role)
      ? activeHeads.find((h) => {
          if (h.role !== selectedRole) return false;
          if (editingUser && h.id === editingUser.id) return false;
          if (ORG_WIDE_DEPARTMENT_HEAD_ROLES.has(selectedRole)) return true;
          return !!selectedBranchId && h.primaryBranchId === selectedBranchId;
        })
      : undefined;
  const conflictingBranch = conflictingHead
    ? branches.find((b) => b.id === conflictingHead.primaryBranchId)
    : undefined;
  const conflictScopeLabel = ORG_WIDE_DEPARTMENT_HEAD_ROLES.has(selectedRole)
    ? 'The organization'
    : (conflictingBranch?.name ?? 'This branch');

  // Role-conditional visibility
  // Capacity is only meaningful for roles that work an individual workload — Sales closers
  // (max concurrent orders they can handle) and Media Buyers (max concurrent campaigns).
  // Managers / heads don't carry a personal load, so hiding it removes noise from their forms.
  const showCapacity = ['CS_CLOSER', 'MEDIA_BUYER'].includes(selectedRole);
  const showLogisticsLocation = ['TPL_MANAGER', 'TPL_RIDER'].includes(selectedRole);
  const is3PLRole = ['TPL_MANAGER', 'TPL_RIDER'].includes(selectedRole);
  const showProductAssignment = selectedRole === 'MEDIA_BUYER';
  // Compensation is edited in HR's commission plans page, not on the user form. Hide it in edit mode.
  const showCompensation = !!selectedRole && !isEditMode;

  useEffect(() => {
    if (!showLogisticsLocation) setLogisticsLocationId('');
  }, [showLogisticsLocation]);

  // Reset the conflict-confirmation flag whenever the role or branch changes —
  // any of those changes the conflict, so the admin should re-acknowledge.
  useEffect(() => {
    setConfirmedConflict(false);
  }, [selectedRole, selectedBranchId]);

  useEffect(() => {
    if (compensationMode !== 'existing') setCommissionPlanId('');
  }, [compensationMode]);

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  // Mirrors the branch matrix above — checkbox in the list header that
  // selects every product or clears them all. Goes indeterminate when only a
  // subset is selected so the visual cue matches the data.
  const allProductsSelected =
    products.length > 0 && products.every((p) => selectedProductIds.includes(p.id));
  const someProductsSelected =
    products.length > 0 &&
    !allProductsSelected &&
    products.some((p) => selectedProductIds.includes(p.id));
  const selectAllProductsRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = selectAllProductsRef.current;
    if (el) el.indeterminate = someProductsSelected;
  }, [someProductsSelected]);
  const toggleSelectAllProducts = () => {
    if (allProductsSelected) {
      setSelectedProductIds([]);
      return;
    }
    setSelectedProductIds(products.map((p) => p.id));
  };

  const filteredPlans = plans.filter((p) => !selectedRole || p.role === selectedRole);

  const templateByRole = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of roleTemplates ?? []) {
      if (t.kind === 'SYSTEM' && t.mappedRole) map.set(t.mappedRole, t.id);
    }
    return map;
  }, [roleTemplates]);

  useEffect(() => {
    if (!selectedRole) return;
    // In edit mode, keep the user's stored roleTemplateId as long as the role is unchanged —
    // overriding it on mount with the SYSTEM template would lose any custom template assignment.
    if (isEditMode && selectedRole === editingUser?.role && editingUser?.roleTemplateId) {
      return;
    }
    const tid = templateByRole.get(selectedRole);
    if (tid) setSelectedTemplateId(tid);
  }, [selectedRole, templateByRole, isEditMode, editingUser?.role, editingUser?.roleTemplateId]);

  const activeBranches = useMemo(
    () => branches.filter((b: UserCreateBranch) => b.status === 'ACTIVE'),
    [branches],
  );

  const allBranchesSelected =
    activeBranches.length > 0 &&
    activeBranches.every((b) => selectedBranchIds.includes(b.id));

  const someBranchesSelected =
    activeBranches.length > 0 &&
    !allBranchesSelected &&
    activeBranches.some((b) => selectedBranchIds.includes(b.id));

  const selectAllBranchesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = selectAllBranchesRef.current;
    if (el) el.indeterminate = someBranchesSelected;
  }, [someBranchesSelected]);

  const toggleSelectAllBranches = () => {
    if (allBranchesSelected) {
      setSelectedBranchIds([]);
      setSelectedBranchId('');
      return;
    }
    const ids = activeBranches.map((b) => b.id);
    setSelectedBranchIds(ids);
    setSelectedBranchId((prev) => (prev && ids.includes(prev) ? prev : ids[0] ?? ''));
  };

  const toggleBranch = (id: string) => {
    setSelectedBranchIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((branchId) => branchId !== id);
        if (selectedBranchId === id) {
          setSelectedBranchId(next[0] ?? '');
        }
        return next;
      }
      if (!selectedBranchId) {
        setSelectedBranchId(id);
      }
      return [...prev, id];
    });
  };

  const avatarGradient =
    selectedRole && ROLE_AVATAR_GRADIENTS[selectedRole]
      ? ROLE_AVATAR_GRADIENTS[selectedRole]
      : 'from-brand-500 to-brand-700';
  const avatarInitials =
    accountName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('') || '?';

  // Reset permission overrides whenever the role/template changes — but in edit mode,
  // keep the seeded user overrides on initial mount (when role + template still match the
  // user's stored values). Once the user actually changes the role or template, deltas reset.
  useEffect(() => {
    if (
      isEditMode &&
      selectedRole === editingUser?.role &&
      selectedTemplateId === (editingUser?.roleTemplateId ?? '')
    ) {
      return;
    }
    setPermissionOverrides({});
  }, [
    selectedTemplateId,
    selectedRole,
    isEditMode,
    editingUser?.role,
    editingUser?.roleTemplateId,
  ]);

  const templatePermissionCodes = selectedTemplateId
    ? (templatePermissionsById[selectedTemplateId] ?? [])
    : [];

  return (
    <div className="w-full space-y-6">
      <Breadcrumb
        items={
          isEditMode && editingUser
            ? [
                { label: 'Users', to: usersBasePath },
                { label: editingUser.name, to: `${usersBasePath}/${editingUser.id}` },
                { label: 'Edit' },
              ]
            : [{ label: 'Users', to: usersBasePath }, { label: 'Add User' }]
        }
      />

      <PageHeader
        title={isEditMode ? 'Edit user' : 'Add User'}
        description={
          isEditMode
            ? 'Update account, branch memberships, permissions, and role settings.'
            : 'Create a new account for a team member with role-specific settings.'
        }
      />

      {/* Success: requires approval */}
      {actionData?.requiresApproval && (
        <div className="rounded-lg bg-success-50 dark:bg-success-700/20 border border-success-200 dark:border-success-700/50 px-4 py-3">
          <p className="text-sm text-success-700 dark:text-success-500">
            {actionData.message ?? 'User creation request submitted. SuperAdmin will review.'}
          </p>
          <Link
            to="/admin/permission-requests"
            className="text-sm font-medium text-success-600 dark:text-success-400 hover:underline mt-1 inline-block"
          >
            View pending requests →
          </Link>
        </div>
      )}

      {/* Error */}
      {actionData?.error && !dismissedError && (
        <div ref={errorRef}>
          <PageNotification
            variant="error"
            message={actionData.error}
            durationMs={5000}
            onDismiss={() => setDismissedError(true)}
          />
        </div>
      )}

      <Form
        method="post"
        data-branch-scoped-action={roleNeedsBranch ? 'true' : 'false'}
        className="space-y-6"
        onSubmit={(e) => {
          if (conflictingHead && !confirmedConflict) {
            e.preventDefault();
            setConflictModalOpen(true);
          }
        }}
      >
        {/* Update intent — only sent in edit mode */}
        {isEditMode && <input type="hidden" name="intent" value="update" />}
        {/* Hidden fields for JSON arrays */}
        {showProductAssignment && selectedProductIds.length > 0 && (
          <input type="hidden" name="productIds" value={JSON.stringify(selectedProductIds)} />
        )}
        {/* Org-wide roles (Finance, Stock Manager, Logistics, HR, Admin, etc.)
            don't carry branch scope — submit empty arrays so the action layer
            can handle them like the explicit "no branches" case. The backend's
            `branches.assignUser` rejects org-wide roles regardless. */}
        <input
          type="hidden"
          name="branchIds"
          value={roleNeedsBranch ? JSON.stringify(selectedBranchIds) : '[]'}
        />
        <input
          type="hidden"
          name="primaryBranchId"
          value={roleNeedsBranch ? selectedBranchId : ''}
        />
        {selectedTemplateId ? (
          <input type="hidden" name="roleTemplateId" value={selectedTemplateId} />
        ) : null}
        <input
          type="hidden"
          name="permissionOverrides"
          value={JSON.stringify(permissionOverrides)}
        />
        {showLogisticsLocation ? (
          <input type="hidden" name="logisticsLocationId" value={logisticsLocationId} />
        ) : null}
        {compensationMode === 'existing' && filteredPlans.length > 0 ? (
          <input type="hidden" name="commissionPlanId" value={commissionPlanId} />
        ) : null}

        {/* Section 1: Account Details */}
        <div className="card space-y-4">
          <div className="flex flex-col-reverse sm:flex-row sm:items-start sm:justify-between gap-4">
            <h2 className="text-lg font-semibold text-app-fg shrink-0">Account Details</h2>
            <div
              className={`sm:mt-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br ${avatarGradient} flex items-center justify-center shadow-md ring-2 ring-app-border flex-shrink-0 self-start sm:self-auto`}
              aria-hidden
            >
              <span className="text-lg sm:text-xl font-bold text-white tracking-wide">
                {avatarInitials}
              </span>
            </div>
          </div>
          <p className="text-xs text-app-fg-muted -mt-2 sm:-mt-1">
            Initials preview from the full name and role (same style as the user profile header).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Role — first so conditional sections appear below */}
            <div className="sm:col-span-2">
              <FormSelect
                id="role"
                name="role"
                label="Role"
                required
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                placeholder="Select a role"
                options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
              />
              {selectedRole && (
                <p className="text-xs text-app-fg-muted mt-1">
                  {ROLES.find((r) => r.value === selectedRole)?.description}
                </p>
              )}
            </div>

            {/* Permission template is resolved automatically from the role
                (the SYSTEM template for the selected role). The picker used to
                live here but most HR users never need to override it; the
                matrix below shows the effective permissions and lets them
                add/remove individual codes. The state still tracks the
                resolved template id so the matrix and the submit payload
                continue to work. */}

            {selectedRole && permissionCatalog.length > 0 && (
              <div className="sm:col-span-2 space-y-1">
                <PermissionMatrix
                  permissions={permissionCatalog}
                  templateCodes={templatePermissionCodes}
                  overrides={permissionOverrides}
                  onOverridesChange={setPermissionOverrides}
                  selectedRoleLabel={selectedRole ? formatRole(selectedRole) : undefined}
                />
              </div>
            )}

            <div>
              <TextInput
                id="name"
                name="name"
                label="Full Name"
                required
                minLength={2}
                placeholder="John Doe"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>

            <div>
              <TextInput
                id="email"
                name="email"
                type="email"
                label="Email Address"
                required
                placeholder="john@company.com"
                defaultValue={editingUser?.email ?? ''}
                hint={
                  isEditMode
                    ? 'Email changes require SuperAdmin approval before taking effect.'
                    : 'A password will be auto-generated and sent to this email.'
                }
              />
            </div>

            {roleNeedsBranch ? (
            <div className="sm:col-span-2 space-y-3">
              <label className="block text-sm font-medium text-app-fg-muted">
                Branch Memberships
              </label>
              <div className="border border-app-border rounded-lg overflow-hidden flex flex-col">
                {activeBranches.length > 0 ? (
                  <label className="flex items-center gap-3 px-3 py-2.5 bg-app-hover/70 border-b border-app-border hover:bg-app-hover cursor-pointer shrink-0">
                    <Checkbox
                      ref={selectAllBranchesRef}
                      checked={allBranchesSelected}
                      onChange={toggleSelectAllBranches}
                      aria-label="Select all branches"
                    />
                    <span className="text-sm font-medium text-app-fg">Select all branches</span>
                  </label>
                ) : null}
                <div className="max-h-48 overflow-y-auto">
                  {activeBranches.map((branch: UserCreateBranch) => (
                    <label
                      key={branch.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-app-hover/50 cursor-pointer border-b border-app-border last:border-b-0"
                    >
                      <Checkbox
                        checked={selectedBranchIds.includes(branch.id)}
                        onChange={() => toggleBranch(branch.id)}
                      />
                      <span className="text-sm text-app-fg">{branch.name}</span>
                      <span className="text-xs text-app-fg-muted ml-auto">{branch.code}</span>
                    </label>
                  ))}
                </div>
              </div>
              <SearchableSelect
                id="primaryBranchId"
                label="Primary Branch"
                required
                placeholder="Select primary branch"
                searchPlaceholder="Search selected branches..."
                value={selectedBranchId}
                onChange={setSelectedBranchId}
                options={branches
                  .filter((branch: UserCreateBranch) => selectedBranchIds.includes(branch.id))
                  .map((branch: UserCreateBranch) => ({
                    value: branch.id,
                    label: branch.name,
                    description: branch.code,
                  }))}
              />
              {selectedRole && COMPANY_WIDE_OPTIONAL_SQUAD_ROLES.has(selectedRole) ? (
                <p className="text-xs text-app-fg-muted mt-2 rounded-md border border-app-border bg-app-hover/60 px-3 py-2">
                  Team and department placement is optional for this role — attach branches only when they need branch scope.
                </p>
              ) : null}
            </div>
            ) : selectedRole ? (
              <div className="sm:col-span-2 rounded-md border border-app-border bg-app-hover/60 px-3 py-2 text-xs text-app-fg-muted">
                <span className="font-medium text-app-fg">{formatRole(selectedRole)}</span> is an
                {' '}org-wide role — branch assignment is not required. They have visibility across every branch.
              </div>
            ) : null}

            {conflictingHead && (
              <div className="sm:col-span-2">
                <InlineNotification
                  variant="info"
                  message={`${conflictScopeLabel} already has an active ${formatRole(selectedRole)} (${conflictingHead.name}). Yannis allows multiple holders — continue if intended.`}
                />
              </div>
            )}

            <div>
              {isEditMode ? (
                <RadioGroup
                  name="status"
                  label="Status"
                  layout="horizontal"
                  defaultValue={editingUser?.status ?? 'PENDING'}
                  options={(
                    ['PENDING', 'ACTIVE', 'INACTIVE', 'DEACTIVATED', 'ARCHIVED'] as const
                  ).map((s) => ({
                    value: s,
                    label: s.charAt(0) + s.slice(1).toLowerCase(),
                  }))}
                />
              ) : (
                <>
                  <label className="block text-sm font-medium text-app-fg-muted mb-1.5">
                    Status
                  </label>
                  <p className="text-sm text-app-fg">Pending</p>
                  <input type="hidden" name="status" value="PENDING" />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Role-Specific Settings */}
        {(showCapacity || showLogisticsLocation || showProductAssignment) && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Role Settings</h2>

            {/* Capacity (CS roles) */}
            {showCapacity && (
              <div>
                <TextInput
                  id="capacity"
                  name="capacity"
                  type="number"
                  label="Order Capacity"
                  min={1}
                  max={100}
                  defaultValue={
                    isEditMode && editingUser?.capacity != null
                      ? String(editingUser.capacity)
                      : '10'
                  }
                  wrapperClassName="w-full sm:w-32"
                  hint="Maximum concurrent orders this agent can handle."
                />
              </div>
            )}

            {/* Logistics Location (TPL roles) */}
            {showLogisticsLocation && (
              <div>
                <SearchableSelect
                  id="logisticsLocationId"
                  label="Logistics Location"
                  value={logisticsLocationId}
                  onChange={setLogisticsLocationId}
                  placeholder="Select location"
                  searchPlaceholder="Search locations..."
                  options={locations.map((loc: UserCreateLocation) => ({
                    value: loc.id,
                    label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                    description: loc.address,
                  }))}
                />
                {locations.length === 0 && (
                  <InlineNotification
                    variant="warning"
                    message="No logistics locations found. Create one first."
                    action={{ label: 'Go to Logistics', href: '/admin/logistics' }}
                    className="mt-2"
                  />
                )}
              </div>
            )}

            {/* Product Assignment */}
            {showProductAssignment && (
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1.5">
                  Assign Products
                </label>
                <p className="text-xs text-app-fg-muted mb-2">
                  Leave blank to assign all products. Select specific products to restrict.
                </p>
                {products.length > 0 ? (
                  <div className="border border-app-border rounded-lg overflow-hidden flex flex-col">
                    <label className="flex items-center gap-3 px-3 py-2.5 bg-app-hover/70 border-b border-app-border hover:bg-app-hover cursor-pointer shrink-0">
                      <Checkbox
                        ref={selectAllProductsRef}
                        checked={allProductsSelected}
                        onChange={toggleSelectAllProducts}
                        aria-label="Select all products"
                      />
                      <span className="text-sm font-medium text-app-fg">Select all products</span>
                      <span className="text-xs text-app-fg-muted ml-auto">
                        {selectedProductIds.length} / {products.length}
                      </span>
                    </label>
                    <div className="max-h-48 overflow-y-auto">
                      {products.map((product: UserCreateProduct) => (
                        <label
                          key={product.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-app-hover/50 cursor-pointer border-b border-app-border last:border-b-0"
                        >
                          <Checkbox
                            checked={selectedProductIds.includes(product.id)}
                            onChange={() => toggleProduct(product.id)}
                          />
                          <span className="text-sm text-app-fg">{product.name}</span>
                          <span className="text-xs text-app-fg-muted ml-auto">
                            {product.category ?? ''}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-app-fg-muted">No products found.</p>
                )}

                {selectedProductIds.length > 0 && (
                  <div className="mt-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        name="restrictProductAccess"
                        value="true"
                        defaultChecked={editingUser?.restrictProductAccess ?? false}
                      />
                      <span className="text-sm text-app-fg-muted">
                        Restrict access to only assigned products
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section 2.5: Probation (create mode, eligible roles only) */}
        {!isEditMode && selectedRole && isRoleProbationEligible(selectedRole) && (
          <div className="card space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-app-fg">Probation</h2>
              <p className="text-xs text-app-fg-muted mt-1">
                Optional. Probation users carry every permission of their role but can be
                terminated with a complete PII scrub if they don't meet expectations. Admin tier
                roles cannot be on probation.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox name="isProbation" value="true" />
              <span className="text-sm text-app-fg">Place this user on probation</span>
            </label>
            <TextInput
              id="probationUntil"
              name="probationUntil"
              type="date"
              label="Review date (optional)"
              defaultValue={new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              hint="Default is 90 days from today. HR will get a 7-day reminder before this date."
              wrapperClassName="w-full sm:w-64"
            />
          </div>
        )}

        {/* Section 3: Compensation */}
        {showCompensation && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Compensation</h2>

            {/* Mode toggle — always show so user can choose plan vs flat */}
            <RadioGroup
              name="_compensationModeToggle"
              options={[
                { value: 'inline', label: 'Define compensation (flat)' },
                { value: 'existing', label: 'Use existing plan' },
              ]}
              value={compensationMode}
              onChange={(v) => setCompensationMode(v as 'inline' | 'existing')}
              layout="horizontal"
            />

            {/* Existing plan selector — dropdown when plans exist */}
            {compensationMode === 'existing' && filteredPlans.length > 0 && (
              <div>
                <SearchableSelect
                  id="commissionPlanId"
                  label="Commission Plan"
                  value={commissionPlanId}
                  onChange={setCommissionPlanId}
                  placeholder="Select a plan"
                  searchPlaceholder="Search plans..."
                  options={filteredPlans.map((plan: UserCreateCommissionPlan) => ({
                    value: plan.id,
                    label: plan.planName,
                  }))}
                />
              </div>
            )}

            {/* No plans for this role — show Create plan action */}
            {compensationMode === 'existing' && filteredPlans.length === 0 && (
              <div className="rounded-lg bg-app-hover border border-app-border px-4 py-3">
                <p className="text-sm text-app-fg-muted">No commission plans for this role yet.</p>
                <Link
                  to="/hr/payroll?open=plan"
                  className="text-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 mt-2 inline-block"
                >
                  Create plan →
                </Link>
              </div>
            )}

            {/* Inline compensation fields */}
            {compensationMode === 'inline' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Fixed Salary */}
                  <div>
                    <label
                      htmlFor="fixedSalary"
                      className="block text-sm font-medium text-app-fg-muted mb-1.5"
                    >
                      Fixed Salary
                    </label>
                    <AmountInput
                      id="fixedSalary"
                      name="fixedSalary"
                      prefix="NGN"
                      className="input"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Bonus */}
                  <div>
                    <label
                      htmlFor="bonus"
                      className="block text-sm font-medium text-app-fg-muted mb-1.5"
                    >
                      Bonus
                    </label>
                    <AmountInput
                      id="bonus"
                      name="bonus"
                      prefix="NGN"
                      className="input"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <p className="text-xs text-app-fg-muted">
                  Fixed salary, bonus, and flat commission amounts are monthly.
                </p>
              </>
            )}
          </div>
        )}

        {/* Section 4: Contact */}
        {selectedRole && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Contact</h2>
            <div className="sm:w-1/2">
              {/* Visible input is the 10-digit local part. We always submit
                  +234XXXXXXXXXX through a hidden field — keeps the API regex
                  happy regardless of what the user typed. */}
              <TextInput
                id="phone-local"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                label="WhatsApp / Phone Number"
                placeholder="8031234567"
                value={phoneLocal}
                onChange={(e) => {
                  // Strip non-digits, drop a leading 0 if pasted (so 08031234567
                  // becomes 8031234567), then cap at 10.
                  let digits = e.target.value.replace(/\D/g, '');
                  if (digits.startsWith('234')) digits = digits.slice(3);
                  if (digits.startsWith('0')) digits = digits.slice(1);
                  setPhoneLocal(digits.slice(0, 10));
                }}
                leftAddon="+234"
                hint={
                  isEditMode
                    ? undefined
                    : '10 digits, starting with 7, 8, or 9. Must be unique across all staff. Never displayed publicly; masked in all views.'
                }
                error={phoneError}
                required={!isEditMode}
                maxLength={10}
              />
              {/* No "current value" hint anymore — the field is prefilled with
                  the user's existing number, so the editor sees it directly. */}
              <input
                type="hidden"
                name="phone"
                value={phoneIsComplete ? `+234${phoneLocal}` : ''}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
          <Link
            to={isEditMode && editingUser ? `${usersBasePath}/${editingUser.id}` : usersBasePath}
            className="btn-secondary w-full sm:w-auto"
          >
            Cancel
          </Link>
          <Button
            type="submit"
            variant="primary"
            className="w-full sm:w-auto"
            loading={isSubmitting}
            loadingText={isEditMode ? 'Saving...' : 'Creating...'}
            disabled={
              isEditMode
                ? !selectedRole ||
                  (roleNeedsBranch && (selectedBranchIds.length === 0 || !selectedBranchId)) ||
                  // phoneLocal is optional on edit — if non-empty, it must be a complete value
                  (phoneLocal.length > 0 && !phoneIsComplete)
                : !selectedRole ||
                  !phoneIsComplete ||
                  (roleNeedsBranch && (selectedBranchIds.length === 0 || !selectedBranchId))
            }
          >
            {isEditMode ? 'Save changes' : 'Create User'}
          </Button>
        </div>
      </Form>

      {conflictModalOpen && conflictingHead && (
        <Modal
          open
          onClose={() => setConflictModalOpen(false)}
          maxWidth="max-w-md"
          contentClassName="p-6"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-2">
            Confirm a second {formatRole(selectedRole)}?
          </h3>
          <p className="text-sm text-app-fg-muted mb-3">
            {ORG_WIDE_DEPARTMENT_HEAD_ROLES.has(selectedRole) ? (
              <>
                <strong>{conflictingHead.name}</strong> already holds{' '}
                <strong>{formatRole(selectedRole)}</strong> across the organization.
              </>
            ) : (
              <>
                <strong>{conflictingHead.name}</strong> already holds{' '}
                <strong>{formatRole(selectedRole)}</strong> at{' '}
                <strong>{conflictingBranch ? conflictingBranch.name : 'this branch'}</strong>.
              </>
            )}
          </p>
          <p className="text-sm text-app-fg-muted mb-4">
            Yannis allows multiple holders — both will get the role&apos;s notifications and
            visibility. Permissions still control what each person can do. Continue if this is
            intended (e.g. handover, co-heads, regional split). You can also{' '}
            <Link
              to={`${usersBasePath}/${conflictingHead.id}`}
              className="text-brand-500 hover:text-brand-600 underline"
              onClick={() => setConflictModalOpen(false)}
            >
              review {conflictingHead.name}
            </Link>{' '}
            first.
          </p>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConflictModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setConfirmedConflict(true);
                setConflictModalOpen(false);
                // Resubmit the form now that the conflict is acknowledged.
                // The next render's onSubmit lets it through because
                // confirmedConflict === true.
                requestAnimationFrame(() => {
                  if (typeof document !== 'undefined') {
                    const form = document.querySelector<HTMLFormElement>('form[data-branch-scoped-action]');
                    form?.requestSubmit();
                  }
                });
              }}
            >
              Continue anyway
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
