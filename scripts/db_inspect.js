const sqlite3 = require('sqlite3').verbose();
const dbPath = 'c:\\Users\\CyberChris\\Desktop\\projects\\Offline School\\database\\school.db';
const db = new sqlite3.Database(dbPath);

db.all("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
  if (err) {
    console.error('ERROR', err.message);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
