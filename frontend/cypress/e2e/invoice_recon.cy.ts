/// <reference types="Cypress" />

describe('Approves an Invoice', () => {
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

    it('Navigates to Invoice Recon Module and Approves an Invoice', () => {

        // Navigating to Invoice Recon Module
        cy.get('[data-cy="invoice-recon-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // Using Search Bar Presence for making the Tab Stable and Interacted
        cy.get('[data-cy="procurement-requests-search-bar"]', { timeout: 16000})
            .should('be.visible');

        // Clicking Approve Invoice Button from First Row
        // Reject Button
        cy.get('[data-cy="reject-invoice-button"]')
            .first()
            .scrollIntoView()
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            // .click();

        // Approve Button
        cy.get('[data-cy="approve-invoice-button"]')
            .first()
            .scrollIntoView()
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // --- Validate Cancel Button ---
        cy.contains('button', 'Cancel')
            .should('be.visible')
            .and('not.be.disabled')
            .find('svg.lucide-undo2')
            .should('be.visible');

        cy.log('Cancel button validated.');

        // --- Validate Approve Button ---
        cy.contains('button', 'Approve')
            .as('approveButton')
            .should('be.visible')
            .and('not.be.disabled')
            .find('svg.lucide-check-check')
            .should('be.visible')
            .click();
        cy.log('Approve button validated.');

        cy.log('Approved Invoice Successfully...')

        });
});