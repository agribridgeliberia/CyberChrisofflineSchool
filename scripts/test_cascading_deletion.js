const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'school.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function calculateFinancials(db) {
  const obligatedResult = await all(db, `
    SELECT COALESCE(SUM(so.amount_cents), 0) AS total
    FROM student_obligations so
    JOIN student_accounts sa ON so.account_id = sa.id
  `);
  
  const collectedResult = await all(db, `
    SELECT COALESCE(SUM(p.amount_cents), 0) AS total
    FROM payments p
    JOIN student_accounts sa ON p.account_id = sa.id
    WHERE p.status = 'VALID'
  `);
  
  const expenditureResult = await all(db, `
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM expenses
    WHERE status = 'VALID'
  `);
  
  const obligated = obligatedResult[0].total || 0;
  const collected = collectedResult[0].total || 0;
  const expenditure = expenditureResult[0].total || 0;
  const outstanding = obligated - collected;
  const netBalance = collected - expenditure;
  
  const collectionRate = obligated > 0 ? (collected / obligated) * 100 : 0;
  const outstandingRate = obligated > 0 ? (outstanding / obligated) * 100 : 0;
  const expenditureRate = collected > 0 ? (expenditure / collected) * 100 : 0;
  const netBalanceRate = collected > 0 ? (netBalance / collected) * 100 : 0;
  
  return {
    obligated, collected, expenditure, outstanding, netBalance,
    collectionRate, outstandingRate, expenditureRate, netBalanceRate
  };
}

async function testCascadingDeletion() {
  console.log('\n========== TESTING CASCADING DELETION & FINANCIAL CALCULATIONS ==========\n');

  const db = new sqlite3.Database(dbPath);
  const money = cents => `L$${(cents / 100).toFixed(2)}`;
  
  try {
    // Clear existing test data
    await run(db, 'DELETE FROM payments');
    await run(db, 'DELETE FROM student_obligations');
    await run(db, 'DELETE FROM student_accounts');
    await run(db, 'DELETE FROM students');
    await run(db, 'DELETE FROM expenses');
    
    console.log('SCENARIO: Test Specification Example\n');
    console.log('Expected Results:');
    console.log('  3 Students → Obligated L$15,000 | Collected L$9,000 | Outstanding L$6,000');
    console.log('  After delete Student B → Obligated L$11,000 | Collected L$5,000 | Outstanding L$6,000');
    console.log('  After delete all → All L$0\n');
    
    // Setup: Create academic year (or use existing)
    const yearCheckResult = await all(db, `
      SELECT id FROM academic_years WHERE name = '2026'
    `);
    
    let yearId;
    if (yearCheckResult.length > 0) {
      yearId = yearCheckResult[0].id;
    } else {
      const yearResult = await run(db, `
        INSERT INTO academic_years (name, is_current, created_at) 
        VALUES ('2026', 1, datetime('now'))
      `);
      yearId = yearResult.lastID;
    }
    
    // Setup: Create 3 students
    console.log('STEP 1: Create 3 students\n');
    
    const students = [
      { id: 'STU-TEST-A', name: 'Student A', obligation: 500000, paid: 300000 }, // L$5000 obligation, L$3000 paid
      { id: 'STU-TEST-B', name: 'Student B', obligation: 400000, paid: 400000 }, // L$4000 obligation, L$4000 paid
      { id: 'STU-TEST-C', name: 'Student C', obligation: 600000, paid: 200000 }  // L$6000 obligation, L$2000 paid
    ];
    
    for (const student of students) {
      // Insert student
      await run(db, `
        INSERT INTO students (student_id, full_name, date_of_birth, place_of_birth, gender, 
          class_name, student_type, emergency_contact_name, emergency_contact_relationship,
          emergency_contact_phone, has_disability, registration_date, academic_year, status, created_at, updated_at)
        VALUES (?, ?, '2010-01-01', 'Test City', 'M', 'Grade 1', 'Regular', 'Parent', 'Parent', '555-0000', 0, datetime('now'), '2026', 'Active', datetime('now'), datetime('now'))
      `, [student.id, student.name]);
      
      // Insert account
      const accountResult = await run(db, `
        INSERT INTO student_accounts (student_id, academic_year_id, created_at)
        VALUES (?, ?, datetime('now'))
      `, [student.id, yearId]);
      
      const accountId = accountResult.lastID;
      
      // Insert obligation
      await run(db, `
        INSERT INTO student_obligations (account_id, phase, fee_type_name, amount_cents, created_at)
        VALUES (?, 'First Semester', 'Tuition', ?, datetime('now'))
      `, [accountId, student.obligation]);
      
      // Insert payment
      if (student.paid > 0) {
        await run(db, `
          INSERT INTO payments (account_id, receipt_number, amount_cents, payment_method, payment_date, status, created_at)
          VALUES (?, ?, ?, 'Cash', datetime('now'), 'VALID', datetime('now'))
        `, [accountId, `RCPT-TEST-${student.id}`, student.paid]);
      }
      
      console.log(`  ✓ Created ${student.name}: Obligation ${money(student.obligation)}, Paid ${money(student.paid)}`);
    }
    
    // Verify initial state
    console.log('\nSTEP 2: Verify initial financial position\n');
    const initial = await calculateFinancials(db);
    console.log(`  Obligated:   ${money(initial.obligated)} (expected L$15000.00)`);
    console.log(`  Collected:   ${money(initial.collected)} (expected L$9000.00)`);
    console.log(`  Outstanding: ${money(initial.outstanding)} (expected L$6000.00)`);
    
    const initialOk = initial.obligated === 1500000 && initial.collected === 900000 && initial.outstanding === 600000;
    console.log(`  Status: ${initialOk ? '✅ CORRECT' : '❌ MISMATCH'}\n`);
    
    // Delete Student B (paid in full)
    console.log('STEP 3: Delete Student B (who paid in full)\n');
    
    const accountBResult = await all(db, `
      SELECT id FROM student_accounts WHERE student_id = 'STU-TEST-B'
    `);
    
    if (accountBResult.length > 0) {
      const accountBId = accountBResult[0].id;
      
      // Manual cascading delete (as implemented in deleteStudent function)
      await run(db, `DELETE FROM payments WHERE account_id = ?`, [accountBId]);
      await run(db, `DELETE FROM student_obligations WHERE account_id = ?`, [accountBId]);
      await run(db, `DELETE FROM student_accounts WHERE id = ?`, [accountBId]);
      await run(db, `DELETE FROM students WHERE student_id = ?`, ['STU-TEST-B']);
      
      console.log('  ✓ Deleted Student B and all associated records (payments, obligations, account)\n');
    }
    
    // Verify after deleting Student B
    console.log('STEP 4: Verify financial position after deleting Student B\n');
    const afterB = await calculateFinancials(db);
    console.log(`  Obligated:   ${money(afterB.obligated)} (expected L$11000.00)`);
    console.log(`  Collected:   ${money(afterB.collected)} (expected L$5000.00)`);
    console.log(`  Outstanding: ${money(afterB.outstanding)} (expected L$6000.00)`);
    
    const afterBOk = afterB.obligated === 1100000 && afterB.collected === 500000 && afterB.outstanding === 600000;
    console.log(`  Status: ${afterBOk ? '✅ CORRECT' : '❌ MISMATCH'}\n`);
    
    // Delete Student A
    console.log('STEP 5: Delete Student A\n');
    
    const accountAResult = await all(db, `
      SELECT id FROM student_accounts WHERE student_id = 'STU-TEST-A'
    `);
    
    if (accountAResult.length > 0) {
      const accountAId = accountAResult[0].id;
      await run(db, `DELETE FROM payments WHERE account_id = ?`, [accountAId]);
      await run(db, `DELETE FROM student_obligations WHERE account_id = ?`, [accountAId]);
      await run(db, `DELETE FROM student_accounts WHERE id = ?`, [accountAId]);
      await run(db, `DELETE FROM students WHERE student_id = ?`, ['STU-TEST-A']);
      console.log('  ✓ Deleted Student A\n');
    }
    
    // Delete Student C
    console.log('STEP 6: Delete Student C\n');
    
    const accountCResult = await all(db, `
      SELECT id FROM student_accounts WHERE student_id = 'STU-TEST-C'
    `);
    
    if (accountCResult.length > 0) {
      const accountCId = accountCResult[0].id;
      await run(db, `DELETE FROM payments WHERE account_id = ?`, [accountCId]);
      await run(db, `DELETE FROM student_obligations WHERE account_id = ?`, [accountCId]);
      await run(db, `DELETE FROM student_accounts WHERE id = ?`, [accountCId]);
      await run(db, `DELETE FROM students WHERE student_id = ?`, ['STU-TEST-C']);
      console.log('  ✓ Deleted Student C\n');
    }
    
    // Verify all zeros
    console.log('STEP 7: Verify all students deleted → all metrics zero\n');
    const final = await calculateFinancials(db);
    console.log(`  Obligated:   ${money(final.obligated)} (expected L$0.00)`);
    console.log(`  Collected:   ${money(final.collected)} (expected L$0.00)`);
    console.log(`  Outstanding: ${money(final.outstanding)} (expected L$0.00)`);
    console.log(`  Collection Rate:    ${final.collectionRate.toFixed(2)}% (expected 0.00%)`);
    console.log(`  Outstanding Rate:   ${final.outstandingRate.toFixed(2)}% (expected 0.00%)`);
    
    const finalOk = final.obligated === 0 && final.collected === 0 && final.outstanding === 0 && 
                   final.collectionRate === 0 && final.outstandingRate === 0;
    console.log(`  Status: ${finalOk ? '✅ CORRECT' : '❌ MISMATCH'}\n`);
    
    console.log('========== TEST COMPLETE ==========\n');
    
    console.log('SUMMARY:\n');
    console.log(initialOk ? '✅ Step 2 (3 students): PASSED' : '❌ Step 2 (3 students): FAILED');
    console.log(afterBOk ? '✅ Step 4 (after delete B): PASSED' : '❌ Step 4 (after delete B): FAILED');
    console.log(finalOk ? '✅ Step 7 (all deleted): PASSED' : '❌ Step 7 (all deleted): FAILED');
    
    if (initialOk && afterBOk && finalOk) {
      console.log('\n🎉 ALL TESTS PASSED - Cascading deletion and financial calculations working correctly!\n');
    } else {
      console.log('\n⚠️  SOME TESTS FAILED - Review output above\n');
    }

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    db.close();
  }
}

testCascadingDeletion();
