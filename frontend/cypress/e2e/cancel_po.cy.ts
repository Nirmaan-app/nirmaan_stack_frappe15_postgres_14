/// <reference types="Cypress" />

// 1. -> Logs in,
// 2. -> Navigate to Purchase Orders then ( Approved PO Tab )
// 3. -> Clicks the first PO
// 4. -> Cancels or Deletes that Purchase Order
// 5. -> Validates in Rejected POs tab

const login_email = Cypress.env('login_Email');
const login_password = Cypress.env('login_Password');

describe('Cancels a Purchase Order and Checks for it in the Rejected Po tab --- End-to-End test flow', () => {

    beforeEach(() => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', { timeout: 3000 }).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(login_email);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(login_password);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', { timeout: 3000 }).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    // It's good practice to initialize env variables used across 'it' blocks if they might not always be set.
    // However, your logic to throw an error if not set is also a valid approach.
    // beforeEach(() => {
    //     Cypress.env('cancelled_sent_back_id', null);
    //     Cypress.env('poDeleted', false);
    // });


    it('Navigates to Purchase Orders, Clicks First PO, Cancels/Deletes it, and sets Env Variables', () => {

        // Navigating to Purchase Orders Module
        cy.get('[data-cy="purchase-orders-button"]')
            .should('be.visible')
            .click();

        cy.url().should('include', '/purchase-orders');

        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 10000 })
            .should('be.visible')
            .within(() => {
                cy.get('thead').should('exist');
                cy.contains('th', '#PO').should('be.visible');
                cy.contains('th', 'Created On').should('be.visible');
            });

        const tableBodySelector = '[data-cy="procurement-requests-data-table"] tbody';
        const poLinkSelectorInRow = 'a[href*="/purchase-orders/"]';

        cy.get(tableBodySelector, { timeout: 10000 })
            .should('be.visible') // Ensure tbody is visible before trying to find rows
            .then(($tbody) => {
                const $rows = $tbody.find('tr');

                if ($rows.length > 0) {
                    cy.log(`Table has ${$rows.length} PO(s). Processing the first one.`);

                    cy.wrap($rows.first())
                        .within(() => {
                            cy.get(poLinkSelectorInRow, { timeout: 16000 })
                                .first()
                                .should('be.visible', { timeout: 5000 })
                                .as('linkElementToClick');
                        });

                    cy.get('@linkElementToClick')
                        .scrollIntoView()
                        .then(($link) => {
                            cy.wrap($link).click();
                        });
                    
                    cy.log('Clicked on the first PO Link.');

                    // --- IMPORTANT: Wait for PO Details Page to load ---
                    // Replace '[data-cy="po-details-page-identifier"]' with a selector
                    // for a stable element that only appears on the PO details page.
                    cy.get('[data-cy="po-details-page-identifier"]', { timeout: 15000 }).should('be.visible');
                    cy.log('PO details page loaded.');


                    const cancelButtonSelector = '[data-cy="cancel-po-button"]';
                    const deleteButtonSelector = '[data-cy="delete-po-button"]';
                    const poDetailPageContainer = 'body';

                    cy.intercept('POST', '**/api/method/nirmaan_stack.api.handle_cancel_po.handle_cancel_po').as('cancelPoApiRequest');
                    // Add intercept for delete API if it's different and you need to wait for it too

                    cy.get(poDetailPageContainer, { timeout: 5000 }) // Ensure the container context is ready
                        .then(($detailPageBody) => {
                        // --- CORRECTED CONDITIONAL LOGIC ---
                        if ($detailPageBody.find(cancelButtonSelector).filter(':visible').length > 0) {
                            cy.log('Cancel PO button found. Clicking it.');
                            cy.get(cancelButtonSelector) // Use cy.get() for interaction
                                .should('be.visible')
                                .and('not.be.disabled')
                                .click();

                            cy.contains('h1', 'Are you sure!', { timeout: 5000 })
                                .should('exist').and('be.visible');

                            cy.get('[data-cy="cancel-po-comments-input"]')
                                .should('exist').and('be.visible').and('not.be.disabled').clear()
                                .type('This PO is Cancelled as a Result of " Cancel PO " end-to-end test flow...');
                            
                            // cy.get('[data-cy="cancel-po-dialog-cancel-button"]')... // If testing cancel of dialog

                            cy.pause();

                            cy.get('[data-cy="cancel-po-dialog-confirm-button"]', { timeout: 6000 })
                                .should('exist').and('be.visible').and('not.be.disabled')
                                .click(); // This click triggers the API

                            Cypress.env('poDeleted', false); // Set flag

                            cy.wait('@cancelPoApiRequest', { timeout: 16000 }).then((interception) => {
                                expect(interception.response?.statusCode).to.eq(200);
                                const responseBody = interception.response?.body;
                                expect(responseBody).to.have.nested.property('message.message');
                                const successMessage = responseBody.message.message;
                                const match = successMessage.match(/SB-\d{5,}-\d{6,}-(\d{5,})/);
                                if (match && match[1]) {
                                    const extracted_SB_Id = match[1];
                                    cy.log(`Extracted Sent Back Id: ${extracted_SB_Id}`);
                                    Cypress.env('cancelled_sent_back_id', extracted_SB_Id);
                                } else {
                                    cy.log('Could not extract targeted sent back id from success message:', successMessage);
                                    throw new Error('Failed to extract PO Identifier/Sent Back ID from cancellation response.');
                                }
                            });
                            cy.log('Cancel PO action completed and API response processed.');

                        } else if ($detailPageBody.find(deleteButtonSelector).filter(':visible').length > 0) {
                            cy.log('Cancel PO button not found. Delete button found. Clicking it.');
                            cy.get(deleteButtonSelector) // Use cy.get() for interaction
                                .should('be.visible')
                                .and('not.be.disabled')
                                .click();

                            cy.get('h2', {timeout: 5000}) // Wait for dialog header
                                .contains('Are you sure?')
                                .should('exist').and('be.visible');
                            
                            // cy.get('[data-cy="delete-po-dialog-cancel-button"]')... // If testing cancel of dialog

                            cy.pause();

                            cy.get('[data-cy="delete-po-dialog-confirm-button"]', {timeout: 6000})
                                .should('exist').and('be.visible').and('not.be.disabled')
                                .click();
                            
                            // Add API intercept and wait for delete if necessary
                            // e.g., cy.wait('@deletePoApiRequest')...

                            Cypress.env('poDeleted', true);
                            Cypress.env('cancelled_sent_back_id', null);
                            cy.log('Delete PO action initiated/completed.');

                        } else {
                            cy.screenshot('no_cancel_or_delete_button_on_details_page');
                            const errorMessage = 'Neither "Cancel PO" nor "Delete" button was found on the PO details page.';
                            cy.log(errorMessage);
                            throw new Error(errorMessage);
                        }
                    });

                } else {
                    const errorMessage = 'No PO present in the table for PO Canceling Process.';
                    cy.log(errorMessage);
                    Cypress.env('poDeleted', true);
                    Cypress.env('cancelled_sent_back_id', null);
                    throw new Error(errorMessage);
                }
            });
    });


    it('Navigates to Procurement Requests, Rejected PO tab and validates the Presence of Sent Back Id', () => {
        // This 'it' block will run regardless of errors in the previous one unless Cypress is stopped.
        // The poDeleted flag helps control its internal logic.

        const poWasDeleted = Cypress.env('poDeleted');
        cy.log(`Value of poDeleted from env: ${poWasDeleted}`);

        if (poWasDeleted === true) { // Explicitly check for true
            cy.log('PO was marked as deleted in the previous step, or no POs were found. Skipping Rejected PO check.');
            // this.skip(); // Use this to actually skip the test if Cypress.env('poDeleted') is true
            return; // Or just return to prevent further execution in this block
        }
      
        const targetSbId = Cypress.env('cancelled_sent_back_id');
        cy.log(`Value of targetSbId from env: ${targetSbId}`);

        if (!targetSbId) {
            cy.log('Cancelled Sent Back ID not found in env. This might be expected if PO was deleted or an error occurred earlier.');
            // Depending on your test design, you might throw an error here or just log and let the test pass if this is an acceptable state.
            // For now, let's assume if poWasDeleted is false, targetSbId MUST exist.
            throw new Error('Cancelled Sent Back ID (cancelled_sent_back_id) was not found in Cypress.env, but PO was not marked as deleted.');
        }

        cy.log(`Attempting to find Sent Back ID: ${targetSbId} in the Rejected POs table.`);

        cy.get('[data-cy="procurement-requests-button"]')
            .should('exist').and('be.visible').click();

        cy.get('[data-cy="rejected-po-navigation"]')
            .should('exist').and('be.visible').click();

        cy.get('[data-cy="procurement-requests-search-bar"]', {timeout: 10000}).should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]', {timeout: 10000})
            .should('be.visible')
            .within(() => {
                cy.get('thead').should('exist');
                // cy.get('tbody tr').should('have.length.at.least', 1); // This can be flaky if table is empty
                cy.contains('th', 'SB ID').should('be.visible');
                cy.contains('th', 'Date Created').should('be.visible');
            });

        const tableSelector = '[data-cy="procurement-requests-data-table"]';

        cy.pause();

        cy.get(tableSelector, { timeout: 15000 })
            .contains('td', targetSbId, { timeout: 20000 }) // Find cell containing the ID
            .should('be.visible')
            .then(($cellContainingId) => {
                cy.log(`Found cell containing Sent Back ID: ${targetSbId}`);
                cy.wrap($cellContainingId).parent('tr').should('exist').as('targetRow');
                cy.log(`Found row for Sent Back ID: ${targetSbId}`);

                // Assuming the link is the SB ID itself or is in the same cell.
                // If link is different, adjust find() selector.
                cy.get('@targetRow')
                    .find(`a:contains("${targetSbId}")`) // Find link in the row containing the ID
                    .should('be.visible')
                    .click();
                cy.log(`Clicked on the link for Sent Back ID: ${targetSbId}.`);
            });
    });
});