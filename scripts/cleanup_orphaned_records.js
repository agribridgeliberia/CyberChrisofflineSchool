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

async function cleanupOrphanedRecords() {
  console.log('\n========== CLEANING UP ORPHANED FINANCIAL RECORDS ==========\n');

  const db = new sqlite3.Database(dbPath);

  try {
    // Step 1: Find orphaned student_accounts (student_id references deleted students)
    console.log('Step 1: Finding orphaned student accounts...\n');
    
    const orphanedAccounts = await all(db, `
      SELECT sa.id, sa.student_id
      FROM student_accounts sa
      LEFT JOIN students s ON sa.student_id = s.student_id
      WHERE s.student_id IS NULL
    `);
    
    if (orphanedAccounts.length === 0) {
      console.log('  ✓ No orphaned student accounts found');
    } else {
      console.log(`  Found ${orphanedAccounts.length} orphaned accounts:`);
      orphanedAccounts.forEach(acc => {
        console.log(`    - Account ID ${acc.id}: references deleted student ${acc.student_id}`);
      });
      
      // Step 2: Delete orphaned payments
      console.log('\nStep 2: Deleting orphaned payment records...\n');
      
      let totalOrphanedPayments = 0;
      for (const account of orphanedAccounts) {
        const payments = await all(db, `
          SELECT COUNT(*) as count, SUM(amount_cents) as total
          FROM payments
          WHERE account_id = ?
        `, [account.id]);
        
        if (payments[0].count > 0) {
          totalOrphanedPayments += payments[0].total || 0;
          await run(db, `DELETE FROM payments WHERE account_id = ?`, [account.id]);
          console.log(`  ✓ Deleted ${payments[0].count} payments from account ${account.id} (L$${(payments[0].total / 100).toFixed(2)})`);
        }
      }
      
      if (totalOrphanedPayments > 0) {
        console.log(`\n  TOTAL DELETED PAYMENTS: L$${(totalOrphanedPayments / 100).toFixed(2)}`);
      }
      
      // Step 3: Delete orphaned obligations
      console.log('\nStep 3: Deleting orphaned obligation records...\n');
      
      let totalOrphanedObligations = 0;
      for (const account of orphanedAccounts) {
        const obligations = await all(db, `
          SELECT COUNT(*) as count, SUM(amount_cents) as total
          FROM student_obligations
          WHERE account_id = ?
        `, [account.id]);
        
        if (obligations[0].count > 0) {
          totalOrphanedObligations += obligations[0].total || 0;
          await run(db, `DELETE FROM student_obligations WHERE account_id = ?`, [account.id]);
          console.log(`  ✓ Deleted ${obligations[0].count} obligations from account ${account.id} (L$${(obligations[0].total / 100).toFixed(2)})`);
        }
      }
      
      if (totalOrphanedObligations > 0) {
        console.log(`\n  TOTAL DELETED OBLIGATIONS: L$${(totalOrphanedObligations / 100).toFixed(2)}`);
      }
      
      // Step 4: Delete orphaned accounts
      console.log('\nStep 4: Deleting orphaned student account records...\n');
      
      const accountIds = orphanedAccounts.map(a => a.id);
      const placeholders = accountIds.map(() => '?').join(',');
      
      await run(db, `DELETE FROM student_accounts WHERE id IN (${placeholders})`, accountIds);
      console.log(`  ✓ Deleted ${orphanedAccounts.length} orphaned student accounts`);
    }
    
    // Step 5: Verify no orphaned records remain
    console.log('\nStep 5: Verifying cleanup...\n');
    
    const orphanedPayments = await all(db, `
      SELECT COUNT(*) as count FROM payments p
      LEFT JOIN student_accounts sa ON p.account_id = sa.id
      WHERE sa.id IS NULL
    `);
    
    const orphanedObligations = await all(db, `
      SELECT COUNT(*) as count FROM student_obligations so
      LEFT JOIN student_accounts sa ON so.account_id = sa.id
      WHERE sa.id IS NULL
    `);
    
    if (orphanedPayments[0].count === 0 && orphanedObligations[0].count === 0) {
      console.log('  ✅ CLEANUP COMPLETE: No orphaned records remain');
    } else {
      console.log(`  ❌ WARNING: Found ${orphanedPayments[0].count} orphaned payments, ${orphanedObligations[0].count} orphaned obligations`);
    }
    
    // Step 6: Show final financial position
    console.log('\nStep 6: Final Financial Position\n');
    
    const summary = await all(db, `
      SELECT 
        COALESCE(SUM(so.amount_cents), 0) as total_obligated,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE status='VALID'), 0) as total_collected,
        COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE status='VALID'), 0) as total_expenditure
      FROM student_obligations so
      JOIN student_accounts sa ON so.account_id = sa.id
      WHERE sa.id IS NOT NULL
    `);
    
    const totalObligated = summary[0].total_obligated || 0;
    const totalCollected = summary[0].total_collected || 0;
    const totalExpenditure = summary[0].total_expenditure || 0;
    
    console.log(`  Total Obligated:  L$${(totalObligated / 100).toFixed(2)}`);
    console.log(`  Total Collected:  L$${(totalCollected / 100).toFixed(2)}`);
    console.log(`  Total Expenditure: L$${(totalExpenditure / 100).toFixed(2)}`);
    console.log(`  Outstanding:      L$${((totalObligated - totalCollected) / 100).toFixed(2)}`);
    console.log(`  Net Balance:      L$${((totalCollected - totalExpenditure) / 100).toFixed(2)}`);
    
    console.log('\n========== CLEANUP COMPLETE ==========\n');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    db.close();
  }
}

cleanupOrphanedRecords();
