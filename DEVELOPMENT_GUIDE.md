# Nirmaan Stack Development Guide

## Introduction

This guide provides comprehensive documentation for the Nirmaan Stack development environment structure. Nirmaan Stack is a fully-fledged commercial construction project management application built on the Frappe Framework. This document aims to help developers understand the organization of the codebase, the purpose of different directories, and how the frontend and backend components interact.

## Project Overview

Nirmaan Stack is developed by Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and consists of:

1. A backend built with the Frappe Framework (Python)
2. A modern frontend built with React, TypeScript, and various UI libraries

The application provides functionality for:
- Project management
- Procurement management
- Service request management
- Financial management
- Vendor management
- User management
- Reporting

## Directory Structure

The Nirmaan Stack application follows the standard Frappe app structure with some custom additions:

```
frappe-bench/apps/nirmaan_stack/
├── LICENSE                     # License file
├── README.md                   # Basic project documentation
├── package.json                # Node.js package configuration
├── pyproject.toml              # Python project configuration
├── yarn.lock                   # Yarn lock file
├── frontend/                   # React frontend application
└── nirmaan_stack/              # Frappe backend application
```

### Frontend Structure

The frontend is a modern React application with TypeScript, built with Vite:

```
frontend/
├── components.json             # UI component configuration
├── cypress.config.ts           # Cypress testing configuration
├── index.html                  # HTML entry point
├── package.json                # Frontend dependencies
├── postcss.config.js           # PostCSS configuration
├── proxyOptions.ts             # API proxy configuration
├── README.md                   # Frontend documentation
├── tailwind.config.js          # Tailwind CSS configuration
├── tsconfig.json               # TypeScript configuration
├── tsconfig.node.json          # Node-specific TypeScript configuration
├── vite.config.ts              # Vite build configuration
├── yarn.lock                   # Yarn lock file
├── cypress/                    # End-to-end tests
├── public/                     # Static assets
└── src/                        # Source code
```

#### Frontend Source Code Structure

The `src` directory contains the main frontend code:

```
src/
├── App.tsx                     # Main application component
├── index.css                   # Global CSS
├── main.tsx                    # Application entry point
├── ReloadPrompt.tsx            # PWA reload functionality
├── vite-env.d.ts               # Vite type declarations
├── assets/                     # Static assets (images, icons)
├── components/                 # Reusable UI components
├── config/                     # Configuration files
├── constants/                  # Constant values and enumerations
├── firebase/                   # Firebase integration
├── hooks/                      # Custom React hooks
├── lib/                        # Library code and third-party integrations
├── pages/                      # Page components organized by route
├── reactQuery/                 # React Query configurations
├── services/                   # API services and data access
├── types/                      # TypeScript type definitions
├── utils/                      # Utility functions
└── zustand/                    # State management with Zustand
```

#### Key Frontend Components

1. **Custom Hooks (`hooks/`)**:
   - `useUserData.ts` - Access user information
   - `useOrderTotals.ts` - Calculate order totals
   - `useServerDataTable.ts` - Handle server-side data tables
   - `useSidebarCounts.ts` - Fetch sidebar notification counts
   - `usePOValidation.ts` - Validate purchase orders

2. **Pages (`pages/`)**:
   - `dashboard.tsx` - Main dashboard
   - `ServiceRequests/` - Service request management
   - `ProcurementOrders/` - Procurement order management
   - `ProcurementRequests/` - Procurement request management
   - `ProjectPayments/` - Project payment management
   - `projects/` - Project management
   - `vendors/` - Vendor management
   - `users/` - User management

3. **Services (`services/`)**:
   - `socketListeners.ts` - WebSocket communication

4. **State Management (`zustand/`)**:
   - Global state management using Zustand

### Backend Structure

The backend follows the standard Frappe app structure:

```
nirmaan_stack/
├── __init__.py                 # Package initialization
├── hooks.py                    # Frappe hooks
├── install.py                  # Installation script
├── modules.txt                 # Module definitions
├── patches.txt                 # Database migration patches
├── api/                        # API endpoints
├── config/                     # Configuration files
├── custom/                     # Custom fields and customizations
├── fixtures/                   # Fixtures for data import/export
├── integrations/               # Third-party integrations
├── nirmaan_stack/              # Core application code
├── patches/                    # Database migration scripts
├── public/                     # Public assets
├── services/                   # Service layer
├── templates/                  # Jinja templates
└── www/                        # Web pages
```

#### Core Backend Components

1. **DocTypes (`nirmaan_stack/nirmaan_stack/doctype/`)**:
   - `projects/` - Project data model
   - `procurement_requests/` - Procurement request data model
   - `procurement_orders/` - Procurement order data model
   - `service_requests/` - Service request data model
   - `project_payments/` - Project payment data model
   - `vendors/` - Vendor data model
   - `nirmaan_users/` - User data model
   - `items/` - Item data model

2. **API Endpoints (`api/`)**:
   - `procurement_orders.py` - Procurement order APIs
   - `approve_vendor_quotes.py` - Vendor quote approval APIs
   - `sidebar_counts.py` - Sidebar notification count APIs
   - `projects/` - Project-related APIs
   - `payments/` - Payment-related APIs

3. **Integrations (`integrations/`)**:
   - `controllers/` - Business logic controllers
   - `firebase/` - Firebase integration
   - `Notifications/` - Notification system

4. **Services (`services/`)**:
   - `finance.py` - Financial services

## Integration Between Frontend and Backend

The frontend and backend integrate through several mechanisms:

1. **REST API**:
   - The frontend uses the Frappe REST API to fetch and manipulate data
   - The `frappe-react-sdk` library provides hooks like `useFrappeGetDoc` and `useFrappeGetDocList` for data fetching

2. **WebSockets**:
   - Real-time updates are handled through WebSockets
   - The `socketListeners.ts` file manages WebSocket connections

3. **Custom Endpoints**:
   - Custom API endpoints in the `api/` directory provide specialized functionality
   - These are accessed through standard HTTP requests

4. **Authentication**:
   - Frappe's authentication system is used for user authentication
   - User permissions are managed through the `nirmaan_user_permissions` doctype

## Key Workflows

### Service Request Workflow

1. A user creates a service request through the frontend
2. The request is stored in the `service_requests` doctype
3. The request goes through various approval stages
4. Once approved, it becomes a service order
5. The service order can be printed and shared with vendors

### Procurement Workflow

1. A user creates a procurement request
2. The request is reviewed and approved
3. Once approved, it becomes a procurement order
4. The order is sent to vendors for quotations
5. Quotations are reviewed and approved
6. The order is finalized and sent to the vendor

### Project Payment Workflow

1. A user creates a payment request
2. The request is reviewed and approved
3. Once approved, the payment is processed
4. The payment is recorded in the system

## Best Practices for Development

### Adding New Frontend Features

1. **Create Components**:
   - Place reusable UI components in `frontend/src/components/`
   - Use TypeScript for type safety
   - Follow the existing component structure

2. **Create Pages**:
   - Place new pages in `frontend/src/pages/` in the appropriate subdirectory
   - Use existing hooks and utilities for data fetching and state management

3. **Add Routes**:
   - Update the router configuration to include new pages

### Adding New Backend Features

1. **Create DocTypes**:
   - Use the Frappe DocType system to define new data models
   - Place them in `nirmaan_stack/nirmaan_stack/doctype/`

2. **Create APIs**:
   - Add new API endpoints in `nirmaan_stack/api/`
   - Follow RESTful principles

3. **Add Business Logic**:
   - Place business logic in `nirmaan_stack/integrations/controllers/`
   - Use Frappe's document events in `hooks.py` to trigger actions

### Code Organization

1. **Frontend**:
   - Organize code by feature (e.g., `ServiceRequests/`, `ProcurementOrders/`)
   - Use TypeScript interfaces for data models
   - Keep components small and focused

2. **Backend**:
   - Follow Frappe's conventions for DocTypes and APIs
   - Use controllers for complex business logic
   - Use services for shared functionality

## Conclusion

The Nirmaan Stack is a comprehensive construction project management application with a modern frontend and a robust backend. This guide provides an overview of the codebase structure and organization to help developers understand and contribute to the project effectively.

For more detailed information, refer to the specific documentation for each component or reach out to the development team.