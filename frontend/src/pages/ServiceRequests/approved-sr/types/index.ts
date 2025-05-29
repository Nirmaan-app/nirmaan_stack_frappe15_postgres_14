export interface NoteItem { // Already defined in useSREditTerms, can be shared
    id: string;
    note: string;
}

export interface NewPaymentFormState {
    amount: string;
    payment_date: string;
    utr: string;
    tds: string;
}