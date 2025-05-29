# Nirmaan Stack Architecture Diagram

This document provides visual representations of the Nirmaan Stack architecture to help developers understand the system structure and component interactions.

## Directory Structure

```mermaid
graph TD
    A[frappe-bench/apps/nirmaan_stack] --> B[frontend/]
    A --> C[nirmaan_stack/]
    
    B --> B1[src/]
    B --> B2[public/]
    B --> B3[cypress/]
    
    B1 --> B1A[components/]
    B1 --> B1B[pages/]
    B1 --> B1C[hooks/]
    B1 --> B1D[services/]
    B1 --> B1E[utils/]
    B1 --> B1F[zustand/]
    
    C --> C1[api/]
    C --> C2[nirmaan_stack/]
    C --> C3[integrations/]
    C --> C4[services/]
    C --> C5[templates/]
    
    C2 --> C2A[doctype/]
    
    C2A --> C2A1[projects/]
    C2A --> C2A2[procurement_requests/]
    C2A --> C2A3[procurement_orders/]
    C2A --> C2A4[service_requests/]
    C2A --> C2A5[vendors/]
    
    C3 --> C3A[controllers/]
    C3 --> C3B[firebase/]
    C3 --> C3C[Notifications/]
```

## Component Interaction

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant Backend
    participant Database
    
    User->>Frontend: Interacts with UI
    Frontend->>API: Makes API request
    API->>Backend: Processes request
    Backend->>Database: CRUD operations
    Database-->>Backend: Return data
    Backend-->>API: Format response
    API-->>Frontend: Return response
    Frontend-->>User: Update UI
```

## Service Request Workflow

```mermaid
stateDiagram-v2
    [*] --> Created
    Created --> UnderReview: Submit for review
    UnderReview --> Rejected: Reject
    UnderReview --> VendorSelected: Select vendor
    Rejected --> Resolved: Resolve issues
    Resolved --> UnderReview: Resubmit
    VendorSelected --> Approved: Approve
    Approved --> [*]
```

## Procurement Workflow

```mermaid
stateDiagram-v2
    [*] --> Created
    Created --> UnderReview: Submit for review
    UnderReview --> Rejected: Reject
    UnderReview --> Approved: Approve
    Rejected --> Resolved: Resolve issues
    Resolved --> UnderReview: Resubmit
    Approved --> QuotationRequested: Request quotations
    QuotationRequested --> QuotationReceived: Receive quotations
    QuotationReceived --> QuotationApproved: Approve quotation
    QuotationApproved --> POCreated: Create PO
    POCreated --> [*]
```

## Data Flow Architecture

```mermaid
flowchart TD
    subgraph Frontend
        React[React Components]
        Hooks[Custom Hooks]
        State[Zustand State]
        Query[React Query]
    end
    
    subgraph Backend
        API[API Endpoints]
        Controllers[Controllers]
        DocTypes[DocTypes]
        Services[Services]
    end
    
    subgraph Database
        MariaDB[MariaDB]
    end
    
    React <--> Hooks
    Hooks <--> State
    Hooks <--> Query
    Query <--> API
    API <--> Controllers
    Controllers <--> DocTypes
    Controllers <--> Services
    DocTypes <--> MariaDB
```

## Frontend Component Structure

```mermaid
flowchart TD
    App[App.tsx] --> Layout[Layout]
    Layout --> Pages[Pages]
    Layout --> Nav[Navigation]
    
    Pages --> Dashboard[Dashboard]
    Pages --> Projects[Projects]
    Pages --> Procurement[Procurement]
    Pages --> ServiceRequests[Service Requests]
    Pages --> Payments[Payments]
    
    subgraph Components
        UI[UI Components]
        Forms[Form Components]
        Tables[Table Components]
    end
    
    Dashboard --> UI
    Projects --> UI
    Projects --> Forms
    Projects --> Tables
    Procurement --> UI
    Procurement --> Forms
    Procurement --> Tables
    ServiceRequests --> UI
    ServiceRequests --> Forms
    ServiceRequests --> Tables
    Payments --> UI
    Payments --> Forms
    Payments --> Tables
```

## Backend Integration Points

```mermaid
flowchart TD
    subgraph Frappe
        Hooks[hooks.py]
        DocEvents[Document Events]
        API[API Endpoints]
        Templates[Templates]
    end
    
    subgraph NirmaanStack
        Controllers[Controllers]
        Services[Services]
        DocTypes[DocTypes]
        Integrations[Integrations]
    end
    
    subgraph ExternalSystems
        Firebase[Firebase]
        Notifications[Notifications]
    end
    
    Hooks --> DocEvents
    DocEvents --> Controllers
    API --> Controllers
    Controllers --> Services
    Controllers --> DocTypes
    Integrations --> Firebase
    Integrations --> Notifications
```

These diagrams provide a visual representation of the Nirmaan Stack architecture, helping developers understand the system structure and component interactions.