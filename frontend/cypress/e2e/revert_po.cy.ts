/// <reference types="Cypress" />

const email_ap = Cypress.env('login_Email');
const password_ap = Cypress.env('login_Password');

describe('Revert a PO ( Conditionally )', () => {
    beforeEach(() => {
        // --- Logging In ---
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');
        cy.contains('Login', { timeout: 3000 }).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(email_ap);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(password_ap);
        cy.get('[data-cy="login-button"]').should('be.visible').click();
        cy.wait('@loginRequest', { timeout: 3000 }).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Navigate to Dispatched POs tab and Revert a PO if possible', () => {

        // --- Navigation to PO list and clicking the first PO ---
        cy.get('[data-cy="purchase-orders-button"]').should('be.visible').click();
        cy.url().should('include', '/purchase-orders');
        cy.get('[data-cy="dispatched-po-navigation"]').should('exist').and('be.visible').and('not.be.disabled').click();
        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 6000 }).should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]').find('tbody tr').first().find('td').first().find('a[href*="/purchase-orders/"]').click();

        // --- Conditionally Check and Attempt to Click Revert Button ---
        const revertButtonSelector = '[data-cy="po-details-revert-button"]';
        
        // Waiting for the context of the button to be stable and Be Visible 
        cy.get('[data-cy="po-details-page-identifier"]', { timeout: 10000 }).should('be.visible');

        cy.get('body').then(($body) => {
            if ($body.find(revertButtonSelector).length > 0) {
                cy.get(revertButtonSelector, { timeout: 5000 })
                    .should('be.visible')
                    .and('not.be.disabled')
                    .then(($button) => {
                        // Executing .then() block only if the button is visible and enabled
                        cy.log('Revert PO button is available and enabled. Proceeding with revert.');
                        cy.wrap($button).click();

                        // ---- Validating Revert Po's Dialog Box ----
                        cy.get('[data-cy="revert-po-dialog-text"]')
                            .should('exist')
                            .and('be.visible')
                            .and('have.text', 'Are you sure?');

                        cy.get('[data-cy="revert-po-dialog-cancel-button"]')
                            .should('exist')
                            .and('be.visible')
                            .and('not.be.disabled');
                        
                        cy.log('--- Setting up intercept for PO details PUT request after revert ---');
                        cy.intercept('PUT', '**/api/resource/Procurement%20Orders/**').as('revertedPoDetailsRequest');

                        cy.get('[data-cy="revert-po-dialog-confirm-button"]')
                            .should('exist')
                            .and('be.visible')
                            .and('not.be.disabled')
                            .click(); 

                        let extractedPoNumber;

                        cy.wait('@revertedPoDetailsRequest', { timeout: 15000 }).then((interception) => {
                            expect(interception.response?.statusCode).to.equal(200);
                            const requestUrl = interception.request.url;
                            const urlParts = requestUrl.split('/');
                            if (urlParts.length > 0) {
                                extractedPoNumber = decodeURIComponent(urlParts[urlParts.length - 1]);
                                cy.log(`Extracted PO Number from API (PUT request URL): ${extractedPoNumber}`);
                            } else {
                                cy.log('Could not parse PO Number from PUT request URL.');
                                throw new Error('Failed to parse PO Number from PUT request URL for revert action.');
                            }
                        });

                        cy.log('--- Navigating to Approved PO Tab and Verifying the Reverted PO ---');

                        // Clicking Go Back Button to get Tab Options/Buttons
                        cy.get('[data-cy="go-back-button"]')
                            .should('exist')
                            .and('be.visible')
                            .click();

                        cy.then(() => {
                            if (!extractedPoNumber) {
                                cy.log('PO Number was not extracted. Skipping verification in "Approved PO" tab.');
                                throw new Error('Cannot proceed without extracted PO Number.');
                            }

                            cy.get('[data-cy="go-back-button"]').should('exist').and('be.visible').click();
                            cy.get('[data-cy="approved-po-navigation"]', { timeout: 10000 }).should('exist').and('be.visible').click();

                            cy.contains('[data-cy="procurement-requests-data-table"] tbody tr td', extractedPoNumber, { timeout: 15000 })
                                .should('be.visible')
                                .closest('tr')
                                .find('a')
                                .first() 
                                .click();

                            cy.log(`Reverted PO Successfully found in the Approved PO Tab with the PO Number as: -> ${extractedPoNumber}`);
                        });
                    
                    });
            } else {
                // This means $body.find()is unable to find the element AT ALL in the DOM.
                cy.log('Revert PO button does not exist in the DOM. PO cannot be reverted (possibly due to payment conditions). Ending test for this PO.');
            }
        });
    });
});