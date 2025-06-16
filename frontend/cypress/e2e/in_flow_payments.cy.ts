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
    });
});