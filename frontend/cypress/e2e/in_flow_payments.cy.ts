/// <reference types="Cypress" />

describe('In Flow Payments', () => {
    beforeEach(() => {
        // --- Logging In ---
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', { timeout: 3000 }).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(Cypress.env('login_Email'));
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(Cypress.env('login_Password'));
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', { timeout: 3000 }).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Adds New Inflow under In-Flow Payments Module', () => {

        // Navigated to In-flow Payments Module...
        cy.get('[data-cy="in-flow-payments-button"]', { timeout: 9000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();
        
        // Using Search Bar Presence for making the Module/Tab Stable and Interacted
        cy.get('[data-cy="procurement-requests-search-bar"]', { timeout: 16000})
            .should('be.visible');

        cy.get('[data-cy="add-new-inflow-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // Validating Record New Inflow Payments Dialog and Placing Required Values
        cy.get('[data-cy="add-new-inflow-dialog-text"]')
            .should('exist')
            .and('be.visible');

        const dropdownSelector = '[data-cy="add-new-inflow-dropdown"]';
        const textToType = 'Test Project';
        const amount = '60000';
        const Utr_Ref_No = 'SBIN323032038826';

        cy.log(`Attempting to select project containing "${textToType}"`);

         // 1. Click the dropdown to open it
        cy.get(dropdownSelector).click();

        cy.get(dropdownSelector)
            .find('input[id^="react-select-"]')
            .should('be.visible')
            .type(textToType, { force: true, delay: 100 });

        cy.contains('[id^="react-select-"]', 'Test Project - Bangalore Office', { timeout: 5000 })
            .should('be.visible')
            .click();

        cy.get('[data-cy="add-new-inflow-amount-input"]')
            .should('exist')
            .and('be.visible')
            .type(amount);

        cy.get('[data-cy="add-new-inflow-payment-ref-input"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .type(Utr_Ref_No);

        cy.get('[data-cy="new-inflow-cancel-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled');
            // .click();

        cy.get('[data-cy="new-inflow-add-payment-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.contains('Inflow payment added successfully')
            .should('exist')
            .and('be.visible');

        cy.log(`Inflow payment added successfully with Utr/Ref no. as:   -> ${Utr_Ref_No}`);
        
    });
});