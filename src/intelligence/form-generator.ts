import type { DocType, DocTypeField, DocTypeState, DocTypeTransition } from '../types/doctype.js';

/**
 * Generate a self-contained HTML form page from DocType metadata.
 *
 * Maps each field type to the appropriate HTML input element and includes
 * state machine action buttons when states/transitions are provided.
 */
export function generateForm(
  doctype: DocType,
  fields: DocTypeField[],
  options?: {
    record?: Record<string, unknown>;
    states?: DocTypeState[];
    transitions?: DocTypeTransition[];
    currentState?: string;
    apiBase?: string;
  },
): string {
  const record = options?.record;
  const states = options?.states ?? [];
  const transitions = options?.transitions ?? [];
  const currentState = options?.currentState ?? (record?.['_state'] as string | undefined);
  const apiBase = options?.apiBase ?? '/api/dt';
  const isEdit = record != null && record['id'] != null;
  const recordId = isEdit ? String(record['id']) : '';
  const title = isEdit ? `Edit ${doctype.label_singular}` : `New ${doctype.label_singular}`;

  // Find available transitions from current state
  const availableTransitions = currentState
    ? transitions.filter((t) => t.from_state === currentState)
    : [];

  // Find the state object for badge display
  const stateObj = currentState ? states.find((s) => s.name === currentState) : undefined;

  const fieldHtml = fields
    .filter((f) => f.formula == null) // Skip GENERATED columns
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f) => renderField(f, record))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <header class="form-header">
      <div class="header-left">
        <a href="${escapeHtml(apiBase)}/${encodeURIComponent(doctype.name.toLowerCase())}" class="back-link">&larr; ${escapeHtml(doctype.label_plural)}</a>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="header-right">
        ${stateObj ? `<span class="state-badge" style="background:${escapeHtml(stateObj.color)}">${escapeHtml(stateObj.label)}</span>` : ''}
      </div>
    </header>

    ${
      availableTransitions.length > 0
        ? `<div class="action-bar">${availableTransitions
            .map(
              (t) =>
                `<button type="button" class="btn btn-action" data-action="${escapeHtml(t.action_name)}" data-to-state="${escapeHtml(t.to_state)}">${escapeHtml(t.action_label)}</button>`,
            )
            .join('\n')}</div>`
        : ''
    }

    <form id="doctype-form" class="doctype-form">
      ${fieldHtml}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create'}</button>
        <a href="${escapeHtml(apiBase)}/${encodeURIComponent(doctype.name.toLowerCase())}" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  </div>

  <script>
  (function() {
    var form = document.getElementById('doctype-form');
    var apiBase = ${JSON.stringify(apiBase)};
    var doctypeName = ${JSON.stringify(doctype.name.toLowerCase())};
    var recordId = ${JSON.stringify(recordId)};
    var isEdit = ${JSON.stringify(isEdit)};

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var data = {};
      var formData = new FormData(form);
      formData.forEach(function(value, key) {
        var input = form.elements[key];
        if (input && input.type === 'number') {
          data[key] = value === '' ? null : Number(value);
        } else if (input && input.type === 'checkbox') {
          // handled below
        } else {
          data[key] = value === '' ? null : value;
        }
      });
      // Checkboxes not in FormData when unchecked
      var checkboxes = form.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(function(cb) {
        data[cb.name] = cb.checked ? 1 : 0;
      });

      var url = apiBase + '/' + encodeURIComponent(doctypeName);
      var method = 'POST';
      if (isEdit) {
        url += '/' + encodeURIComponent(recordId);
        method = 'PUT';
      }
      fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, json: j }; }); })
      .then(function(res) {
        if (res.ok) {
          window.location.href = apiBase + '/' + encodeURIComponent(doctypeName);
        } else {
          alert('Error: ' + (res.json.error || 'Unknown error'));
        }
      })
      .catch(function(err) { alert('Request failed: ' + err.message); });
    });

    // State transition buttons
    document.querySelectorAll('.btn-action').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (!isEdit) return;
        var toState = btn.getAttribute('data-to-state');
        var actionName = btn.getAttribute('data-action');
        if (!confirm('Transition to "' + toState + '" via "' + actionName + '"?')) return;
        var url = apiBase + '/' + encodeURIComponent(doctypeName) + '/' + encodeURIComponent(recordId);
        fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _state: toState })
        })
        .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, json: j }; }); })
        .then(function(res) {
          if (res.ok) { window.location.reload(); }
          else { alert('Error: ' + (res.json.error || 'Transition failed')); }
        })
        .catch(function(err) { alert('Request failed: ' + err.message); });
      });
    });
  })();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Field renderers
// ---------------------------------------------------------------------------

function toStr(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val);
}

function renderField(field: DocTypeField, record?: Record<string, unknown>): string {
  const value = record?.[field.name];
  const val = toStr(value || field.default_value);
  const required = field.required ? 'required' : '';
  const requiredMark = field.required ? '<span class="required">*</span>' : '';
  const id = `field-${field.name}`;

  switch (field.field_type) {
    case 'text':
    case 'phone':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="text" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(val)}" ${required} />`,
      );

    case 'email':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="email" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(val)}" ${required} />`,
      );

    case 'url':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="url" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(val)}" ${required} />`,
      );

    case 'number':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="number" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(val)}" ${required} />`,
      );

    case 'currency':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="number" id="${id}" name="${escapeHtml(field.name)}" step="0.01" value="${escapeHtml(val)}" ${required} />`,
      );

    case 'date':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="date" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(val)}" ${required} />`,
      );

    case 'datetime':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="datetime-local" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(val)}" ${required} />`,
      );

    case 'longtext':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<textarea id="${id}" name="${escapeHtml(field.name)}" rows="4" ${required}>${escapeHtml(val)}</textarea>`,
      );

    case 'checkbox':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="checkbox" id="${id}" name="${escapeHtml(field.name)}" ${value ? 'checked' : ''} />`,
        'checkbox-field',
      );

    case 'select':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        renderSelect(id, field.name, field.options ?? [], val, required),
      );

    case 'multiselect':
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        renderSelect(id, field.name, field.options ?? [], val, required, true),
      );

    case 'link': {
      const linkVal = toStr(value);
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="text" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(linkVal)}" placeholder="Enter ${escapeHtml(field.link_doctype ?? 'linked')} ID" ${required} />` +
          (field.link_doctype
            ? `<small class="help-text">Links to ${escapeHtml(field.link_doctype)}</small>`
            : ''),
      );
    }

    case 'image': {
      const imgVal = toStr(value);
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="url" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(imgVal)}" placeholder="Image URL" ${required} />` +
          (imgVal ? `<img src="${escapeHtml(imgVal)}" alt="" class="image-preview" />` : ''),
      );
    }

    case 'table':
      return renderTableField(field, record);

    default: {
      const defVal = toStr(value);
      return fieldWrapper(
        id,
        field.label,
        requiredMark,
        `<input type="text" id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(defVal)}" ${required} />`,
      );
    }
  }
}

function fieldWrapper(
  id: string,
  label: string,
  requiredMark: string,
  inputHtml: string,
  extraClass?: string,
): string {
  return `<div class="form-group${extraClass ? ' ' + extraClass : ''}">
  <label for="${id}">${escapeHtml(label)}${requiredMark}</label>
  ${inputHtml}
</div>`;
}

function renderSelect(
  id: string,
  name: string,
  options: string[],
  selectedValue: string,
  required: string,
  multiple?: boolean,
): string {
  const optionHtml = options
    .map(
      (opt) =>
        `<option value="${escapeHtml(opt)}"${opt === selectedValue ? ' selected' : ''}>${escapeHtml(opt)}</option>`,
    )
    .join('\n');
  return `<select id="${id}" name="${escapeHtml(name)}" ${required} ${multiple ? 'multiple' : ''}>
  <option value="">-- Select --</option>
  ${optionHtml}
</select>`;
}

function renderTableField(field: DocTypeField, record?: Record<string, unknown>): string {
  const rows = (record?.[field.name] as Record<string, unknown>[] | undefined) ?? [];
  const childDoctype = field.child_doctype ?? field.name;

  // Render existing rows as a simple inline table
  let tableBody = '';
  if (rows.length > 0) {
    const columns = Object.keys(rows[0]!).filter(
      (k) => k !== 'id' && k !== 'parent_id' && k !== 'idx',
    );
    const headerRow = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const bodyRows = rows
      .map(
        (row, idx) =>
          `<tr>${columns.map((c) => `<td><input type="text" name="${escapeHtml(field.name)}[${idx}][${escapeHtml(c)}]" value="${escapeHtml(toStr(row[c]))}" /></td>`).join('')}<td><button type="button" class="btn-remove" onclick="this.closest('tr').remove()">&times;</button></td></tr>`,
      )
      .join('\n');

    tableBody = `<table class="child-table">
  <thead><tr>${headerRow}<th></th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table>`;
  }

  return `<div class="form-group table-field">
  <label>${escapeHtml(field.label)}</label>
  <small class="help-text">Child DocType: ${escapeHtml(childDoctype)}</small>
  ${tableBody || '<p class="empty-table">No rows yet.</p>'}
</div>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  .container { max-width: 720px; margin: 2rem auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 2rem; }
  .form-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
  .header-left { display: flex; flex-direction: column; gap: 0.25rem; }
  .back-link { color: #666; text-decoration: none; font-size: 0.875rem; }
  .back-link:hover { color: #333; }
  h1 { font-size: 1.5rem; font-weight: 600; }
  .state-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; color: #fff; font-size: 0.8rem; font-weight: 500; }
  .action-bar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; padding: 0.75rem; background: #f9f9f9; border-radius: 6px; border: 1px solid #e0e0e0; }
  .doctype-form { display: flex; flex-direction: column; gap: 1.25rem; }
  .form-group { display: flex; flex-direction: column; gap: 0.375rem; }
  .form-group label { font-weight: 500; font-size: 0.875rem; color: #555; }
  .required { color: #e53e3e; margin-left: 2px; }
  input[type="text"], input[type="email"], input[type="url"], input[type="number"],
  input[type="date"], input[type="datetime-local"], select, textarea {
    padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.9375rem;
    transition: border-color 0.15s; width: 100%;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  .checkbox-field { flex-direction: row; align-items: center; gap: 0.5rem; }
  .checkbox-field input[type="checkbox"] { width: 1.125rem; height: 1.125rem; }
  .help-text { color: #888; font-size: 0.8rem; }
  .image-preview { max-width: 200px; max-height: 120px; margin-top: 0.5rem; border-radius: 4px; }
  .child-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  .child-table th { background: #f3f4f6; padding: 0.375rem 0.5rem; text-align: left; font-size: 0.8rem; font-weight: 500; border-bottom: 1px solid #e5e7eb; }
  .child-table td { padding: 0.25rem 0.5rem; border-bottom: 1px solid #f0f0f0; }
  .child-table input { padding: 0.25rem 0.5rem; font-size: 0.85rem; border: 1px solid #e5e7eb; border-radius: 4px; }
  .btn-remove { background: none; border: none; color: #e53e3e; cursor: pointer; font-size: 1.1rem; }
  .empty-table { color: #999; font-size: 0.875rem; font-style: italic; }
  .table-field { border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; }
  .form-actions { display: flex; gap: 0.75rem; margin-top: 0.5rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
  .btn { display: inline-block; padding: 0.5rem 1.25rem; border-radius: 6px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; text-decoration: none; text-align: center; border: none; transition: background 0.15s; }
  .btn-primary { background: #3b82f6; color: #fff; }
  .btn-primary:hover { background: #2563eb; }
  .btn-secondary { background: #e5e7eb; color: #374151; }
  .btn-secondary:hover { background: #d1d5db; }
  .btn-action { background: #10b981; color: #fff; }
  .btn-action:hover { background: #059669; }
  @media (max-width: 640px) { .container { margin: 1rem; padding: 1rem; } }
`;
