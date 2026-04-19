const db = require('better-sqlite3')('database/webgis.db');
const rows = db.prepare("SELECT * FROM purchases WHERE store_name LIKE '%天安数码城%' AND status = 'active'").all();
console.log('Found purchases:', rows.length);
console.log(JSON.stringify(rows, null, 2));
