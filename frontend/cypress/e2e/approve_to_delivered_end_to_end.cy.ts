/// <reference types="Cypress" />

// 1. -> Log In,
// 2. -> Update Payment Options ,
// 3. -> Dispatch a PO,
// 4. -> Update delivery Notes ( Partially ),
// 5. -> Update Delivery Notes ( Completely ),
// 6. -> Check it's Presence in Delivered PO

const po_email_e = Cypress.env('login_Email');
const po_password_e = Cypress.env('login_Password');


describe('Approved PO to Delivered PO, End-to-End Flow', () => {

    beforeEach(() => {
        // Logging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', { timeout: 3000 }).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(po_email_e);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(po_password_e);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', { timeout: 3000 }).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    let poNumber;

    it('Navigates to Approved PO page, Dispatch a PO, and Update Delivery Notes', () => {

        cy.get('[data-cy="purchase-orders-button"]')
            .should('exist')
            .and('be.visible')
            .click();

        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .click();

        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('exist')
            .and('be.visible');

        cy.get('[data-cy="procurement-requests-data-table"]')
            .should('exist')
            .and('be.visible')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#PO')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });

        cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
            .first()
            .within(() => {
                cy.get('a[href^="/purchase-orders/"]')
                    .invoke('text')
                    .then((poNumberFromTable) => {
                        poNumber = poNumberFromTable.trim();
                        Cypress.env('poNumber', poNumber);
                        expect(poNumber).to.match(/^PO\/\d+\/\d+\/\d{2}-\d{2}$/);
                        cy.get('a[href^="/purchase-orders/"]')
                            .should('have.attr', 'href')
                            .and('include', poNumber.replace(/\//g, '&='));
                        cy.get('a[href^="/purchase-orders/"]')
                            .click();
                    });
            });

        cy.then(() => {
            const poNumberUsage = Cypress.env('poNumber') || poNumber;
            cy.log(`Extracted PO Number: ${poNumberUsage}`);
        });

        cy.get('[data-cy="po-details-request-payment-button"]')
            .should('exist')
            .and('be.visible');

        cy.get('[data-cy="po-details-request-payment-button"]')
            .should('contain.text', 'Request Payment');

        cy.get('[data-cy="po-details-dispatch-po-button"]').then(($btn) => {
            if (!$btn.is(':disabled')) {
                cy.wrap($btn)
                    .should('be.visible')
                    .and('contain.text', 'Dispatch PO')
                    .and('have.class', 'bg-primary')
                    .find('svg')
                    .should('exist')
                    .and('have.attr', 'class', 'lucide lucide-send h-4 w-4');
                cy.wrap($btn).click();
            } else {
                cy.get('[data-cy="po-details-payment-details-button"]')
                    .should('exist')
                    .contains('Payment Details')
                    .and('be.visible')
                    .click();
                cy.get('[data-cy="payment-terms-edit-button"]')
                    .should('be.visible')
                    .and('not.be.disabled')
                    .and('contain.text', 'Edit')
                    .click();
                cy.get('[data-cy="edit-payment-terms-card-heading"]')
                    .scrollIntoView()
                    .should('exist')
                    .and('be.visible')
                    .and('contain.text', 'Edit Terms and Charges');
                cy.get('button[role="combobox"]')
                    .should('be.visible')
                    .click();
                cy.get('button[role="combobox"]')
                    .then(($combobox) => {
                        const controlsId = $combobox.attr('aria-controls');
                        cy.get(`[id="${controlsId}"] [role="option"]`)
                            .first()
                            .should('be.visible')
                            .click();
                    });

                const testNotes = 'Test notes for payment terms - please process ASAP';
                
                cy.get('[data-cy="payment-terms-notes-input"]')
                    .should('exist')
                    .and('be.visible')
                    .type(testNotes, { delay: 50 });

                cy.get('[data-cy="payment-terms-save-button"]')
                    .scrollIntoView()
                    .should('exist')
                    .and('be.visible')
                    .click();
            }
        });

        cy.contains('button', 'Preview')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled');

        cy.get('[data-cy="po-details-dispatch-po-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .click({ force: true });

        cy.get('[data-cy="po-details-mark-as-dispatched-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .and('have.text', 'Mark as Dispatched')
            .click();

        cy.get('[data-cy="mark-as-dispatched-person-name-input"]')
            .should('exist')
            .and('be.visible')
            .type('Test Person Name');

        function generateRandomPhoneNumber() {
            const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000);
            return `+91${randomNumber}`;
        }

        const randomPhone = generateRandomPhoneNumber();

        cy.get('[data-cy="mark-as-dispatched-contact-number-input"]')
            .should('exist')
            .and('be.visible')
            .type(randomPhone);

        cy.get('[data-cy="mark-as-dispatched-confirm-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="po-details-dd-invoice-button"]')
            .should('exist')
            .and('be.visible')
            .then(($btn) => {
                cy.wrap($btn).click({ force: true });
            });
        cy.contains('button', 'Cancel')
            .should('exist')
            .and('be.visible')
            .click();

        // cy.get('[data-cy="po-details-revert-button"]')
        //     .should('exist')
        //     .and('be.visible')
        //     .click({ force: true });

        // cy.contains('button', 'Cancel')
        //     .should('exist')
        //     .and('be.visible')
        //     .click();

        // cy.get('[data-cy="po-details-revert-button"]')
        //     .click({ force: true });
        // cy.contains('button', 'Cancel')
        //     .should('exist')
        //     .and('be.visible')
        //     .click();

        // cy.pause();


        // --- STARTING: PARTIAL DELIVERY ---
        // Update Delivery Notes Button - First Time (for partial delivery)
        cy.get('[data-cy="po-details-update-dn-button"]')
            .scrollIntoView()
            .should('exist')
            .and('be.visible')
            .click({ force: true });

        // cy.pause();


        // This array will store the ordered quantity for each item
        const itemDeliveryData = [];
        // Selector for the table body where ordered quantities are initially displayed
        const initialOrderDetailsTableBodySelector = 'div.p-0 div.overflow-y-auto table.order-details-table tbody';

        // 1. Getting ordered quantities from the Order Details table
        cy.get(initialOrderDetailsTableBodySelector)
            .find('tr')
            .each(($row, index) => {
                cy.wrap($row).find('td').eq(3).invoke('text').then((text) => {
                    const orderedQuantity = parseInt(text.trim(), 10) || 0;
                    itemDeliveryData.push({
                        originalIndex: index,
                        ordered: orderedQuantity,
                        deliveredSoFar: 0
                    });
                    cy.log(`Item ${index + 1}: Initial Ordered Quantity = ${orderedQuantity}`);
                });
            })
            .then(() => {
                // All quantities stored itemDeliveryData array
                // 2. Clicking the "Edit" button
                cy.get('[data-cy="update-dn-edit-button"]')
                    .scrollIntoView()
                    .should('be.visible')
                    .and('not.be.disabled')
                    .click();
            })
            .then(() => {
                // --- LOGIC FOR INPUTTING PARTIAL QUANTITIES ---
                cy.log('Starting partial delivery input for items:', itemDeliveryData);
                cy.wait(1500);

                // Using the global selector to find ALL required inputs
                cy.get('td:nth-child(4) input')
                    .should('have.length.at.least', itemDeliveryData.length)
                    .then($inputs => {
                        const inputsToProcess = $inputs.slice(0, itemDeliveryData.length);

                        cy.wrap(inputsToProcess).each(($inputField, index) => {
                            if (itemDeliveryData[index]) {
                                const item = itemDeliveryData[index];
                                
                                let quantityForPartialStep;
                                // Conditional Logic for Ordered Quantities as 1
                                if (item.ordered === 1){
                                    quantityForPartialStep = 0;
                                    cy.log(`Item ${index + 1} (Ordered: 1): Special case for partial delivery, inputting = ${quantityForPartialStep}`);
                                } else {
                                    quantityForPartialStep = Math.ceil(item.ordered / 2) || 0;
                                    cy.log(`Item ${index + 1} (Ordered: ${item.ordered}): Inputting partial = ${quantityForPartialStep}, expecting value: '${quantityForPartialStep.toString()}'`);

                                }

                                // const halfQuantity = Math.ceil(item.ordered / 2) || 0;
                                item.deliveredSoFar += quantityForPartialStep;

                                cy.log(`Item ${index + 1} (Ordered: ${item.ordered}): Inputting partial = ${quantityForPartialStep}`);
                                cy.wrap($inputField)
                                    .should('be.visible')
                                    .clear()
                                    .type('{selectall}{backspace}', { delay: 30 })
                                    .type(quantityForPartialStep.toString(), { delay: 50 })
                                    .should('have.value', quantityForPartialStep.toString());
                            } else {
                                cy.log(`Warning: Mismatch - No item data for input index ${index} during partial delivery.`);
                            }
                        });
                    });
            });

        // Validating Update then Cancel button (after partial input)
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-cancel-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Cancel')
            .click();

        // Validating and Clicking Confirm Update for PARTIAL delivery
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-confirm-update-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Confirm Update')
            .click();

        cy.log('Partial delivery submitted. Current delivery state:', itemDeliveryData);
        // --- END: PARTIAL DELIVERY ---

        cy.wait(3000);
        // --- START: COMPLETE DELIVERY ---
        cy.log('Attempting to start complete delivery.');
        cy.get('[data-cy="po-details-update-dn-button"]', { timeout: 10000 })
            .should('be.visible') 
            .and('not.be.disabled')
            .scrollIntoView()
            .click({ force: true });

        cy.get('[data-cy="update-dn-edit-button"]', { timeout: 5000 })
            .should('be.visible')
            .and('not.be.disabled')
            .scrollIntoView()
            .click();

        // // cy.get('[data-cy="po-details-update-dn-button"]'/** , { timeout: 6000 } */)
        // cy.contains('button', 'Update DN')
        // .scrollIntoView()
        // .should('exist').and('be.visible').click({ force: true});

        // cy.get('[data-cy="update-dn-edit-button"]')
        // .scrollIntoView()
        // .should('be.visible').and('not.be.disabled').click();

        cy.then(() => {
        cy.log('Starting complete delivery input for items (typing FULL ORIGINAL ordered quantity):', itemDeliveryData);
        cy.wait(1500);

        cy.get('td:nth-child(4) input')
            // .should('have.length.at.least', itemDeliveryData.length)
            .then($inputs => {
                const inputsToProcess = $inputs.slice(0, itemDeliveryData.length);

                cy.wrap(inputsToProcess).each(($inputField, index) => {
                    if (itemDeliveryData[index]) {
                        const item = itemDeliveryData[index];
                        // For the second pass FOR typing the FULL ORDERED quantity
                        const quantityToInput = item.ordered;

                        cy.log(`Item ${index + 1} (Original Ordered: ${item.ordered}): Inputting COMPLETE FULL ORDERED quantity = ${quantityToInput}, expecting value: '${quantityToInput.toString()}'`);
                        cy.wrap($inputField)
                            .should('be.visible')
                            .type('{selectall}{backspace}', { delay: 30 })
                            .type(quantityToInput.toString(), { delay: 50 })
                            .type('{del}')
                            .should('have.value', quantityToInput.toString());
                    } else {
                        cy.log(`Warning: Mismatch - No item data for input index ${index} during complete delivery.`);
                    }
                });
            });
        });

        // Validating Update and then Clicking Cancel button (for complete delivery)
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-cancel-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Cancel')
            .click();

        // Validating and Clicking Confirm Update for COMPLETE delivery
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-confirm-update-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Confirm Update')
            .click();

        // --- END: WHEN COMPLETE DELIVERY IS DONE ---
        cy.log('Complete delivery submitted.');
        
    });
});