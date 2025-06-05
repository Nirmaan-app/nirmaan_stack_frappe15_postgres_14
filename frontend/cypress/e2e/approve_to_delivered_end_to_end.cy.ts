/// <reference types="Cypress" />

// 1. -> Log In,
// 2. -> Update Payment Options ,
// 3. -> Dispatch a PO,
// 4. -> Update delivery Notes ( Partially ),
// 5. -> Update Delivery Notes ( Completely ),
// 6. -> Check it's Presence in Delivered PO

const po_email = Cypress.env('login_Email');
const po_password = Cypress.env('login_Password');


describe('Approved PO to Delivered PO, End-to-End Flow', () => {

    beforeEach(() => {

        // Logging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
            cy.visit('/login');

            cy.contains('Login', {timeout: 3000}).should('be.visible');
            cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(po_email);
            cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(po_password);
            cy.get('[data-cy="login-button"]').should('be.visible').click();

            cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
            cy.url().should('include', 'localhost:8080');
            cy.contains('Modules').should('be.visible');
    });

    let poNumber;

    it('Navigates to Approved PO page and Dispatch a PO', () => {

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
            .and('be.visible')

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
                    // Get the PO number text and store it
                    cy.get('a[href^="/purchase-orders/"]')
                        .invoke('text')
                        .then((poNumberFromTable) => {
                            // Trim any whitespace and store the PO number for future use
                            poNumber = poNumberFromTable.trim();
                            Cypress.env('poNumber', poNumber);

                            // Validate the PO number format (adjust regex as needed)
                            expect(poNumber).to.match(/^PO\/\d+\/\d+\/\d{2}-\d{2}$/);

                            // Clicking the PO number link
                            cy.get('a[href^="/purchase-orders/"]')
                                .should('have.attr', 'href')
                                .and('include', poNumber.replace(/\//g, '&='));

                            cy.get('a[href^="/purchase-orders/"]')
                                .click();
                        });
                });

        // Accessing Stored PO Number
        cy.then(() => {
            const poNumberUsage = Cypress.env('poNumber');
            cy.log(`Extracted PO Number: ${poNumberUsage}`);
        });

        // Validating the Request Payment button
        cy.get('[data-cy="po-details-request-payment-button"]')
            .should('exist')
            .and('be.visible')
            // .and('not.be.disabled');

        
        cy.get('[data-cy="po-details-request-payment-button"]')
            .should('contain.text', 'Request Payment');
            

        cy.get('[data-cy="po-details-dispatch-po-button"]').then(($btn) => {
            if (!$btn.is(':disabled')) {

                // Vallidates the Dispatch Button
                cy.wrap($btn)
                    .should('be.visible')
                    .and('contain.text', 'Dispatch PO')
                    .and('have.class', 'bg-primary')
                    .and('have.attr', 'class')
                    .then((classList) => {
                        expect(classList).to.include('hover:bg-primary/90');
                    });

                // Validate the SVG icon exists inside the button
                cy.wrap($btn)
                    .find('svg')
                    .should('exist')
                    .and('have.attr', 'class', 'lucide lucide-send h-4 w-4');

                cy.wrap($btn).click();

            } else {
           
                // Accessing Payment Details
                cy.get('[data-cy="po-details-payment-details-button"]')
                    .should('exist')
                    .contains('Payment Details')
                    .and('be.visible')
                    .click();

                // 1. Validate the edit button
                cy.get('[data-cy="payment-terms-edit-button"]')
                    .should('be.visible')
                    .and('not.be.disabled')
                    .and('contain.text', 'Edit')
                    .and('have.class', 'bg-background')
                    .and('have.class', 'hover:bg-accent')
                    .within(() => {
                        // 2. Validating the pencil icon
                        cy.get('svg.lucide-pencil')
                            .should('exist')
                            .and('be.visible');
                    });

                // 3. Click the button
                cy.get('[data-cy="payment-terms-edit-button"]')
                    .click(); 

                // Validating Payment Terms Card Selecting Project GST
                cy.get('[data-cy="edit-payment-terms-card-heading"]')
                    .scrollIntoView()
                    .should('exist')
                    .and('be.visible')
                    .and('contain.text', 'Edit Terms and Charges');

                
                // Validating Dropdown and Selecting Project GST
                    // 1. Validate the dropdown button in closed state
                    cy.get('button[role="combobox"]')
                        .should('be.visible')
                        .and('have.attr', 'aria-expanded', 'false')
                        .and('have.attr', 'data-state', 'closed')
                        .and('contain.text', '')
                        .within(() => {
                            cy.get('svg')
                                .should('exist')
                                .and('have.attr', 'aria-hidden', 'true')
                                .and('have.class', 'opacity-50');
                        });

                    // 2. Clicking to open the dropdown
                    cy.get('button[role="combobox"]')
                        .click();

                    // 3. Validating the dropdown is now open
                    cy.get('button[role="combobox"]')
                        .should('have.attr', 'aria-expanded', 'true')
                        .and('have.attr', 'data-state', 'open');

                    // 4. Find the dropdown options container
                        // Using the aria-controls attribute dynamically
                            cy.get('button[role="combobox"]')
                                .then(($combobox) => {
                                    const controlsId = $combobox.attr('aria-controls');

                                    // 5. Wait for options to appear in the portal
                                    cy.get(`[id="${controlsId}"] [role="option"]`)
                                        .first()
                                        .should('be.visible')
                                        .click();
                                });

                    // 5. Validating dropdown is closed after selection
                    cy.get('button[role="combobox"]')
                        .should('have.attr', 'aria-expanded', 'false')
                        .and('have.attr', 'data-state', 'closed');
                    

                    // 6. Validating the label and textarea exist
                        // 1. Define the test notes once
                        const testNotes = 'Test notes for payment terms - please process ASAP';

                        // 2. Get the textarea by data attribute and assert label existence
                        cy.get('[data-cy="payment-terms-notes-input"]')
                            .should('exist')
                            .should('be.visible')
                            .and('have.attr', 'name', 'notes')
                            .parents('section')
                                .within(() => {
                                    cy.contains('label', 'Add Notes:')
                                    .should('have.class', 'text-sm')
                                    .and('have.class', 'font-medium');
                                });

                        // 3. Alias the input for reuse
                        cy.get('[data-cy="payment-terms-notes-input"]')
                            .as('notesInput');

                        // 4. Type into the input
                        cy.get('@notesInput')
                            .type(testNotes, { delay: 50 })
                            // .should('have.value', testNotes);

                        // 5. Additional content validation
                        cy.get('@notesInput')
                            .invoke('val')
                            .should('include', 'ASAP');

                    
                    // Another Different Approach
                    // 1. Finding by label text first
                    // cy.contains('label', 'Add Notes:')
                    //     .should('be.visible')
                    //         .then(($label) => {
                    //             // 2. Getting the textarea
                    //             const textarea = $label.next('textarea').length ? 
                    //                 $label.next('textarea') : 
                    //                 Cypress.$('textarea', $label.parent());
                                
                    //             // 3. Wrapping the jQuery element to use Cypress commands
                    //             cy.wrap(textarea)
                    //                 .should('be.visible')
                    //                 .type('Test payment terms notes', { delay: 50 })
                    //                 .should('have.value', 'Test payment terms notes');
                    //         });

                    // Validating Cancel and save Buttons
                    cy.get('[data-cy="payment-terms-cancel-button"]')
                        .scrollIntoView()
                        .should('exist')
                        .and('be.visible')
                        // .click();

                    cy.get('[data-cy="payment-terms-save-button"]')
                        .scrollIntoView()
                        .should('exist')
                        .and('be.visible')
                        .click();       
            }   


        // // Dispatch Button Validations
        // cy.get('[data-cy="po-details-dispatch-po-button"]')
        //     .should('be.visible')
        //     .and('not.be.disabled')
        //     .and('contain.text', 'Dispatch PO')
        //     .and('have.class', 'bg-primary')
        //     .and('have.attr', 'class')
        //     .then((classList) => {
        //         expect(classList).to.include('hover:bg-primary/90')
        //     });

        // // 2. Validate the SVG icon exists inside the button
        // cy.get('[data-cy="po-details-dispatch-po-button"] svg')
        //     .should('exist')
        //     .and('have.attr', 'class', 'lucide lucide-send h-4 w-4');

        // // 3. Click the button
        // cy.get('[data-cy="po-details-dispatch-po-button"]')
        //     .click();

        });

        // cy.wait(9000);

         // Validating the Preview button
         cy.contains('button', 'Preview')
         .should('exist')
         .and('be.visible')
         .and('not.be.disabled');
        
         // Validating and clicking Dispatch button ( GST Info Added )
         cy.get('[data-cy="po-details-dispatch-po-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .click({ force: true });

        // Validating & Clicking Mark As Dispatched Button
        cy.get('[data-cy="po-details-mark-as-dispatched-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .and('have.text', 'Mark as Dispatched')
            .click();

        // Validating the Person Name Input Field
        cy.get('[data-cy="mark-as-dispatched-person-name-input"]')
            .should('exist')
            .and('be.visible')
            .type('Test Person Name')
            .as('personInput')
        
        // cy.get('@personInput')
        //     .invoke('val')
        //     .should('include.text', 'Person');

        // Generating Random Contact Numbers
        function generateRandomPhoneNumber() {
            const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000);
            return `+1${randomNumber}`; // US format
        }

        const randomPhone = generateRandomPhoneNumber();
        

        // Validating the Contact Number Input Field
        cy.get('[data-cy="mark-as-dispatched-contact-number-input"]')
            .should('exist')
            .and('be.visible')
            .type(randomPhone);

            // Dialog Cancel Button
            cy.get('[data-cy="mark-as-dispatched-cancel-button"]')
                .should('exist')
                .and('be.visible')
                .and('not.be.disabled')
                // .click();
        
            // Dialog Confirm Button
            cy.get('[data-cy="mark-as-dispatched-confirm-button"]')
                .should('exist')
                .and('be.visible')
                .and('not.be.disabled')
                .click();

        // cy.visit('http://localhost:8080/purchase-orders/PO&=056&=00036&=25-26?tab=PO%20Approved'); //

        // Add Invoice Button
        cy.get('[data-cy="po-details-dd-invoice-button"]')
            .should('exist')
            .and('be.visible')
            .then(($btn) => {
                cy.wrap($btn).click({ force: true });
              });
            // .click();

              // Revert PO Cancel and Confirm Button
                cy.contains('button', 'Confirm')
                    .should('exist')
                    .and('be.visible')
                    // .click();

                cy.contains('button', 'Cancel')
                    .should('exist')
                    .and('be.visible')
                    .click();

        // Revert Button
        cy.get('[data-cy="po-details-revert-button"]')
            .should('exist')
            .and('be.visible')
            .click({ force: true });

            // Revert Dialog Cancel Button
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

            // Revert Dialog Confirm Button
            // Re-Opening Revert Dialog
            cy.get('[data-cy="po-details-revert-button"]')
                .click({force: true});
                cy.contains('button', 'Confirm')
                    .should('exist')
                    .and('be.visible')
                    // .click();

                // This time again Clicking Cancel ( so that PO can't be reverted )
                cy.contains('button', 'Cancel')
                    .should('exist')
                    .and('be.visible')
                    .click();

        // Update Delivery Notes Button
        cy.get('[data-cy="po-details-update-dn-button"]')
            .should('exist')
            .and('be.visible')
            .click({ force: true });

            // Edit Button
            cy.get('[data-cy="update-dn-edit-button"]')
                .should('be.visible')
                .and('not.be.disabled')
                .and('contain.text', 'Edit')
                .and('have.class', 'bg-primary')
                .within(() => {
                    // 2. Validate the pencil icon
                    cy.get('svg.lucide-pencil')
                      .should('exist')
                });

                // cy.get('[data-cy="update-dn-edit-button"]')
                //     .realHover() // Test hover state
                //     .should('have.css', 'background-color')
                //     .and('not.equal', 'rgba(0, 0, 0, 0)');

            // Getting Ordered Number from rder Details Table
            let quantityValue: number;

            cy.get('table.order-details-table tbody tr').first().within(() => {
            cy.get('td').eq(3).invoke('text').then((text) => {
                const trimmed = text.trim();
                quantityValue = parseInt(trimmed, 10);
                Cypress.env('quantityValue', quantityValue);
                cy.log(`Extracted Quantity: ${Cypress.env('quantityValue')}`);
                // You can now use `quantityValue` in subsequent `.then()` blocks
            });
            }).then(() => {
                cy.log(`Extracted Quantity: ${Cypress.env('quantityValue')}`);
                cy.get('[data-cy="update-dn-edit-button"]')
                    .click();
                    cy.log(`Extracted Quantity: ${Cypress.env('quantityValue')}`);
            }).then(() => {
                // Filling Received Items
            
                const quantityUsage = Cypress.env('quantityValue')
                cy.log(`Extracted Quantity from outside: ------> ${quantityUsage}`);

                cy.get('td:nth-child(3)')
                // 3. Calculate half (rounded)
                const halfQuantity = Math.ceil(quantityUsage / 2) || 0;
                // 4. Calculate Remaining (rounded)
                const remainingQuantity = quantityUsage - halfQuantity;

                cy.log(`Extracted ordered quantity: ${quantityUsage}`);
                cy.log(`Calculated half quantity: ${halfQuantity}`);
                cy.log(`Remaining quantity: ${remainingQuantity}`);
            
                // 4. Input the value into Received field
                cy.get('td:nth-child(4) input')
                    .clear()
                    .type(halfQuantity.toString())
                    // .type('19')
                    .should('have.value',halfQuantity.toString());

            });


            // Validating Update then Cancel button
            cy.get('[data-cy="delivery-notes-update-button"]')
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


            // validating and Clicking Confirm Update
            cy.get('[data-cy="delivery-notes-update-button"]')
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
                

        // cy.visit('http://localhost:8080/purchase-orders/PO&=003&=00051&=25-26?tab=Partially%20Delivered');
        
        // Partially Delivered Updating delivery notes
        // Update Delivery Notes Button
        cy.get('[data-cy="po-details-update-dn-button"]')
            .should('exist')
            .and('be.visible')
            .click();

            // Edit Button
            cy.get('[data-cy="update-dn-edit-button"]')
                .should('be.visible')
                .and('not.be.disabled')
                .and('contain.text', 'Edit')
                .and('have.class', 'bg-primary')
                .within(() => {
                    // 2. Validate the pencil icon
                    cy.get('svg.lucide-pencil')
                        .should('exist')
                });


                cy.get('table.order-details-table tbody tr').first().within(() => {
                    cy.get('td').eq(3).invoke('text').then((text) => {
                      const trimmed = text.trim();
                      const quantityValue = parseInt(trimmed, 10);
                      Cypress.env('quantityValue', quantityValue);
                      cy.log(`Extracted Quantity: ${Cypress.env('quantityValue')}`);
                    });
                  }).then(() => {
                    cy.log(`Quantity before clicking edit: ${Cypress.env('quantityValue')}`);
                    cy.get('[data-cy="update-dn-edit-button"]').click();
                  }).then(() => {
                    const quantityToUse = Cypress.env('quantityValue');
                    cy.log(`Quantity to be inputted: ${quantityToUse}`);
                  
                    // Directly type the full quantity into the input field
                    cy.get('td:nth-child(4) input').clear().type(quantityToUse).type('{del}')
                        // .then(($input) => {
                        //     const valueToSet = quantityToUse;
                        //     cy.log(`quanititToUse type: ${typeof(valueToSet)}`);
                        //     cy.wrap($input)
                        //     .trigger('input') 
                        //     .invoke('val', valueToSet) // set value directly
                        //     .should('have.value', valueToSet);
                        // });
                  });


        // Validating Update then Cancel button
        cy.get('[data-cy="delivery-notes-update-button"]', { timeout: 6000 })
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


        // validating and Clicking Confirm Update
        cy.get('[data-cy="delivery-notes-update-button"]')
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
            // .click();
                
    });

});