/// <reference types="Cypress" />

const emailLogin = Cypress.env('login_Email');
const passwordLogin= Cypress.env('login_Password');

describe('login test', () => {
    it('Logs in the user and verifies successful login', () => {

        // Log credentials to ensure they are loaded
        cy.log(`Attempting login with Email: ${emailLogin}`);
        if (!emailLogin || !passwordLogin) {
            throw new Error("Email or Password environment variables are not set!");
        }

        cy.intercept('POST', '**/api/method/login').as('loginRequest');

        cy.visit('/login');

        // Wait for the login page to ensure the page is ready
        cy.contains('Login', { timeout: 10000 }).should('be.visible');

        // Typing into the email input field
        cy.get('[data-cy="username-login-input-email"]')
            .should('be.visible')
            .and('not.be.disabled')
            .type(emailLogin)
            .should('have.value', emailLogin);

        // Typing into the password input field
        cy.get('[data-cy="username-login-input-password"]')
            .should('be.visible')
            .and('not.be.disabled')
            .type(passwordLogin);

        // Clicking the login button
        cy.get('[data-cy="login-button"]')
            .should('be.visible')
            .click();

        // Wait for login request to finish and check status
        cy.wait('@loginRequest', { timeout: 15000 })
            .its('response.statusCode')
            .should('eq', 200);

        // Add a URL check to ensure navigation happened
        cy.url({ timeout: 10000 })
            .should('include', 'localhost:8080');

    });
});