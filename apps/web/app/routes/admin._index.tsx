/**
 * /admin — Dashboard overview page
 */
export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Welcome back. Here&apos;s an overview of your business.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatCard
          label="Total Orders"
          value="0"
          change="+0%"
          changeType="neutral"
        />
        <StatCard
          label="Revenue"
          value="$0.00"
          change="+0%"
          changeType="neutral"
        />
        <StatCard
          label="Active Products"
          value="0"
          change="+0%"
          changeType="neutral"
        />
        <StatCard
          label="Pending CS"
          value="0"
          change="+0%"
          changeType="neutral"
        />
      </div>

      {/* Placeholder sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
            Recent Orders
          </h2>
          <div className="flex items-center justify-center h-40 text-surface-400 dark:text-surface-500 text-sm">
            No orders yet
          </div>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
            Revenue Overview
          </h2>
          <div className="flex items-center justify-center h-40 text-surface-400 dark:text-surface-500 text-sm">
            No revenue data yet
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  change,
  changeType,
}: {
  label: string;
  value: string;
  change: string;
  changeType: 'up' | 'down' | 'neutral';
}) {
  const changeColor = {
    up: 'text-success-600 dark:text-success-500',
    down: 'text-danger-600 dark:text-danger-500',
    neutral: 'text-surface-400',
  }[changeType];

  return (
    <div className="card">
      <p className="text-sm font-medium text-surface-500 dark:text-surface-400">{label}</p>
      <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{value}</p>
      <p className={`text-xs mt-2 ${changeColor}`}>{change} from last period</p>
    </div>
  );
}
