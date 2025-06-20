/// <reference types="Cypress" />

// Test Suite: Merging a Purchase Order (PO)
// This suite focuses on the PO merging functionality.
// It includes:
// - Logging into the application.
// - Navigating to the Purchase Orders module.
// - Selecting a PO from the "Approved POs" list.
// - Conditionally attempting to merge the selected PO:
//   - If the "Merge PO" button is available, it proceeds with the merge process.
//   - This involves interacting with a merge dialog, selecting POs to merge,
//     and confirming the merge action.
//   - It intercepts the API call made during the merge to extract the new (merged) PO number.
//   - After merging, it navigates back to the "Approved POs" list to verify the
//     newly merged PO is present and clickable.
//   - If the "Merge PO" button is not available for the selected PO, it logs it
//     and concludes the merge attempt for that PO.

describe('Merging a PO (Conditionally)', () => {

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

    it('merges a PO if the merge button is available, otherwise logs and concludes', () => { 

        // --- Extracted new_po_name ---
        let newMergedPoNumber;

        // --- Navigation to Purchase Orders Module ---
        cy.log('Navigating to Purchase Orders Module');
        cy.get('[data-cy="purchase-orders-button"]')
            .should('be.visible')
            .click();
        cy.url().should('include', '/purchase-orders');

        // --- Navigate to Approved POs Tab ---
        cy.log('Navigating to Approved POs Tab');
        cy.get('[data-cy="approved-po-navigation"]').should('be.visible').and('not.be.disabled').click();

        // --- Wait for PO List Table to Load ---
        cy.log('Waiting for PO list table to load');
        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 6000 }).should('be.visible');

        // --- Clicking the first PO present in the Table ---
        cy.log('Clicking the first PO in the table');
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
            .first()
            .find('td')
            .first()
            .find('a[href*="/purchase-orders/"]')
            .click();

        cy.log('Waiting for PO details page to stabilize');

        cy.get('[data-cy="total-amount-incl-gst"]', { timeout: 16000 })
            .should('be.visible');

        // cy.pause();

        // --- Conditionally attempting to Merge PO ---
        const mergePoButtonSelector = '[data-cy="merge-po-button"]';

        // Waiting for the body to be ready, then checking for the button
        cy.get('body', { timeout: 7000 }).then(($body) => {
            // Checking if the button exists in the DOM, is visible, and is enabled
            if ($body.find(mergePoButtonSelector).length > 0 &&
                $body.find(mergePoButtonSelector).is(':visible') &&
                !$body.find(mergePoButtonSelector).is(':disabled')) {

                cy.log('Merge PO button is available and enabled. Proceeding with merge process.');
                cy.get(mergePoButtonSelector).click();

                // --- Actions within the Merge PO Dialog/Process ---
                cy.log('Interacting with Merge PO dialog.');

                // Merge Button (inside the dialog)
                cy.get('[data-cy="merge-po-dialog-text"]', { timeout: 5000 }).should('be.visible');
                
                // cy.get('[data-cy="dialog-box-po-merger-button"]')
                //     .should('be.visible')
                //     .and('not.be.disabled')
                //     .click();

                // Updated Approach for Clicking Merge Po Buttons
                // Getting all "dialog-box-po-merger-button" elements and clicking each one
                cy.get('[data-cy="dialog-box-po-merger-button"]', { timeout: 5000 })
                    .should('exist')
                    .each(($el, index, $list) => {
                        cy.log(`Processing merge selection button #${index + 1}`);
                        cy.wrap($el)
                            .scrollIntoView()
                            .should('be.visible')
                            .click({force: true});
                            
                    });
                
                cy.log('Clicked all available PO selection/merger buttons inside the dialog.');
                
                cy.get('[data-cy="po-details-preview-button"]', { timeout: 10000 })
                    .should('be.visible')
                    .and('not.be.disabled')
                    // .click();

                cy.log('Preview button is visible and enabled.');
                
                
                // Confirm Button to Finally Merge The PO
                cy.log('Attempting to click final merge confirmation button.');

                cy.get('[data-cy="dialog-box-po-merge-confirm-button"]', { timeout: 10000 })
                    .should('be.visible')
                    .and('not.be.disabled')
                    .click();

                // Merge PO Confirm Dialog Box
                cy.get('[data-cy="merger-confirm-dialog-text"]')
                    .should('exist')
                    .and('be.visible');

                // Merge PO Confirm Dialog Box Cancel Button
                cy.get('[data-cy="merge-po-cancel-button"]')
                    .should('exist')
                    .and('be.visible')
                    .and('not.be.disabled')
                    // .click();


                // --- Setting up the intercept for the PO Merge API call ---
                cy.log('--- Setting up intercept for handle_merge_pos POST request ---');

                cy.intercept(
                    'POST',
                    '**/api/method/nirmaan_stack.api.po_merge_and_unmerge.handle_merge_pos'
                ).as('handleMergePosRequest');

                // Merge PO Confirm Dialog Box Confirm Button
                cy.get('[data-cy="merge-po-confirm-button"]')
                    .should('exist')
                    .and('be.visible')
                    .and('not.be.disabled')
                    .click();


                // --- Waiting for handle_merge_pos response, logging it, and extracting new PO Number ---
                cy.log('--- Waiting for handle_merge_pos response ---');

                cy.wait('@handleMergePosRequest', { timeout: 20000 })
                    .then((interception) => {
                        cy.log('Intercepted handle_merge_pos API Call Details:');
                        cy.log('Request URL:', interception.request.url);
                        // cy.log('Request Body:', JSON.stringify(interception.request.body));
                        cy.log('Response Status Code:', interception.response?.statusCode);
                        
                        // Logging to Cypress Command Log (stringified)
                        try {
                            cy.log('Response Body (Cypress Log):', JSON.stringify(interception.response?.body, null, 2));
                        } catch (e) {
                            cy.log('Response Body (Cypress Log - could not stringify):', interception.response?.body);
                        }

                        // Asserting the status code
                        expect(interception.response?.statusCode).to.be.oneOf([200, 201, 204], 'Expected merge API call to succeed');

                        if (interception.response?.body &&
                            interception.response.body.message &&
                            typeof interception.response.body.message === 'object' &&
                            interception.response.body.message.new_po_name) {
                            
                            newMergedPoNumber = interception.response.body.message.new_po_name;
                            cy.log(`Successfully extracted new_po_number: ${newMergedPoNumber}`);
                            
                            // cy.pause();

                            // Storing it in Cypress.env
                            Cypress.env('newlyMergedPoNumber', newMergedPoNumber);
                            cy.log(`Cypress.env('newlyMergedPoNumber') set to: ${Cypress.env('newlyMergedPoNumber')}`);

                        } else {
                            cy.log('Could not extract new_po_name from the response. Response structure might be different than expected.');
                            throw new Error('Failed to extract new_po_name from merge API response.');
                        }
                    })
                    .then(() => {

                        const newPoToFind = Cypress.env('newlyMergedPoNumber');

                        if (!newPoToFind) {
                            cy.log('ERROR: newlyMergedPoNumber is undefined after API call.');
                            throw new Error('Cannot proceed: newlyMergedPoNumber was not set in Cypress.env correctly.');
                        }

                        cy.log('--- Waiting for UI to stabilize after PO merge operation ---');
                        cy.get('body', { timeout: 15000 }) 
                            .should('not.have.css', 'pointer-events', 'none');
                        cy.log('Body is now interactive.');


                        cy.get('[data-cy="purchase-orders-button"]')
                            .should('exist')
                            .and('be.visible')
                            .and('not.be.disabled')
                            .click();

                        cy.get('[data-cy="approved-po-navigation"]', { timeout: 16000 })
                            .should('exist')
                            .and('be.visible')
                            .and('not.be.disabled')
                            .click();


                        // Ensuring the table is loaded and has at least one row
                        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 9000 }).should('exist');

                        // cy.pause();

                        // --- Searching for the extracted Merged PO Number in the table ---
                        cy.log(`Checking for the Newly Merged Po in the table with PO Number as: -> ${newPoToFind}`);

                        cy.get('[data-cy="procurement-requests-data-table"] tbody', { timeout: 15000 })
                            .contains('tr td:first-child a.font-medium', newPoToFind, { matchCase: false })
                            .should('be.visible')
                            .then(($link) => {
                                cy.log(`Found PO: ${$link.text().trim()} in the Approved POs table.`);
                                cy.wrap($link).click();
                            });
                        
                        cy.log(`Newly Merged PO with PO Number as: -> "${newPoToFind}" successfully found in the Approved POs table.`);
                        cy.log('PO merge process initiated successfully.');
                })

            } else {
                cy.log(`Merge PO button (${mergePoButtonSelector}) is not available or not actionable or kindly check the Project Gst Information is Configured or Not...`);
                cy.log('This PO is not available or allowed for merging. Concluding merge attempt.');
            }
        });

        cy.log('PO merging test case finished.');

    });
});