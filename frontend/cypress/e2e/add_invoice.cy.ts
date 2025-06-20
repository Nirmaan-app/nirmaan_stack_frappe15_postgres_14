/// <reference types="Cypress" />

const email_apo = Cypress.env('login_Email');
const password_apo = Cypress.env('login_Password');

describe('Add Invoice for a PO', () => {

    beforeEach( () => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(email_apo);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(password_apo);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Navigate to Dispatched POs tab and Add Invoice for a PO', () => {

        // Navigation to Purchase Orders Module
        cy.get('[data-cy="purchase-orders-button"]')
            .should('be.visible')
            .click();

        cy.url().should('include', '/purchase-orders');

        cy.get('[data-cy="dispatched-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 6000 })
            .should('be.visible')
            .within(() => {
                cy.get('thead').should('exist');
                cy.contains('th', '#PO').should('be.visible');
                cy.contains('th', 'Created On').should('be.visible');
            });

        // Clicking the first PO present in the Table
        cy.get('[data-cy="procurement-requests-data-table"]')
            .find('tbody')
            .find('tr')
            .first()
            .find('td')
            .first()
            .find('a[href*="/purchase-orders/"]')
            .click();

        
        // Variable to store the cleaned amount
        let invoiceAmountToUse;

        cy.get('[data-cy="total-amount-incl-gst"]')
            .find('span')
            .invoke('text')
            .then((rawAmountText) => {
                cy.log(`Raw amount text from page: ${rawAmountText}`);

                const cleanedAmount = rawAmountText
                .replace('₹', '')
                .replace(/,/g, '');
            
            invoiceAmountToUse = cleanedAmount;
            cy.log(`Cleaned amount to use for invoice: ${invoiceAmountToUse}`);
            cy.pause();

        });


        // Fetching and Clicking Add Invoice button
        cy.get('[data-cy="po-details-dd-invoice-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // Declaring the Invoice number to use
        const invoiceNumber = 'TPC/25-26/01508';

        // Entering Invoive Number in the Invoice Number Input Field
        cy.get('[data-cy="add-invoice-invoice-number-input"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type(invoiceNumber);

        
        // --- Get and format the current date ---
        const today = new Date();

        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');

        const formattedDate = `${year}-${month}-${day}`; // YYYY-MM-DD format

        cy.log(`Formatted current date: ${formattedDate}`);

        // --- Interact with the date input field ---
        cy.get('[data-cy="add-invoice-date-input"]')
            .should('be.visible')
            .type(formattedDate)
            .should('have.value', formattedDate);
        
        // Filling Amount extracted from the PO Details Card
        cy.then(() => {
                if (invoiceAmountToUse) {
                    cy.log(`Now filling invoice amount with: ${invoiceAmountToUse}`);
                    cy.get('[data-cy="add-invoice-amount-input"]').type(invoiceAmountToUse);
                    cy.get('[data-cy="add-invoice-amount-input"]').should('have.value', invoiceAmountToUse);
                } else {
                    throw new Error('Invoice amount was not extracted successfully.');
                }
            });
    
        const fixtureFileName = 'Sales_TPC_25-26_01508.pdf';
        
        // --- Uploading the file ---
        cy.contains('label', 'Attach Invoice')
            .find('input[type="file"]')
            .should('exist')
            .selectFile(`cypress/fixtures/${fixtureFileName}`, { force: true });

        // Checking for File Upload
        cy.contains(fixtureFileName).should('be.visible');

        // Validating Cancel and Confirm button
        cy.get('[data-cy="add-invoice-cancel-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            // .click();

        cy.get('[data-cy="add-invoice-confirm-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .pause()
            .click();

        cy.contains('Successfully updated invoice data')
            .should('exist')
            .and('be.visible');

        cy.log(`Added Invoice Successfully with Invoice Number as: -> ${invoiceNumber} and File Name as: -> ${fixtureFileName} ...`)
            
    });

});