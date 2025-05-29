# Nirmaan Stack Coding Standards

This document outlines the coding standards and best practices for developing within the Nirmaan Stack environment. Following these guidelines ensures consistency, maintainability, and quality across the codebase.

## Table of Contents

1. [General Guidelines](#general-guidelines)
2. [Frontend Development](#frontend-development)
   - [React Components](#react-components)
   - [TypeScript Usage](#typescript-usage)
   - [State Management](#state-management)
   - [Styling](#styling)
   - [File Organization](#file-organization)
3. [Backend Development](#backend-development)
   - [DocType Development](#doctype-development)
   - [API Development](#api-development)
   - [Controller Development](#controller-development)
   - [Python Style Guide](#python-style-guide)
4. [Naming Conventions](#naming-conventions)
5. [Documentation Standards](#documentation-standards)
6. [Testing Standards](#testing-standards)

## General Guidelines

- Follow the DRY (Don't Repeat Yourself) principle
- Write self-documenting code with clear variable and function names
- Keep functions and components small and focused on a single responsibility
- Add comments for complex logic, but avoid commenting obvious code
- Use version control effectively with meaningful commit messages
- Review code before submitting pull requests

## Frontend Development

### React Components

1. **Component Structure**:
   - Use functional components with hooks instead of class components
   - Keep components small and focused on a single responsibility
   - Extract reusable logic into custom hooks
   - Follow this general structure for components:

```tsx
// Imports
import React from 'react';
import { useHook } from '@/hooks/useHook';

// Types
interface ComponentProps {
  prop1: string;
  prop2: number;
}

// Component
export const ComponentName: React.FC<ComponentProps> = ({ prop1, prop2 }) => {
  // Hooks
  const { data } = useHook();
  
  // Event handlers
  const handleClick = () => {
    // Logic
  };
  
  // Render
  return (
    <div>
      {/* JSX */}
    </div>
  );
};
```

2. **Component Organization**:
   - Place reusable components in `frontend/src/components/`
   - Place page components in `frontend/src/pages/` in the appropriate subdirectory
   - Create index files to export components from directories

### TypeScript Usage

1. **Type Definitions**:
   - Define interfaces for component props
   - Define types for API responses in `frontend/src/types/`
   - Use type inference where appropriate, but explicitly type complex objects
   - Avoid using `any` type; use `unknown` if the type is truly unknown

2. **Type Organization**:
   - Place shared types in `frontend/src/types/`
   - Place component-specific types in the same file as the component
   - Use namespaces to organize related types

### State Management

1. **Local State**:
   - Use React's `useState` hook for component-specific state
   - Use React's `useReducer` hook for complex state logic within a component

2. **Global State**:
   - Use Zustand for global state management
   - Create separate stores for different domains
   - Place store definitions in `frontend/src/zustand/`

3. **Data Fetching**:
   - Use React Query for data fetching and caching
   - Use the Frappe React SDK hooks for Frappe-specific data fetching
   - Handle loading and error states appropriately

### Styling

1. **CSS Organization**:
   - Use Tailwind CSS for styling
   - Use CSS modules for component-specific styles
   - Follow utility-first approach with Tailwind

2. **Theme Consistency**:
   - Use the theme variables defined in `tailwind.config.js`
   - Maintain consistent spacing, colors, and typography

### File Organization

1. **Directory Structure**:
   - Organize files by feature (e.g., `ServiceRequests/`, `ProcurementOrders/`)
   - Use index files to export components from directories
   - Keep related files together

2. **File Naming**:
   - Use PascalCase for component files (e.g., `ComponentName.tsx`)
   - Use kebab-case for non-component files (e.g., `utility-function.ts`)
   - Use `.tsx` extension for files containing JSX
   - Use `.ts` extension for files without JSX

## Backend Development

### DocType Development

1. **DocType Structure**:
   - Follow Frappe's DocType structure
   - Define fields with appropriate types and validation
   - Use naming series for auto-generated names
   - Define appropriate permissions

2. **DocType Organization**:
   - Place DocTypes in `nirmaan_stack/nirmaan_stack/doctype/`
   - Use appropriate naming for DocTypes (singular, lowercase with underscores)
   - Create controller classes for complex DocTypes

### API Development

1. **API Structure**:
   - Follow RESTful principles
   - Use appropriate HTTP methods (GET, POST, PUT, DELETE)
   - Return consistent response formats
   - Handle errors gracefully

2. **API Organization**:
   - Place API endpoints in `nirmaan_stack/api/`
   - Group related endpoints in subdirectories
   - Use appropriate naming for API files (lowercase with underscores)

### Controller Development

1. **Controller Structure**:
   - Place business logic in controller files
   - Use document events for lifecycle hooks
   - Keep controllers focused on a single responsibility

2. **Controller Organization**:
   - Place controllers in `nirmaan_stack/integrations/controllers/`
   - Use appropriate naming for controller files (lowercase with underscores)
   - Register document events in `hooks.py`

### Python Style Guide

1. **Code Style**:
   - Follow PEP 8 guidelines
   - Use 4 spaces for indentation
   - Limit line length to 79 characters
   - Use docstrings for functions and classes

2. **Imports**:
   - Group imports in the following order:
     1. Standard library imports
     2. Third-party imports
     3. Frappe imports
     4. Local application imports
   - Sort imports alphabetically within each group

## Naming Conventions

1. **Frontend**:
   - **Components**: PascalCase (e.g., `ServiceRequestList.tsx`)
   - **Hooks**: camelCase with `use` prefix (e.g., `useUserData.ts`)
   - **Utilities**: camelCase (e.g., `formatDate.ts`)
   - **Constants**: UPPER_SNAKE_CASE (e.g., `API_ENDPOINTS.ts`)
   - **Types**: PascalCase (e.g., `ServiceRequest.ts`)

2. **Backend**:
   - **DocTypes**: snake_case (e.g., `service_requests`)
   - **API Endpoints**: snake_case (e.g., `get_service_requests.py`)
   - **Controllers**: snake_case (e.g., `service_requests.py`)
   - **Functions**: snake_case (e.g., `get_service_request_details`)
   - **Classes**: PascalCase (e.g., `ServiceRequestController`)

## Documentation Standards

1. **Code Documentation**:
   - Use docstrings for Python functions and classes
   - Add JSDoc comments for TypeScript functions and interfaces
   - Document complex logic with inline comments

2. **README Files**:
   - Include README files in major directories
   - Explain the purpose and organization of the directory
   - Provide examples of usage where appropriate

3. **API Documentation**:
   - Document API endpoints with parameters, responses, and examples
   - Use consistent formatting for API documentation

## Testing Standards

1. **Frontend Testing**:
   - Use Cypress for end-to-end testing
   - Place tests in the `cypress/` directory
   - Follow the Cypress best practices

2. **Backend Testing**:
   - Use Frappe's testing framework
   - Place tests in the appropriate test directories
   - Test both positive and negative scenarios

## Adding New Features

When adding new features to the Nirmaan Stack, follow these steps:

1. **Plan the Feature**:
   - Understand the requirements
   - Identify the components needed
   - Plan the data model and API endpoints

2. **Implement the Backend**:
   - Create or modify DocTypes
   - Implement API endpoints
   - Add business logic in controllers

3. **Implement the Frontend**:
   - Create or modify components
   - Implement data fetching and state management
   - Add routing and navigation

4. **Test the Feature**:
   - Test the API endpoints
   - Test the frontend components
   - Perform end-to-end testing

5. **Document the Feature**:
   - Update documentation
   - Add examples and usage instructions

By following these coding standards and best practices, you'll contribute to a consistent, maintainable, and high-quality codebase for the Nirmaan Stack.