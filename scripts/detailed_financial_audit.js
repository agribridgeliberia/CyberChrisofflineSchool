const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'school.db');
const db = new sqlite3.Database(dbPath);

async function query(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function detailedAudit() {
  console.log('\n========== DETAILED FINANCIAL RELATIONSHIP AUDIT ==========\n');

  try {
    // Check how the current calculateFinancialStatistics queries work
    console.log('--- CURRENT QUERY RESULTS ---\n');
    
    const obligated = await query(`
      SELECT COALESCE(SUM(so.amount_cents), 0) AS total_obligated
      FROM student_obligations so
      JOIN student_accounts sa ON so.account_id = sa.id
      JOIN students s ON sa.student_id = s.student_id
      WHERE s.status = 'Active'
    `);
    
    const collected = await query(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_collected
      FROM payments
      WHERE status = 'VALID'
    `);
    
    const expenditure = await query(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_expenditure
      FROM expenses
      WHERE status = 'VALID'
    `);
    
    console.log(`Obligated (from ACTIVE students only): L$${(obligated[0].total_obligated/100).toFixed(2)}`);
    console.log(`Collected (all VALID payments, ANY student): L$${(collected[0].total_collected/100).toFixed(2)}`);
    console.log(`Expenditure (all VALID expenses): L$${(expenditure[0].total_expenditure/100).toFixed(2)}`);
    
    // What if we filter Collected to only ACTIVE students?
    console.log('\n--- IF WE FILTER COLLECTED TO ACTIVE STUDENTS ONLY ---\n');
    
    const collectedActiveOnly = await query(`
      SELECT COALESCE(SUM(p.amount_cents), 0) AS total_collected
      FROM payments p
      JOIN student_accounts sa ON p.account_id = sa.id
      JOIN students s ON sa.student_id = s.student_id
      WHERE p.status = 'VALID' AND s.status = 'Active'
    `);
    
    console.log(`Collected (from ACTIVE students only): L$${(collectedActiveOnly[0].total_collected/100).toFixed(2)}`);
    
    // What if we exclude expenses entirely when no active students?
    console.log('\n--- IF WE SHOW ONLY CURRENT-STUDENT FINANCIAL POSITION ---\n');
    
    const activeStudentCount = await query(`SELECT COUNT(*) as count FROM students WHERE status = 'Active'`);
    const countActive = activeStudentCount[0].count;
    
    if (countActive === 0) {
      console.log('NO ACTIVE STUDENTS - Showing only current position:');
      console.log(`  Obligated: L$0.00`);
      console.log(`  Collected (from current students): L$0.00`);
      console.log(`  Expenditure (from current operations): L$0.00`);
      console.log(`  Outstanding: L$0.00`);
      console.log(`  Net Balance: L$0.00`);
    } else {
      const currentObligation = obligated[0].total_obligated;
      const currentCollected = collectedActiveOnly[0].total_collected;
      const currentExpenditure = expenditure[0].total_expenditure;
      console.log(`Active Students: ${countActive}`);
      console.log(`  Obligated: L$${(currentObligation/100).toFixed(2)}`);
      console.log(`  Collected (from current students): L$${(currentCollected/100).toFixed(2)}`);
      console.log(`  Expenditure: L$${(currentExpenditure/100).toFixed(2)}`);
      console.log(`  Outstanding: L$${((currentObligation - currentCollected)/100).toFixed(2)}`);
      console.log(`  Net Balance: L$${((currentCollected - currentExpenditure)/100).toFixed(2)}`);
    }
    
    // Show orphaned payments detail
    console.log('\n--- ORPHANED PAYMENTS DETAIL ---\n');
    
    const orphanedPayments = await query(`
      SELECT p.id, p.receipt_number, p.amount_cents, p.payment_date, sa.student_id
      FROM payments p
      JOIN student_accounts sa ON p.account_id = sa.id
      LEFT JOIN students s ON sa.student_id = s.student_id
      WHERE p.status = 'VALID' AND s.student_id IS NULL
      ORDER BY p.payment_date DESC
    `);
    
    let orphanedTotal = 0;
    orphanedPayments.forEach(p => {
      console.log(`  ${p.receipt_number}: L$${(p.amount_cents/100).toFixed(2)} | ${p.payment_date} | from deleted student ${p.student_id}`);
      orphanedTotal += p.amount_cents;
    });
    console.log(`  TOTAL ORPHANED PAYMENTS: L$${(orphanedTotal/100).toFixed(2)}`);
    
    // Show relationship overview
    console.log('\n--- PAYMENT-TO-STUDENT RELATIONSHIP ---\n');
    console.log('student_accounts has a foreign key: FOREIGN KEY (student_id) REFERENCES students(student_id)');
    console.log('But when students were hard-deleted, the text student_id remained in student_accounts');
    console.log('Now we have payment records pointing to orphaned student_accounts');
    console.log('These payments can never be linked back to active students\n');
    
    console.log('========== END AUDIT ==========\n');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    db.close();
  }
}

detailedAudit();
