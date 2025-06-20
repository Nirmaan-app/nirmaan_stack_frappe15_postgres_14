/// <reference types="Cypress" />

describe('Adding Project Invoice', () => {

    beforeEach(() => {

        // --- Logging In ---
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');
        cy.contains('Login', { timeout: 3000 }).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(Cypress.env('login_Email'));
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(Cypress.env('login_Password'));
        cy.get('[data-cy="login-button"]').should('be.visible').click();
        cy.wait('@loginRequest', { timeout: 3000 }).its('response.statusCode').should('eq', 200);
    });

    it('Adds Project Invoice', () => {

        let invoice_number_to_enter = 'TPC/25-26/01508'
        // Navigating to Project Invoices 
        cy.get('[data-cy="project-invoices-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Fetching and Clicking Add Project Invoice Button
        cy.get('[data-cy="add-project-invoice-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .should('have.text', 'Add PROJECT INVOICE')
            .click();

        cy.get('[data-cy="project-select-dropdown"]')
            .click()
            .type('Test Project - Bangalore Office')
            .type('{enter}');

       cy.get('[data-cy="invoice-no-input"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .type(invoice_number_to_enter)
            .should('have.value', invoice_number_to_enter)

        // Getting Date Format For Input
        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');

        // Format for <input type="date">: YYYY-MM-DD
        const formattedDateForDateInput = `${year}-${month}-${day}`;
        cy.log(`Formatted date to type: ${formattedDateForDateInput}`);

        cy.get('[data-cy="date-input"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .clear()
            .type(formattedDateForDateInput)
            .should('have.value', formattedDateForDateInput);

        cy.get('[data-cy="amount-input"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .type('60000')
            .should('have.value', '60000');

        // Invoice File Name from Fixtures
        const fixtureFileName = 'Sales_TPC_25-26_01508.pdf';
        
        // --- Uploading the file ---
        cy.contains('label', 'Attach Invoice')
            .find('input[type="file"]')
            .should('exist')
            .selectFile(`cypress/fixtures/${fixtureFileName}`, {force: true});

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
            // .pause()
            .click();

        cy.contains('Success!')
            .should('exist')
            .and('be.visible');

        cy.log(`Added Invoice Successfully with Invoice Number as: -> ${invoice_number_to_enter} and File Name as: -> ${fixtureFileName} ...`);

    });


});