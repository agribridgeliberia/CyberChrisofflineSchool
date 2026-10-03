# Financial Statistics Calculation System

## Overview
This document describes the centralized financial calculation system that powers the dashboard and finance modules.

## Key Changes (2026-09-01)

### 1. Centralized Calculation Function
**Location**: `database/database.js` → `calculateFinancialStatistics(db)`

This is now the **SINGLE SOURCE OF TRUTH** for all financial calculations. All dashboard and finance modules use this function.

### 2. Core Financial Definitions

#### Obligated
- **Definition**: Total amount currently required from all **ACTIVE/ENROLLED** students
- **Calculation**: `SUM(student_obligations.amount_cents)` WHERE `students.status = 'Active'`
- **Key**: Only active students count. When a student is deleted, they become 'Inactive' and their obligations no longer count
- **Dynamic**: Recalculated on every call to reflect current enrollment

#### Collected
- **Definition**: Sum of all actual recorded student payments (all-time)
- **Calculation**: `SUM(payments.amount_cents)` WHERE `payments.status = 'VALID'`
- **Independence**: Collected is **independent of student status** - historical payments are preserved even if student becomes inactive

#### Outstanding
- **Definition**: Amount still owed
- **Calculation**: `Outstanding = Obligated - Collected`
- **Can be Negative**: If more collected than currently obligated (e.g., after student leaves but payments remain)

#### Expenditure
- **Definition**: Total school operating expenses
- **Calculation**: `SUM(expenses.amount_cents)` WHERE `expenses.status = 'VALID'`

#### Net Balance
- **Definition**: Net cash position after expenses
- **Calculation**: `Net Balance = Collected - Expenditure`
- **Positive/Negative**: Can be positive (surplus) or negative (deficit)

### 3. Percentage Calculations (with Zero-Division Safety)

| Metric | Formula | If Divisor=0 |
|--------|---------|--------------|
| Collection Rate | (Collected ÷ Obligated) × 100 | Return 0% |
| Outstanding Rate | (Outstanding ÷ Obligated) × 100 | Return 0% |
| Expenditure Rate | (Expenditure ÷ Collected) × 100 | Return 0% |
| Net Balance Rate | (Net Balance ÷ Collected) × 100 | Return 0% |

### 4. Soft Delete for Students

**Previous Behavior**: Hard delete
- Deleted student record from database
- Cascaded delete of obligations
- Orphaned payment records

**New Behavior**: Soft delete
- Update `students.status = 'Inactive'` instead of DELETE
- Preserves financial history (obligations, payments)
- Student no longer contributes to active obligation count
- Payment records remain accessible for auditing

**Benefits**:
- Financial data preservation
- Audit trail intact
- Obligations automatically excluded from "current obligated" calculation
- Can restore student by setting status back to 'Active'

## Implementation Details

### Functions Updated

#### 1. `calculateFinancialStatistics(db)`
**New Function** - Core calculation engine

```javascript
Returns: {
  total_obligated: number,         // SUM of active students' obligations
  total_collected: number,         // SUM of valid payments (all-time)
  total_expenditure: number,       // SUM of valid expenses
  outstanding: number,             // Obligated - Collected
  net_balance: number,             // Collected - Expenditure
  collection_rate: number,         // Percentage
  outstanding_rate: number,        // Percentage
  expenditure_rate: number,        // Percentage
  net_balance_rate: number         // Percentage
}
```

#### 2. `getDashboardSummary()`
**Updated** - Now calls `calculateFinancialStatistics()`

- Returns financial metrics + gender/class distributions
- Always reflects current active student obligations
- Percentages included for all metrics

#### 3. `getFinanceSummary()`
**Updated** - Now calls `calculateFinancialStatistics()`

- Returns core financials + time-based metrics (today, this month)
- Recent payments list
- Compatible with Finance screen display

#### 4. `deleteStudent(studentId)`
**Updated** - Soft delete instead of hard delete

```javascript
// Before: DELETE FROM students WHERE student_id = ?
// After:  UPDATE students SET status = 'Inactive', updated_at = ?
```

#### 5. `listOwingStudents()`
**Updated** - Only lists ACTIVE students

- Filters: `WHERE students.status = 'Active'`
- Prevents showing withdrawn/inactive students in collection reports

## Impact on Other Operations

### Adding a Student
1. `addStudent()` creates student record
2. `ensureStudentAccount()` creates obligations from fee template
3. On next dashboard load:
   - New student's class fee obligations added to "Obligated"
   - Active student count increases
   - Dashboard refreshes automatically (via frontend)

### Editing a Student
1. `updateStudent()` modifies student fields
2. **Note**: Changing student class does NOT update existing obligations
   - Obligations remain as originally created
   - To update fees: manually adjust or delete/re-add student
3. If status changed to 'Inactive':
   - Obligations excluded from current obligation calculation
   - Financial history preserved

### Deleting a Student
1. `deleteStudent(id)` sets `status = 'Inactive'`
2. Immediately:
   - Obligations excluded from "Obligated" calculation
   - Active student count decreases
   - Outstanding obligation decreases
   - Financial history preserved
3. Dashboard next refresh shows updated obligation

### Recording a Payment
1. `recordPayment()` inserts valid payment
2. On next dashboard load:
   - Total Collected increases
   - Outstanding decreases
   - Collection Rate increases
   - Net Balance may increase (depending on expense)

### Recording an Expense
1. `recordExpense()` inserts valid expense
2. On next dashboard load:
   - Total Expenditure increases
   - Net Balance decreases
   - Expenditure Rate changes

## Frontend Dashboard Refresh

The dashboard automatically refreshes when:
1. User navigates to Dashboard page (calls `loadDashboard()`)
2. User manually refreshes the page
3. User navigates back from another module

**Note**: The dashboard does NOT auto-refresh when data changes on another screen. This is by design - users must navigate back to dashboard to see updates.

To implement auto-refresh on data changes:
- Add `await window.api.getDashboardSummary()` calls after each student/payment/expense operation in app.js
- Consider WebSocket/polling for real-time updates in future

## Edge Cases Handled

### No Active Students (Obligated = 0)
- Collection Rate: 0% (not NaN)
- Outstanding Rate: 0% (not NaN)  
- Outstanding = Collected - 0 = Collected
- Dashboard shows sensible values

### No Collected Payments (Collected = 0)
- Expenditure Rate: 0% (not NaN)
- Net Balance Rate: 0% (not NaN)
- Outstanding = Obligated
- Dashboard shows sensible values

### All Students Inactive
- Obligated = 0 (no active students)
- Collected remains (historical payments)
- Collection Rate = 0%
- Outstanding = 0 - Collected = Negative (showing collection excess)

## Database Integrity

### Payment History Preservation
- When student deleted: obligations removed from current calc, but payments preserved
- Auditors can still view historical payments for deleted students
- Financial reconciliation remains accurate

### Cascade Behavior
- `DELETE student` → cascade deletes account, obligations (NO LONGER USED)
- `UPDATE student.status = 'Inactive'` → no cascade, all history preserved ✅

## Testing Checklist

- [ ] Add new student → check Obligated increases
- [ ] Delete student → check Obligated decreases, payments remain
- [ ] Record payment → check Collected increases, Outstanding decreases
- [ ] Record expense → check Expenditure increases, Net Balance decreases
- [ ] Mark all students inactive → check Obligated = 0%
- [ ] Verify percentages with zero-division scenarios
- [ ] Check listOwingStudents only shows active students
- [ ] Verify getDashboardSummary returns all percentage fields
- [ ] Check getFinanceSummary compatibility with Finance screen

## Future Enhancements

1. **Real-time Dashboard Refresh**: Implement WebSocket/polling
2. **Obligation Recalculation on Class Change**: Auto-update fees when student class changes
3. **Soft Delete Restoration**: UI option to restore 'Inactive' students
4. **Financial Audit Logs**: Track all obligation/payment changes
5. **Obligation Adjustment**: Allow admin to adjust student obligations manually
6. **Payment Plans**: Support installment-based payment tracking

---

**Last Updated**: 2026-09-01
**System**: School Management System v1.0
**Database**: SQLite3
