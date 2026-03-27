/**
 * Page skeleton for Live Activities (/admin/cs/queue) and legacy CS dashboard layout.
 * Mirrors the layout of CSDashboardPage so the loading state matches the final UI.
 */
export function CSOverviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Page header */}
      <div>
        <div className="h-8 w-48 rounded bg-surface-200 dark:bg-surface-700" />
        <div className="h-4 w-80 rounded bg-surface-100 dark:bg-surface-800 mt-2" />
      </div>

      {/* Overview stat strip card */}
      <div className="card">
        <div className="flex flex-nowrap gap-3 overflow-x-auto scrollbar-hide pb-1">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-100 dark:bg-surface-800"
            >
              <div className="h-3 w-14 mx-auto rounded bg-surface-200 dark:bg-surface-700" />
              <div className="h-6 w-8 mx-auto rounded bg-surface-200 dark:bg-surface-700 mt-2" />
            </div>
          ))}
        </div>
      </div>

      {/* Live carts card */}
      <div className="card">
        <div className="h-4 w-36 rounded bg-surface-200 dark:bg-surface-700 mb-2" />
        <div className="h-3 w-full max-w-md rounded bg-surface-100 dark:bg-surface-800 mb-3" />
        <div className="min-h-[15rem] flex flex-col">
          <div className="overflow-x-auto -mx-4 px-4 flex-1 min-h-0">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="h-10">
                  <th className="table-header text-left">
                    <div className="h-3 w-16 rounded bg-surface-200 dark:bg-surface-700" />
                  </th>
                  <th className="table-header text-left">
                    <div className="h-3 w-12 rounded bg-surface-200 dark:bg-surface-700" />
                  </th>
                  <th className="table-header text-left">
                    <div className="h-3 w-14 rounded bg-surface-200 dark:bg-surface-700" />
                  </th>
                  <th className="table-header text-left">
                    <div className="h-3 w-16 rounded bg-surface-200 dark:bg-surface-700" />
                  </th>
                  <th className="table-header text-left">
                    <div className="h-3 w-20 rounded bg-surface-200 dark:bg-surface-700" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="h-10">
                    <td className="table-cell">
                      <div className="h-3 w-24 rounded bg-surface-100 dark:bg-surface-800" />
                    </td>
                    <td className="table-cell">
                      <div className="h-3 w-20 rounded bg-surface-100 dark:bg-surface-800" />
                    </td>
                    <td className="table-cell">
                      <div className="h-3 w-28 rounded bg-surface-100 dark:bg-surface-800" />
                    </td>
                    <td className="table-cell">
                      <div className="h-3 w-16 rounded bg-surface-100 dark:bg-surface-800" />
                    </td>
                    <td className="table-cell">
                      <div className="h-3 w-24 rounded bg-surface-100 dark:bg-surface-800" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-surface-100 dark:border-surface-800 shrink-0">
            <div className="h-3 w-32 rounded bg-surface-100 dark:bg-surface-800" />
            <div className="flex gap-1">
              <div className="h-8 w-12 rounded bg-surface-100 dark:bg-surface-800" />
              <div className="h-8 w-12 rounded bg-surface-100 dark:bg-surface-800" />
            </div>
          </div>
        </div>
      </div>

      {/* Agent Workloads section */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="h-5 w-36 rounded bg-surface-200 dark:bg-surface-700" />
          <div className="flex gap-2">
            <div className="h-9 w-9 rounded-lg bg-surface-100 dark:bg-surface-800" />
            <div className="h-9 w-9 rounded-lg bg-surface-100 dark:bg-surface-800" />
            <div className="h-8 w-16 rounded bg-surface-100 dark:bg-surface-800" />
          </div>
        </div>
        <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card shrink-0 w-64 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-surface-200 dark:bg-surface-700 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="h-4 w-24 rounded bg-surface-200 dark:bg-surface-700" />
                  <div className="h-3 w-20 rounded bg-surface-100 dark:bg-surface-800" />
                </div>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-100 dark:bg-surface-800" />
              <div className="h-3 w-16 rounded bg-surface-100 dark:bg-surface-800" />
            </div>
          ))}
        </div>
      </div>

      {/* Tabs row + Redistribute button */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-200 dark:border-surface-700 pb-0">
        <div className="flex gap-1 flex-1 min-w-0">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-9 w-24 rounded-t bg-surface-100 dark:bg-surface-800 shrink-0"
            />
          ))}
        </div>
        <div className="h-8 w-24 rounded bg-surface-100 dark:bg-surface-800 shrink-0 -mb-px" />
      </div>

      {/* Tab content: table card */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">
                  <div className="h-3 w-16 rounded bg-surface-200 dark:bg-surface-700" />
                </th>
                <th className="table-header">
                  <div className="h-3 w-20 rounded bg-surface-200 dark:bg-surface-700" />
                </th>
                <th className="table-header">
                  <div className="h-3 w-14 rounded bg-surface-200 dark:bg-surface-700" />
                </th>
                <th className="table-header">
                  <div className="h-3 w-16 rounded bg-surface-200 dark:bg-surface-700" />
                </th>
                <th className="table-header">
                  <div className="h-3 w-20 rounded bg-surface-200 dark:bg-surface-700" />
                </th>
                <th className="table-header">
                  <div className="h-3 w-20 rounded bg-surface-200 dark:bg-surface-700" />
                </th>
                <th className="table-header">
                  <div className="h-3 w-20 rounded bg-surface-200 dark:bg-surface-700" />
                </th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="table-row">
                  <td className="table-cell">
                    <div className="h-3 w-20 rounded bg-surface-100 dark:bg-surface-800" />
                  </td>
                  <td className="table-cell">
                    <div className="h-3 w-24 rounded bg-surface-100 dark:bg-surface-800" />
                  </td>
                  <td className="table-cell">
                    <div className="h-3 w-16 rounded bg-surface-100 dark:bg-surface-800" />
                  </td>
                  <td className="table-cell">
                    <div className="h-3 w-20 rounded bg-surface-100 dark:bg-surface-800" />
                  </td>
                  <td className="table-cell">
                    <div className="h-3 w-24 rounded bg-surface-100 dark:bg-surface-800" />
                  </td>
                  <td className="table-cell">
                    <div className="h-3 w-24 rounded bg-surface-100 dark:bg-surface-800" />
                  </td>
                  <td className="table-cell">
                    <div className="h-6 w-16 rounded bg-surface-100 dark:bg-surface-800" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
