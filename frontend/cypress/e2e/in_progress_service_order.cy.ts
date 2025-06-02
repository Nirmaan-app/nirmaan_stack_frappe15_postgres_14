/// <reference types="Cypress" />

const emailIpSr = Cypress.env('login_Email');
const passwordIpSr = Cypress.env('login_Password')

describe('Test Flow for In Progress Service Order ', () => {

    beforeEach(() => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailIpSr);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(passwordIpSr);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });


    it('Handles a in progress service and sends it for approval', {
        
    })

});