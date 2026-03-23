import type { DocType, DocTypeField, DocTypeState } from '../types/doctype.js';

/**
 * Generate a self-contained HTML list view page from DocType metadata.
 *
 * Renders an HTML table with sortable columns, FTS5 search bar, pagination,
 * and status badges for state fields. Includes a "New" button linking to the
 * form view.
 */
export function generateListView(
  doctype: DocType,
  records: Record<string, unknown>[],
  options?: {
    states?: DocTypeState[];
    fields?: DocTypeField[];
    page?: number;
    pageSize?: number;
    totalCount?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    searchQuery?: string;
    apiBase?: string;
  },
): string {
  const states = options?.states ?? [];
  const fields = options?.fields ?? [];
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 20;
  const totalCount = options?.totalCount ?? records.length;
  const sortField = options?.sortField ?? '';
  const sortDir = options?.sortDir ?? 'asc';
  const searchQuery = options?.searchQuery ?? '';
  const apiBase = options?.apiBase ?? '/api/dt';

  const stateMap = new Map<string, DocTypeState>(states.map((s) => [s.name, s]));

  // Determine visible columns — exclude heavy fields (longtext, table, image)
  const HIDDEN_TYPES = new Set(['longtext', 'table', 'image']);
  const visibleFields = fields
    .filter((f) => !HIDDEN_TYPES.has(f.field_type))
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, 8); // cap columns for readability

  // Derive column names from records if no field metadata provided
  const columnNames: string[] =
    visibleFields.length > 0
      ? visibleFields.map((f) => f.name)
      : records.length > 0
        ? Object.keys(records[0]!)
            .filter((k) => k !== 'id')
            .slice(0, 8)
        : [];

  const columnLabels: Record<string, string> = {};
  for (const f of visibleFields) {
    columnLabels[f.name] = f.label;
  }

  const hasStateField = columnNames.includes('_state');
  if (!hasStateField && states.length > 0) {
    columnNames.push('_state');
    columnLabels['_state'] = 'Status';
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const dtPath = encodeURIComponent(doctype.name.toLowerCase());
  const formBase = `${apiBase}/${dtPath}/new`;
  const listBase = `${apiBase}/${dtPath}`;

  const headerCells = columnNames
    .map((col) => {
      const label = columnLabels[col] ?? col;
      const isSorted = sortField === col;
      const nextDir = isSorted && sortDir === 'asc' ? 'desc' : 'asc';
      const arrow = isSorted ? (sortDir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
      return `<th><a href="#" class="sort-link" data-field="${escapeHtml(col)}" data-dir="${nextDir}">${escapeHtml(label)}${arrow}</a></th>`;
    })
    .join('\n');

  const bodyRows =
    records.length === 0
      ? `<tr><td colspan="${columnNames.length + 1}" class="empty-row">No records found.</td></tr>`
      : records
          .map((row) => {
            const rowId = toStr(row['id']);
            const editUrl = `${apiBase}/${dtPath}/${encodeURIComponent(rowId)}`;
            const cells = columnNames
              .map((col) => {
                const val = row[col];
                if (col === '_state' && states.length > 0) {
                  const stateObj = stateMap.get(toStr(val));
                  if (stateObj) {
                    return `<td><span class="state-badge" style="background:${escapeHtml(stateObj.color)}">${escapeHtml(stateObj.label)}</span></td>`;
                  }
                }
                return `<td>${escapeHtml(toStr(val))}</td>`;
              })
              .join('\n');
            return `<tr class="data-row" data-id="${escapeHtml(rowId)}">
  ${cells}
  <td class="action-cell"><a href="${escapeHtml(editUrl)}" class="btn btn-sm">Edit</a></td>
</tr>`;
          })
          .join('\n');

  // Pagination links
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  const paginationInfo = `Showing ${start}–${end} of ${totalCount}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(doctype.label_plural)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <header class="list-header">
      <h1>${escapeHtml(doctype.label_plural)}</h1>
      <a href="${escapeHtml(formBase)}" class="btn btn-primary">+ New ${escapeHtml(doctype.label_singular)}</a>
    </header>

    <div class="toolbar">
      <form id="search-form" class="search-form" method="get" action="${escapeHtml(listBase)}">
        <input
          type="search"
          id="search-input"
          name="q"
          class="search-input"
          placeholder="Search ${escapeHtml(doctype.label_plural)}…"
          value="${escapeHtml(searchQuery)}"
          autocomplete="off"
        />
        <button type="submit" class="btn btn-secondary">Search</button>
        ${searchQuery ? `<a href="${escapeHtml(listBase)}" class="btn btn-ghost">Clear</a>` : ''}
        <input type="hidden" name="sort" value="${escapeHtml(sortField)}" />
        <input type="hidden" name="dir" value="${escapeHtml(sortDir)}" />
      </form>
    </div>

    <div class="table-wrapper">
      <table class="list-table">
        <thead>
          <tr>
            ${headerCells}
            <th class="action-col"></th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <span class="pagination-info">${paginationInfo}</span>
      <div class="pagination-controls">
        ${prevDisabled ? `<span class="btn btn-ghost disabled">&laquo; Prev</span>` : `<a href="${escapeHtml(listBase)}?page=${page - 1}&q=${encodeURIComponent(searchQuery)}&sort=${encodeURIComponent(sortField)}&dir=${sortDir}" class="btn btn-ghost">&laquo; Prev</a>`}
        <span class="page-indicator">Page ${page} / ${totalPages}</span>
        ${nextDisabled ? `<span class="btn btn-ghost disabled">Next &raquo;</span>` : `<a href="${escapeHtml(listBase)}?page=${page + 1}&q=${encodeURIComponent(searchQuery)}&sort=${encodeURIComponent(sortField)}&dir=${sortDir}" class="btn btn-ghost">Next &raquo;</a>`}
      </div>
    </div>
  </div>

  <script>
  (function() {
    var listBase = ${JSON.stringify(listBase)};
    var currentSort = ${JSON.stringify(sortField)};
    var currentDir = ${JSON.stringify(sortDir)};
    var currentSearch = ${JSON.stringify(searchQuery)};

    // Sort links
    document.querySelectorAll('.sort-link').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        var field = link.getAttribute('data-field');
        var dir = link.getAttribute('data-dir');
        var url = listBase + '?sort=' + encodeURIComponent(field) + '&dir=' + encodeURIComponent(dir);
        if (currentSearch) url += '&q=' + encodeURIComponent(currentSearch);
        window.location.href = url;
      });
    });

    // Row click → edit (exclude action-cell clicks)
    document.querySelectorAll('.data-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        if (e.target.closest('.action-cell')) return;
        var id = row.getAttribute('data-id');
        if (id) window.location.href = listBase + '/' + encodeURIComponent(id);
      });
    });
  })();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStr(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Embedded CSS
// ---------------------------------------------------------------------------

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; line-height: 1.5; }
  .container { max-width: 1100px; margin: 2rem auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 2rem; }
  .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
  h1 { font-size: 1.5rem; font-weight: 600; }
  .toolbar { margin-bottom: 1rem; }
  .search-form { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .search-input { flex: 1; min-width: 200px; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.9375rem; }
  .search-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  .table-wrapper { overflow-x: auto; }
  .list-table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
  .list-table thead th { background: #f9fafb; padding: 0.625rem 0.75rem; text-align: left; font-weight: 600; font-size: 0.8125rem; color: #6b7280; border-bottom: 2px solid #e5e7eb; white-space: nowrap; }
  .sort-link { color: inherit; text-decoration: none; }
  .sort-link:hover { color: #3b82f6; }
  .list-table tbody tr { border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background 0.1s; }
  .list-table tbody tr:hover { background: #f9fafb; }
  .list-table tbody td { padding: 0.625rem 0.75rem; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-row { text-align: center; color: #9ca3af; font-style: italic; padding: 2rem 0; cursor: default; }
  .action-col { width: 80px; }
  .action-cell { text-align: right; }
  .state-badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; color: #fff; font-size: 0.75rem; font-weight: 500; }
  .pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; flex-wrap: wrap; gap: 0.5rem; }
  .pagination-info { color: #6b7280; font-size: 0.875rem; }
  .pagination-controls { display: flex; align-items: center; gap: 0.5rem; }
  .page-indicator { font-size: 0.875rem; color: #374151; }
  .btn { display: inline-block; padding: 0.5rem 1.25rem; border-radius: 6px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; text-decoration: none; text-align: center; border: none; transition: background 0.15s; }
  .btn-primary { background: #3b82f6; color: #fff; }
  .btn-primary:hover { background: #2563eb; }
  .btn-secondary { background: #e5e7eb; color: #374151; }
  .btn-secondary:hover { background: #d1d5db; }
  .btn-ghost { background: transparent; color: #374151; border: 1px solid #d1d5db; }
  .btn-ghost:hover:not(.disabled) { background: #f3f4f6; }
  .btn-ghost.disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  .btn-sm { padding: 0.25rem 0.75rem; font-size: 0.8125rem; }
  @media (max-width: 640px) { .container { margin: 1rem; padding: 1rem; } .list-header { flex-direction: column; align-items: flex-start; gap: 0.75rem; } }
`;
