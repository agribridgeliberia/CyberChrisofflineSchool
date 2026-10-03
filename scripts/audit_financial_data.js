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

async function runAudit() {
  console.log('\n========== FINANCIAL DATA AUDIT ==========\n');

  try {
    // Count records
    const studentCount = await query('SELECT COUNT(*) as count FROM students');
    const accountCount = await query('SELECT COUNT(*) as count FROM student_accounts');
    const obligationCount = await query('SELECT COUNT(*) as count FROM student_obligations');
    const paymentCount = await query('SELECT COUNT(*) as count FROM payments WHERE status = "VALID"');
    const expenseCount = await query('SELECT COUNT(*) as count FROM expenses WHERE status = "VALID"');
    const activeStudentCount = await query('SELECT COUNT(*) as count FROM students WHERE status = "Active"');

    console.log('RECORD COUNTS:');
    console.log(`  Students (All):          ${studentCount[0].count}`);
    console.log(`  Students (Active):       ${activeStudentCount[0].count}`);
    console.log(`  Student Accounts:        ${accountCount[0].count}`);
    console.log(`  Student Obligations:     ${obligationCount[0].count}`);
    console.log(`  Valid Payments:          ${paymentCount[0].count}`);
    console.log(`  Valid Expenses:          ${expenseCount[0].count}`);

    // List all students (deleted or inactive)
    console.log('\n--- ALL STUDENTS ---');
    const allStudents = await query('SELECT student_id, full_name, status FROM students');
    if (allStudents.length === 0) {
      console.log('(no students)');
    } else {
      allStudents.forEach(s => console.log(`  ${s.student_id}: ${s.full_name} [${s.status}]`));
    }

    // List all payments with their associated student info
    console.log('\n--- PAYMENTS & ASSOCIATED STUDENTS ---');
    const payments = await query(`
      SELECT 
        p.id, p.receipt_number, p.amount_cents, p.payment_date, p.status,
        sa.student_id, s.full_name, s.status as student_status
      FROM payments p
      LEFT JOIN student_accounts sa ON p.account_id = sa.id
      LEFT JOIN students s ON sa.student_id = s.student_id
      WHERE p.status = 'VALID'
      ORDER BY p.id DESC
    `);
    
    if (payments.length === 0) {
      console.log('(no payments)');
    } else {
      let totalPayments = 0;
      payments.forEach(p => {
        const studentInfo = p.student_id ? `${p.full_name} [${p.student_status}]` : '*** ORPHANED ***';
        console.log(`  Receipt #${p.receipt_number}: L$${(p.amount_cents/100).toFixed(2)} | ${p.payment_date} | ${studentInfo}`);
        totalPayments += p.amount_cents;
      });
      console.log(`  TOTAL: L$${(totalPayments/100).toFixed(2)}`);
    }

    // List all expenses
    console.log('\n--- EXPENSES ---');
    const expenses = await query(`
      SELECT id, category, description, amount_cents, expense_date, status
      FROM expenses
      WHERE status = 'VALID'
      ORDER BY id DESC
    `);
    
    if (expenses.length === 0) {
      console.log('(no expenses)');
    } else {
      let totalExpenses = 0;
      expenses.forEach(e => {
        console.log(`  ${e.category}: L$${(e.amount_cents/100).toFixed(2)} | ${e.expense_date}`);
        totalExpenses += e.amount_cents;
      });
      console.log(`  TOTAL: L$${(totalExpenses/100).toFixed(2)}`);
    }

    // Summary of current obligations
    console.log('\n--- OBLIGATIONS (ACTIVE STUDENTS ONLY) ---');
    const activeObligations = await query(`
      SELECT COALESCE(SUM(so.amount_cents), 0) as total
      FROM student_obligations so
      JOIN student_accounts sa ON so.account_id = sa.id
      JOIN students s ON sa.student_id = s.student_id
      WHERE s.status = 'Active'
    `);
    
    console.log(`  Obligated (Active Students): L$${(activeObligations[0].total/100).toFixed(2)}`);

    // Check for orphaned accounts (student_accounts with no corresponding student)
    console.log('\n--- ORPHANED RECORDS ---');
    const orphanedAccounts = await query(`
      SELECT sa.id, sa.student_id, COUNT(p.id) as payment_count, SUM(p.amount_cents) as total_payments
      FROM student_accounts sa
      LEFT JOIN students s ON sa.student_id = s.student_id
      LEFT JOIN payments p ON p.account_id = sa.id AND p.status = 'VALID'
      WHERE s.student_id IS NULL
      GROUP BY sa.id
    `);
    
    if (orphanedAccounts.length === 0) {
      console.log('  (no orphaned accounts)');
    } else {
      orphanedAccounts.forEach(oa => {
        console.log(`  Account ID ${oa.id}: student_id="${oa.student_id}" | ${oa.payment_count} payments | L$${(oa.total_payments/100).toFixed(2)}`);
      });
    }

    console.log('\n========== END AUDIT ==========\n');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    db.close();
  }
}

runAudit();
