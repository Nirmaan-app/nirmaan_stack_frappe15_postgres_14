/// <reference types="Cypress" />

const emailSr = Cypress.env('login_Email');
const passwordSr = Cypress.env('login_Password')

describe('Test Flow for Approving a Service Order ', () => {

    beforeEach(() => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailSr);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(passwordSr);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('should navigate to the Service Orders page', () => {

        // Step 1: Validate the Service Orders button exists and is visible
        cy.get('[data-cy="service-requests-button"]')
            .should('be.visible')
            .and('contain.text', 'Service Requests')
            // .and('have.class', 'bg-[#FFD3CC]')
            // .and('have.class', 'text-[#D03B45]');

        // Step 2: Click the button to go to the Service Orders page
        cy.get('[data-cy="service-requests-button"]')
            .click();

        // Step 3: Confirm navigation occurred
        cy.url().should('include', '/service-requests');
        cy.contains('SERVICE-REQUESTS')
            .should('exist')
            .and('be.visible');
    });

    it('Navigates to Service Orders Page and Approves a Service Order', () => {

        // Validating Service Requests Button from sidebar
        cy.get('[data-cy="service-requests-button"]')
            .should('be.visible')
            .and('contain.text', 'Service Requests');

        // Navigating to Purchase Orders Page
        cy.get('[data-cy="service-requests-button"]')
            .click();

        // Validationg Navigation 
        cy.url().should('include', '/service-requests');
        cy.contains('SERVICE-REQUESTS')
            .should('exist')
            .and('be.visible');

        // Validating Approve PO Navigation Button is Active
        cy.get('[data-cy="approve-service-order-button"]')
            .should('be.visible')
            .closest('label')
            .should('have.class', 'ant-radio-button-wrapper-checked')
            .find('input[type="radio"]')
            .should('be.checked');

        // Search Bar Presence
        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Data Table for Service Orders Presence
        cy.get('[data-cy="procurement-requests-data-table"]')
            .should('exist')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#SR')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });


            // Base Url 
            const baseUrl = Cypress.config('baseUrl');

            // Store PR details befor navigation
            let prNumber, expectedUrl

            // Get the first PR link Details
            cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
                .first()
                .within( () => {
                    cy.get('a[href^="/service-requests/SR-"]')
                        .should('be.visible')
                        .then(($link) => {
                            prNumber = $link.text().trim();
                            const href = $link.attr('href');
                            expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                            // Clicking on the PR Link ( For Navigation )
                            cy.wrap($link).click();
                        });
                });

            // After navigation Verifying the new page
            cy.url()
                .then(currentUrl => {
                    const decodedCurrentUrl = decodeURIComponent(currentUrl);
                    expect(decodedCurrentUrl).to.include(expectedUrl);
                })

            // Verify page content on the page
            cy.log(prNumber);

            cy.contains('Approve/Reject', { timeout: 10000 })
                .should('be.visible');

            // Reject Pr Button
            cy.get('button')
                .contains('Reject')
                .should('be.visible')
                .and('contain', 'Reject')
                .and('have.attr', 'type', 'button')
                .click();

                // Reject Service Request Dialog
                // Wait for dialog to appear and verify its content
                cy.get('[role="alertdialog"]')
                    .should('be.visible')
                        .within(() => {
                            // Verify dialog title and message
                            cy.contains('h2', 'Are you Sure?')
                                .should('be.visible');
                            cy.contains('p', 'Add Comments and Reject.')
                                .should('be.visible');

                            // Fill in the comment textarea
                            cy.get('textarea#textarea')
                                .should('be.visible')
                                .and('have.attr', 'placeholder', 'type here...')
                                .type('This PR is rejected by Test - Automation flow...');

                            // Click Cancel button
                            cy.get('button')
                                .contains(/^Cancel$/)
                                .should('be.visible')
                                .and('contain', 'Cancel')
                                .click();
                        });

                        // Dialog should be Closed after Clicking Cancel
                        cy.get('[role="alertdialog"]')
                            .should('not.exist');

                        cy.get('button')
                            .contains('Reject')
                            .should('be.visible')
                            .and('contain', 'Reject')
                            .and('have.attr', 'type', 'button')
                            .click();
                            
                            cy.get('[role="alertdialog"]')
                                    .within(() => {
                                        // Verify dialog title and message
                                        cy.contains('h2', 'Are you Sure?')
                                            .should('be.visible');
                                        cy.contains('p', 'Add Comments and Reject.')
                                            .should('be.visible');

                                        // Fill in the comment textarea
                                        cy.get('textarea#textarea')
                                            .should('be.visible')
                                            .and('have.attr', 'placeholder', 'type here...')
                                            .type('This PR is rejected by Test - Automation flow...');

                                        // Click Confirm button
                                        cy.get('button')
                                            .contains(/^Confirm$/)
                                            .should('be.visible')
                                            .and('contain', 'Confirm')
                                            // .click();
                                        
                                        // Clicking Cancel button rather than Confirm button So tht SR doesn't get Rejected
                                        cy.get('button')
                                            .contains(/^Cancel$/)
                                            .should('be.visible')
                                            .and('contain', 'Cancel')
                                            .click();
                                    });

                                    // Dialog should be Closed after Clicking Cancel
                                    cy.get('[role="alertdialog"]')
                                        .should('not.exist');


            // Approve Sr Button
            cy.get('button')
                .contains('Approve')
                .should('be.visible')
                .click();

                // Approve Service Request Dialog
                // Wait for dialog to appear and verify its content
                cy.get('[role="alertdialog"]')
                    .should('be.visible')
                        .within(() => {
                            // Verify dialog title and message
                            cy.contains('h2', 'Are you Sure?')
                                .should('be.visible');
                            cy.contains('p', 'Click on Confirm to Approve.')
                                .should('be.visible');

                            // Test Cancel button first (left button)
                            cy.get('button')
                                .contains(/^Cancel$/)
                                .should('be.visible')
                                .and('contain', 'Cancel')
                                .click();
                        });

                        // Dialog should be closed after Cancel
                        cy.get('[role="alertdialog"]')
                            .should('not.exist');

                        // Re-open dialog by clicking Approve again
                        cy.get('button')
                            .contains('Approve')
                            .should('be.visible')
                            .click();

                            cy.get('[role="alertdialog"]')
                                    .within(() => {
                                        // Testing Confirm button
                                        // Verify dialog title and message
                                        cy.contains('h2', 'Are you Sure?')
                                            .should('be.visible');
                                        cy.contains('p', 'Click on Confirm to Approve.')
                                            .should('be.visible');

                                        // Test Cancel button first (left button)
                                        cy.get('button')
                                            .contains(/^Confirm$/)
                                            .should('be.visible')
                                            .and('contain', 'Confirm')
                                            .click();
                                    });

                                    // Dialog should be closed after Cancel
                                    cy.get('[role="alertdialog"]')
                                        .should('not.exist');
        
    });

});