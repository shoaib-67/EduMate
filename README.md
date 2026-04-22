# EduMate: University Admission Guide and Mock Test Platform

EduMate is a web-based educational platform designed to help students prepare for university admission tests through a centralized system of study resources, admission guidance, and online mock exams.

Live site:

## Motivation

Students preparing for admission tests often face scattered learning resources, unstructured preparation plans, and limited opportunities for realistic self-assessment. EduMate addresses these problems by combining learning content, mock test practice, performance tracking, and guided admission support in one platform.

The platform supports students, instructors, and administrators with role-specific tools to make preparation more efficient, measurable, and accessible.

## Project Objectives

- Develop a web-based platform dedicated to university admission preparation.
- Provide centralized access to study materials and admission-related information.
- Offer an online mock test system for practice and self-assessment.
- Improve student performance through result analysis and progress tracking.
- Deliver a responsive and user-friendly interface for students, instructors, and administrators.
- Automate core services such as user management, exam handling, and notifications.

## Measurable Goals

- Achieve at least 30 registered users during the initial testing phase.
- Enable students to complete at least 2 mock tests through the platform.
- Improve accessibility by offering admission resources in one centralized system.
- Reduce time spent searching for study materials and admission information.
- Increase student engagement through regular mock test participation and progress tracking.

## Scope of Work

### Core Website Features

- User authentication with role-based access (Student, Instructor, Admin)
- Course and subject management
- Online mock test system
- Result and performance analysis
- Exam routine management
- Discussion and support system
- Notification system (Email/SMS)
- Payment system for premium content
- Admin dashboard

### Platform Requirements

- Responsive web application
- Works on desktop and mobile devices
- Compatible with Chrome, Firefox, and Edge

### Integrations

- Payment gateway integration for premium content and course purchase
- Email/SMS APIs for notifications and verification
- YouTube integration for storing and streaming course videos
- Chart.js for performance analysis and visualization

## Deliverables

- Complete web application
- MySQL database system
- Admin panel
- Full project documentation

## Target Audience

### Students

- Preparing for university admission tests
- Need mock tests, study materials, and progress tracking
- Access course and subject management tools

### Teachers / Instructors

- Upload course materials
- Create exams and evaluate student performance

### System Administrators

- Manage users, content, and system operations

## Technology Stack

| Category | Details |
| --- | --- |
| Frontend Technologies | HTML, CSS, JavaScript |
| Backend Technologies | Node.js |
| Database | MySQL |
| Security | JWT authentication, bcrypt password hashing |
| Data Visualization | Chart.js |
| Development Tools | VS Code, GitHub, XAMPP or local Node environment |
| Hosting / Deployment | Localhost (XAMPP) |

## Local Setup (Node.js Backend + XAMPP MySQL)

1. Start Apache and MySQL from XAMPP Control Panel.
2. Open phpMyAdmin and make sure a database named `edumate` exists.
3. From project root, install backend dependencies:

```bash
npm --prefix backend install
```

4. Keep `backend/.env` values as default for XAMPP local MySQL:

```env
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=edumate
```

5. Run backend API server from project root:

```bash
node server.js
```

6. Open the frontend files in browser (or with Live Server).

Notes:
- On first backend start, the API auto-creates the `users` table in `edumate` and inserts demo users.
- Backend API health check is available at `http://localhost:5000/api/health`.

## Design and User Experience

EduMate follows a clean, modern, and user-friendly UI/UX approach to ensure smooth navigation and accessibility.

### Key Design Features

- Simple and intuitive homepage
- Responsive student dashboard
- Easy navigation between courses and tests
- Interactive mock test interface
- Visual performance charts
- Consistent typography and color scheme

## Expected Impact

- More structured admission preparation
- Better student performance through continuous assessment
- Improved instructor oversight of student progress
- Increased accessibility to educational content and admission guidance

## Future Enhancements

- AI-based personalized study recommendations
- Advanced analytics for performance prediction
- Mobile app version for improved accessibility
- Multi-language support

## Status

Planning and documentation phase.
