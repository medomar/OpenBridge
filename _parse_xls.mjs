import XLSX from 'xlsx';

const filePath = '/Users/sayadimohamedomar/Desktop/AI-Bridge/OpenBridge/.openbridge/media/1772920977196-624de47c-5d32-481b-806e-27c38ce90390.xls';

const workbook = XLSX.readFile(filePath);

console.log('=== FILE STRUCTURE ===');
console.log('Sheet count:', workbook.SheetNames.length);
console.log('Sheet names:', workbook.SheetNames);
console.log('');

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`SHEET: "${sheetName}"`);
  console.log(`Range: ${sheet['!ref']}`);
  console.log(`Rows: ${range.e.r - range.s.r + 1} (from ${range.s.r} to ${range.e.r})`);
  console.log(`Columns: ${range.e.c - range.s.c + 1} (from ${XLSX.utils.encode_col(range.s.c)} to ${XLSX.utils.encode_col(range.e.c)})`);

  // Get merged cells
  if (sheet['!merges'] && sheet['!merges'].length > 0) {
    console.log(`\nMerged cells (${sheet['!merges'].length}):`);
    for (const merge of sheet['!merges']) {
      console.log(`  ${XLSX.utils.encode_range(merge)}`);
    }
  }

  // Convert to JSON (all rows)
  const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  console.log(`\nTotal rows in data: ${jsonData.length}`);

  // Print ALL rows (raw cell data)
  console.log('\n--- ALL DATA (row by row) ---');
  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i];
    // Skip completely empty rows
    const hasData = row.some(cell => cell !== '' && cell !== null && cell !== undefined);
    if (hasData) {
      console.log(`Row ${i}: ${JSON.stringify(row)}`);
    }
  }

  // Also output with headers for easier reading
  const jsonWithHeaders = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (jsonWithHeaders.length > 0) {
    console.log('\n--- DATA AS OBJECTS (with detected headers) ---');
    const headers = Object.keys(jsonWithHeaders[0]);
    console.log('Detected headers:', JSON.stringify(headers));
    console.log(`Data rows (excluding header): ${jsonWithHeaders.length}`);

    for (let i = 0; i < jsonWithHeaders.length; i++) {
      console.log(`Row ${i + 1}:`, JSON.stringify(jsonWithHeaders[i]));
    }
  }

  // Raw cell inspection for first 5 rows to understand data types
  console.log('\n--- RAW CELL TYPES (first 10 data rows) ---');
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellRef];
      if (cell) {
        console.log(`  ${cellRef}: type=${cell.t}, value=${JSON.stringify(cell.v)}, formatted=${JSON.stringify(cell.w)}`);
      }
    }
  }

  // Column statistics
  console.log('\n--- COLUMN ANALYSIS ---');
  if (jsonData.length > 1) {
    const headerRow = jsonData[0];
    for (let c = 0; c < headerRow.length; c++) {
      const colName = headerRow[c] || `Col_${c}`;
      const values = jsonData.slice(1).map(row => row[c]).filter(v => v !== '' && v !== null && v !== undefined);
      const numericValues = values.filter(v => typeof v === 'number');

      let analysis = `  Column "${colName}": ${values.length} non-empty values`;
      if (numericValues.length > 0) {
        const sum = numericValues.reduce((a, b) => a + b, 0);
        const min = Math.min(...numericValues);
        const max = Math.max(...numericValues);
        analysis += ` | Numeric: min=${min}, max=${max}, sum=${sum.toFixed(2)}, avg=${(sum/numericValues.length).toFixed(2)}`;
      }
      const uniqueTypes = [...new Set(values.map(v => typeof v))];
      analysis += ` | Types: ${uniqueTypes.join(', ')}`;
      console.log(analysis);
    }
  }
}

// Final summary
console.log('\n\n=== COMPLETE CSV OUTPUT (for readability) ===');
for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  console.log(`\n--- Sheet: "${sheetName}" ---`);
  const csv = XLSX.utils.sheet_to_csv(sheet);
  console.log(csv);
}
