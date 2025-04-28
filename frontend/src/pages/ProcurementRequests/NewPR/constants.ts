// src/features/procurement-requests/constants.ts

export const PR_STORE_KEY = 'procurement-request-storage';

export enum PageState {
    LOADING = 'loading',
    WP_SELECTION = 'wp-selection',
    ITEM_SELECTION = 'item-selection',
    ERROR = 'error',
}

export enum ItemStatus {
    PENDING = 'Pending',
    REQUEST = 'Request',
    APPROVED = 'Approved',
    REJECTED = 'Rejected',
}