**School Management System — Phase 1: Admission & Student Records**

Build a professional **offline desktop School Management System** using:

- **HTML5**
- **CSS3**
- **JavaScript**
- **Bootstrap 5**
- **Electron**
- **Node.js**
- **SQLite**

The application must work **100% offline**. Do not depend on CDNs, external APIs, cloud databases, or internet connectivity at runtime. All required Bootstrap, JavaScript, icons, fonts, and other assets should be stored locally.

**1\. Project Objective**

Create Phase 1 of a modern School Management System focused on:

**Admission / Registration and Student Records**

The system should allow school administrators or registrars to register students, automatically generate student IDs, store their information in SQLite, search records, view student profiles, edit records, and archive students.

The architecture must be modular so that future phases can add:

- Fees
- Attendance
- Academics / Results
- Teachers
- Parents
- Reports
- Promotion
- User management
- School settings

without having to rebuild Phase 1.

**2\. Visual Design**

Use a professional modern school-management dashboard design.

**Primary Color Palette**

**Deep Blue**

- Primary: #14213D
- Secondary Blue: #1D3557

**Pink**

- Primary Pink: #E83E8C
- Light Pink: #FDE7F2

**Neutral**

- White: #FFFFFF
- Background: #F7F8FC
- Text: #212529
- Muted text: #6C757D

Deep blue should be the dominant interface color, while pink should be used for important actions, highlights, active states, badges, and visual accents.

Do not make the interface overly pink.

The interface should feel:

- Professional
- Modern
- Clean
- Fast
- School-oriented
- Easy for non-technical staff to use

Avoid excessive cards. Use cards only where they improve organization.

**3\. Application Layout**

Create a desktop application with:

**Left Sidebar**

Include:

- Dashboard
- Admission
- Students
- Student Records
- Settings

For Phase 1, only **Admission** and **Students/Records** need to be fully functional.

Future modules can appear disabled or marked "Coming Soon".

**Top Navigation**

Include:

- School name
- Current academic year
- Notification icon
- User/profile area
- Current date

**Main Content**

The content area should change dynamically without unnecessarily opening multiple windows.

**4\. Dashboard**

Create an initial dashboard for Phase 1.

Display statistics such as:

- Total Students
- New Students
- Returning Students
- Male Students
- Female Students

Also display:

**Recent Admissions**

Show recently registered students with:

- Student ID
- Student name
- Class
- Gender
- Student type
- Registration date
- Status

Provide a prominent:

**\+ New Admission**

button.

**5\. Admission / Registration Form**

Create a clean multi-section registration form.

**Student Information**

Fields:

1. Student ID
   - Automatically generated
   - Read-only
   - Format:

STU-2026-0001

STU-2026-0002

STU-2026-0003

The year should come from the current academic year/system configuration.

1. Full Name
2. Date of Birth
3. Place of Birth
4. Gender
   - Male
   - Female
5. Class
6. Student Type
   - New Student
   - Returning/Old Student

**Emergency Contact**

Fields:

1. Emergency Contact Name
2. Relationship to Student
3. Emergency Contact Phone
4. Emergency Contact Address

**Disability Information**

Fields:

1. Does the student have a disability?
   - No
   - Yes

If "Yes" is selected, dynamically display:

- Disability Type
- Support Needed / Additional Notes

If "No" is selected, hide these fields.

**Registration**

Also store:

- Registration date
- Academic year
- Student status

Default student status:

Active

**6\. Form Validation**

Implement strong client-side and server-side/database validation.

Required fields:

- Full Name
- Date of Birth
- Place of Birth
- Gender
- Class
- Student Type
- Emergency Contact Name
- Emergency Contact Phone
- Disability status

Prevent duplicate student IDs.

Validate phone numbers appropriately.

Display friendly validation messages.

Do not allow invalid records to be inserted into SQLite.

**7\. Student Database**

Use SQLite.

Create a students table containing at minimum:

id

student_id

full_name

date_of_birth

place_of_birth

gender

class_name

student_type

emergency_contact_name

emergency_contact_relationship

emergency_contact_phone

emergency_contact_address

has_disability

disability_type

support_needed

registration_date

academic_year

status

created_at

updated_at

Use appropriate SQLite data types.

Create indexes where useful, especially for:

- student_id
- full_name
- class_name
- academic_year
- status

student_id must be UNIQUE.

**8\. Student ID Generation**

Implement automatic student ID generation.

Example:

STU-2026-0001

STU-2026-0002

STU-2026-0003

When registering a new student:

1. Get the current academic year.
2. Find the latest student number for that year.
3. Increment it.
4. Generate the new ID.
5. Save it to the database.

Never trust a student ID supplied manually from the frontend.

**9\. Students / Records Page**

Create a professional student-records page.

Include:

**Search**

Allow searching by:

- Student ID
- Student name
- Class
- Student type

**Filters**

Include:

- Class
- Gender
- Student Type
- Status
- Academic Year

**Student Table**

Columns:

- Student ID
- Full Name
- Gender
- Date of Birth
- Class
- Student Type
- Registration Date
- Status
- Actions

Actions:

- View
- Edit
- Archive

Use Bootstrap modals where appropriate.

**10\. Student Profile**

Create a detailed student profile page/modal.

Display:

**Student Header**

- Student ID
- Full name
- Class
- Gender
- Student type
- Status

**Personal Information**

- Date of birth
- Place of birth
- Gender

**Emergency Contact**

- Name
- Relationship
- Phone
- Address

**Disability Information**

- Disability status
- Disability type
- Support needed

**Admission Information**

- Student ID
- Registration date
- Academic year
- Student type
- Status

Add buttons:

- Edit Student
- Print Student Record
- Archive Student

Future modules should eventually appear as tabs:

Profile

Attendance

Fees

Results

Documents

History

For Phase 1, only Profile needs to be functional.

**11\. Edit Student**

Allow authorized users to edit student records.

Do not allow the student ID to be changed casually.

When editing:

- Validate all fields.
- Update updated_at.
- Maintain the original registration date.
- Maintain database integrity.

Show a success notification after saving.

**12\. Archive Student**

Do not physically delete students when the user clicks "Delete".

Instead, implement:

status = Archived

Archived students should not appear in the default active-student list.

Provide a filter to view archived students.

This preserves historical school records.

**13\. Notifications**

Use modern Bootstrap alerts/toasts for:

- Student registered successfully
- Student updated successfully
- Student archived successfully
- Validation errors
- Database errors
- Duplicate record warnings

Do not use ugly browser alert() dialogs unless absolutely necessary.

**14\. Offline Architecture**

The application must operate without internet.

Electron should provide the desktop environment.

Node.js should handle secure database operations.

SQLite should store the school's data locally.

Do NOT put direct unrestricted database access into renderer JavaScript.

Use Electron's secure architecture:

Renderer

↓

Preload / IPC

↓

Main Process

↓

SQLite

Use:

contextIsolation: true

nodeIntegration: false

Do not expose unnecessary Node.js APIs to the frontend.

**15\. Project Structure**

Use a clean modular structure similar to:

school-management-system/

│

├── package.json

├── main.js

│

├── database/

│ ├── database.js

│ ├── schema.sql

│ └── school.db

│

├── src/

│ ├── index.html

│ │

│ ├── assets/

│ │ ├── css/

│ │ │ ├── bootstrap.min.css

│ │ │ └── app.css

│ │ │

│ │ ├── js/

│ │ │ ├── app.js

│ │ │ ├── dashboard.js

│ │ │ ├── admission.js

│ │ │ └── students.js

│ │ │

│ │ └── icons/

│ │

│ ├── pages/

│ │ ├── dashboard.html

│ │ ├── admission.html

│ │ ├── students.html

│ │ └── student-profile.html

│ │

│ └── components/

│ ├── sidebar.html

│ ├── navbar.html

│ └── notifications.html

│

└── README.md

You may improve this structure if a better architecture is appropriate, but keep the application modular and easy to maintain.

**16\. User Experience**

The application should feel like a real professional desktop application, not simply a website placed inside Electron.

Implement:

- Smooth page transitions
- Hover effects
- Loading states
- Empty states
- Toast notifications
- Responsive Bootstrap layout
- Keyboard-friendly forms
- Proper focus states
- Confirmation dialogs for destructive actions
- Professional typography
- Consistent spacing
- Accessible labels

Do not overuse animations.

Performance is important.

**17\. Security**

Implement basic desktop application security from the beginning.

- Context isolation enabled
- Node integration disabled in renderer
- Validate all database inputs
- Use parameterized SQLite queries
- Never construct SQL using raw user input
- Keep database operations in the main process
- Do not expose filesystem access unnecessarily

**18\. Future-Proofing**

Do not build Phase 1 in a way that prevents future modules.

The database and code should be prepared for future relationships such as:

Student

│

├── Admission

├── Parent/Guardian

├── Attendance

├── Fees

├── Results

├── Promotion

└── Documents

Do not implement those future modules yet.

Only create the foundation necessary to support them.

**19\. Development Rule**

Build **Phase 1 only**.

Do not jump ahead to fees, attendance, examination, payroll, or other modules.

First make sure the following workflow works completely:

Open Application

↓

Dashboard

↓

New Admission

↓

Fill Registration Form

↓

Validate

↓

Generate Student ID

↓

Save to SQLite

↓

Success Notification

↓

Student appears in Records

↓

Search Student

↓

View Profile

↓

Edit Student

↓

Archive Student

Every part of this workflow must work before considering Phase 1 complete.

**20\. Code Quality**

Write clean, maintainable code.

Avoid putting the entire application into one HTML file or one JavaScript file.

Use reusable functions and modules.

Add comments where they help explain important logic, particularly:

- SQLite initialization
- IPC communication
- Student ID generation
- Database queries
- Form validation

Do not add unnecessary dependencies.

At the end, provide instructions for:

npm install

npm start

and instructions for building the Windows .exe.

Start by creating the project structure, package.json, Electron main process, secure preload layer, SQLite database initialization, schema, and application shell. Then implement the Phase 1 Admission and Student Records workflow.