/// <reference types="Cypress" />

const email_apo = Cypress.env('login_Email');
const password_apo = Cypress.env('login_Password');

describe('Adding a New PR', () => {

    beforeEach( () => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(email_apo);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(password_apo);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Navigates to Approved POs tab and Amend a PO', () => {

        // Navigation to Purchase Orders Module
        cy.get('[data-cy="purchase-orders-button"]')
            .should('be.visible')
            .click();

        cy.url().should('include', '/purchase-orders');

        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 6000 })
            .should('be.visible')
            .within(() => {
                cy.get('thead').should('exist');
                cy.contains('th', '#PO').should('be.visible');
                cy.contains('th', 'Created On').should('be.visible');
            });

        // Clicking the first PO present in the Table
        cy.get('[data-cy="procurement-requests-data-table"]')
            .find('tbody')
            .find('tr')
            .first()
            .find('td')
            .first()
            .find('a[href*="/purchase-orders/"]')
            .click();

        // cy.wait(16000);

        // Clicking the Amend PO Button
        cy.get('[data-cy="amend-po-button"]', { timeout: 20000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        
        // --- Generate Random Quantity ---
        const minQty = 3;
        const maxQty = 16;

        // Quantity to update for the first item
        const randomQuantityNumber = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
        const newQuantity = randomQuantityNumber.toString();

        // --- Part 1: Interacting with the "Edit Item" Dialog To edit the quantity ---
        // 1. Targeting the first item's edit button in the table and clicking it
        cy.get('[data-cy="amend-po-edit-button"]')
            .first()
            .click();

        cy.pause();

        // 2. Wait for the dialog to be open and visible
        cy.get('[role="dialog"][data-state="open"]').should('be.visible');

        // 3. Update the quantity in the dialog
        cy.get('[data-cy="amend-po-dialog-quantity-input"]')
            .clear()
            .type(newQuantity)
            .should('have.value', newQuantity);

        // 4. Click the save button in the dialog
        cy.get('[data-cy="amend-po-dialog-save-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')    
            .click();

        // 5. Verifying that the quantity of the *first item* in the table has been updated
        cy.get('[data-cy="amend-po-edit-button"]')
            .first()
            .closest('tr')
            .find('td')
            .eq(3)
            .should('contain.text', newQuantity);

        cy.pause();
        
        cy.log('--- First item quantity edited ---');



        // --- Part 2: Attempt to Delete the SECOND item ---
        cy.log('--- Attempting to delete the SECOND item ---');

        // Check if a second item exists to attempt deletion
        cy.get('body').then(($body) => {
            if ($body.find('[data-cy="amend-po-edit-button"]').length > 1) {
                cy.log('Second item exists, opening its edit dialog.');
                cy.get('[data-cy="amend-po-edit-button"]')
                    .eq(1)
                    .click();
        
                cy.get('[role="dialog"][data-state="open"]').should('be.visible');
        
                // Check the state of the Delete button in the dialog
                cy.get('[data-cy="amend-po-dialog-delete-button"]').then(($deleteButton) => {
                    if (!$deleteButton.is(':disabled')) {
                            cy.log('Delete button is ENABLED. Clicking Delete.');
                            cy.wrap($deleteButton).click();
                            cy.log('Delete button is CLICKED and the item is Deleted Successfully.');
                            // cy.get('[role="dialog"][data-state="open"]').should('not.exist');
                        } else {
                            cy.log('Delete button is DISABLED. Clicking Save instead.');
                            cy.get('[data-cy="amend-po-dialog-save-button"]').click();
                            // cy.get('[role="dialog"][data-state="open"]').should('not.exist');
                        }
                    });
                } else {

                cy.log('No second item found to attempt deletion.');
            }
        });

        cy.pause();

        cy.log('--- Deletion attempt for second item complete ---');


        // 6. Validating the Confirm button and Clicking It
        // cy.get('[data-cy="amend-po-confirm-button"]', { timeout: 25000 }).should('exist')
        cy.contains('button', 'Confirm', { timeout: 10000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click()

        cy.get('[data-cy="confirm-dialog-textarea"]')
            .should('exist')
            .and('be.visible')
            .clear()
            .type('This Comment is Added while PO Amendment During the End-To-End Test Flow...');


        
        // Part 3: Intercept PO Amendment Confirmation and Extract PR Number
        cy.log('--- Intercepting PO Amendment Confirmation ---');
        cy.intercept('PUT', '**/api/resource/Procurement%20Orders/**').as('amendPoConfirmRequest');

        cy.get('[data-cy="confirm-dialog-confirm-button"]', { timeout: 25000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        let extractedPrNumber;

        cy.wait('@amendPoConfirmRequest', { timeout: 15000 })
            .then((interception) => {

                expect(interception.response?.statusCode).to.equal(200);
                const procurementRequestFull = interception.response?.body.data.procurement_request;
                cy.log(`Full PR string from API: ${procurementRequestFull}`);

                // Extracting the last part after the last hyphen
                if (procurementRequestFull && procurementRequestFull.includes('-')) {
                    const parts = procurementRequestFull.split('-');
                    let extractedPrNumberWithZeroes = parts[parts.length - 1];
                    extractedPrNumber = parseInt(extractedPrNumberWithZeroes, 10).toString(); 
                    cy.log(`Extracted PR Suffix: ${extractedPrNumber}`);                    
                    Cypress.env('ExtractedPrNumber', extractedPrNumber);

                } else {
                    // Handling the cases where the format might be different or value is missing
                    cy.log('Could not extract PR Suffix from API response or format is unexpected.');
                    throw new Error('Failed to extract PR Number.');
                }
            });



        // Part 4: Navigate to "Approve Amended PO" tab and verify
        cy.log('--- Navigating to Approve Amended PO tab and verifying ---');

        cy.then(() => {
            if (!extractedPrNumber) {
                cy.log('PR Number was not extracted. Skipping verification in "Approve Amended PO" tab.');
                throw new Error('Cannot proceed without extracted PR Number.');
                // return;
            }

        // Navigating to the "Approve Amended PO" tab
        cy.get('[data-cy="approve-ammended-po-navigation"]', { timeout: 10000 })
            .should('exist')
            .and('be.visible')
            .click();

        cy.pause();
        
        // Searching for the row containing the extracted PR Number and clicking it
        cy.contains('[data-cy="procurement-requests-data-table"] tbody tr td', extractedPrNumber, { timeout: 15000 })
                .should('be.visible')
                .closest('tr')
                .find('a')
                .first() 
                .click();

        });
        
    });

});