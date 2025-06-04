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

        // cy.get('[data-cy="purchase-orders-button"]')
        //     .should('exist')
        //     .and('be.visible')
        //     .click();

        // cy.get('[data-cy="approved-po-navigation"]')
        //     .should('exist')
        //     .and('be.visible')
        //     .click();

        // cy.get('[data-cy="procurement-requests-search-bar"]')
        //     .should('exist')
        //     .and('be.visible')

        // cy.get('[data-cy="procurement-requests-data-table"]')
        //     .should('exist')
        //     .and('be.visible')
        //         .within(() => {
        //             cy.get('thead')
        //                 .should('exist');
        //             cy.get('tbody tr')
        //                 .should('have.length.at.least', 1);
        //             cy.contains('th', '#PO')
        //                 .should('be.visible');
        //             cy.contains('th', 'Created On')
        //                 .should('be.visible');
        //         });

        // cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
        //         .first()
        //         .within(() => {
        //             // Get the PO number text and store it
        //             cy.get('a[href^="/purchase-orders/"]')
        //                 .invoke('text')
        //                 .then((poNumberFromTable) => {
        //                     // Trim any whitespace and store the PO number for future use
        //                     poNumber = poNumberFromTable.trim();
        //                     Cypress.env('poNumber', poNumber);

        //                     // Validate the PO number format (adjust regex as needed)
        //                     expect(poNumber).to.match(/^PO\/\d+\/\d+\/\d{2}-\d{2}$/);

        //                     // Clicking the PO number link
        //                     cy.get('a[href^="/purchase-orders/"]')
        //                         .should('have.attr', 'href')
        //                         .and('include', poNumber.replace(/\//g, '&='));

        //                     cy.get('a[href^="/purchase-orders/"]')
        //                         .click();
        //                 });
        //         });

        // // Accessing Stored PO Number
        // cy.then(() => {
        //     const poNumberUsage = Cypress.env('poNumber');
        //     cy.log(`Extracted PO Number: ${poNumberUsage}`);
        // });

        // // Validating the Request Payment button
        // cy.get('[data-cy="po-details-request-payment-button"]')
        //     .should('exist')
        //     .and('be.visible')
        //     // .and('not.be.disabled');

        
        // cy.get('[data-cy="po-details-request-payment-button"]')
        //     .should('contain.text', 'Request Payment');
            

        // cy.get('[data-cy="po-details-dispatch-po-button"]').then(($btn) => {
        //     if (!$btn.is(':disabled')) {

        //         // Vallidates the Dispatch Button
        //         cy.wrap($btn)
        //             .should('be.visible')
        //             .and('contain.text', 'Dispatch PO')
        //             .and('have.class', 'bg-primary')
        //             .and('have.attr', 'class')
        //             .then((classList) => {
        //                 expect(classList).to.include('hover:bg-primary/90');
        //             });

        //         // Validate the SVG icon exists inside the button
        //         cy.wrap($btn)
        //             .find('svg')
        //             .should('exist')
        //             .and('have.attr', 'class', 'lucide lucide-send h-4 w-4');

        //         cy.wrap($btn).click();

        //     } else {
           
        //         // Accessing Payment Details
        //         cy.get('[data-cy="po-details-payment-details-button"]')
        //             .should('exist')
        //             .contains('Payment Details')
        //             .and('be.visible')
        //             .click();

        //         // 1. Validate the edit button
        //         cy.get('[data-cy="payment-terms-edit-button"]')
        //             .should('be.visible')
        //             .and('not.be.disabled')
        //             .and('contain.text', 'Edit')
        //             .and('have.class', 'bg-background')
        //             .and('have.class', 'hover:bg-accent')
        //             .within(() => {
        //                 // 2. Validating the pencil icon
        //                 cy.get('svg.lucide-pencil')
        //                     .should('exist')
        //                     .and('be.visible');
        //             });

        //         // 3. Click the button
        //         cy.get('[data-cy="payment-terms-edit-button"]')
        //             .click(); 

        //         // Validating Payment Terms Card Selecting Project GST
        //         cy.get('[data-cy="edit-payment-terms-card-heading"]')
        //             .scrollIntoView()
        //             .should('exist')
        //             .and('be.visible')
        //             .and('contain.text', 'Edit Terms and Charges');

                
        //         // Validating Dropdown and Selecting Project GST
        //             // 1. Validate the dropdown button in closed state
        //             cy.get('button[role="combobox"]')
        //                 .should('be.visible')
        //                 .and('have.attr', 'aria-expanded', 'false')
        //                 .and('have.attr', 'data-state', 'closed')
        //                 .and('contain.text', '')
        //                 .within(() => {
        //                     cy.get('svg')
        //                         .should('exist')
        //                         .and('have.attr', 'aria-hidden', 'true')
        //                         .and('have.class', 'opacity-50');
        //                 });

        //             // 2. Clicking to open the dropdown
        //             cy.get('button[role="combobox"]')
        //                 .click();

        //             // 3. Validating the dropdown is now open
        //             cy.get('button[role="combobox"]')
        //                 .should('have.attr', 'aria-expanded', 'true')
        //                 .and('have.attr', 'data-state', 'open');

        //             // 4. Find the dropdown options container
        //                 // Using the aria-controls attribute dynamically
        //                     cy.get('button[role="combobox"]')
        //                         .then(($combobox) => {
        //                             const controlsId = $combobox.attr('aria-controls');

        //                             // 5. Wait for options to appear in the portal
        //                             cy.get(`[id="${controlsId}"] [role="option"]`)
        //                                 .first()
        //                                 .should('be.visible')
        //                                 .click();
        //                         });

        //             // 5. Validating dropdown is closed after selection
        //             cy.get('button[role="combobox"]')
        //                 .should('have.attr', 'aria-expanded', 'false')
        //                 .and('have.attr', 'data-state', 'closed');
                    

        //             // 6. Validating the label and textarea exist
        //                 // 1. Define the test notes once
        //                 const testNotes = 'Test notes for payment terms - please process ASAP';

        //                 // 2. Get the textarea by data attribute and assert label existence
        //                 cy.get('[data-cy="payment-terms-notes-input"]')
        //                     .should('exist')
        //                     .should('be.visible')
        //                     .and('have.attr', 'name', 'notes')
        //                     .parents('section')
        //                         .within(() => {
        //                             cy.contains('label', 'Add Notes:')
        //                             .should('have.class', 'text-sm')
        //                             .and('have.class', 'font-medium');
        //                         });

        //                 // 3. Alias the input for reuse
        //                 cy.get('[data-cy="payment-terms-notes-input"]')
        //                     .as('notesInput');

        //                 // 4. Type into the input
        //                 cy.get('@notesInput')
        //                     .type(testNotes, { delay: 50 })
        //                     // .should('have.value', testNotes);

        //                 // 5. Additional content validation
        //                 cy.get('@notesInput')
        //                     .invoke('val')
        //                     .should('include', 'ASAP');

                    
        //             // Another Different Approach
        //             // 1. Finding by label text first
        //             // cy.contains('label', 'Add Notes:')
        //             //     .should('be.visible')
        //             //         .then(($label) => {
        //             //             // 2. Getting the textarea
        //             //             const textarea = $label.next('textarea').length ? 
        //             //                 $label.next('textarea') : 
        //             //                 Cypress.$('textarea', $label.parent());
                                
        //             //             // 3. Wrapping the jQuery element to use Cypress commands
        //             //             cy.wrap(textarea)
        //             //                 .should('be.visible')
        //             //                 .type('Test payment terms notes', { delay: 50 })
        //             //                 .should('have.value', 'Test payment terms notes');
        //             //         });

        //             // Validating Cancel and save Buttons
        //             cy.get('[data-cy="payment-terms-cancel-button"]')
        //                 .scrollIntoView()
        //                 .should('exist')
        //                 .and('be.visible')
        //                 // .click();

        //             cy.get('[data-cy="payment-terms-save-button"]')
        //                 .scrollIntoView()
        //                 .should('exist')
        //                 .and('be.visible')
        //                 .click();       
        //     }   


        // // // Dispatch Button Validations
        // // cy.get('[data-cy="po-details-dispatch-po-button"]')
        // //     .should('be.visible')
        // //     .and('not.be.disabled')
        // //     .and('contain.text', 'Dispatch PO')
        // //     .and('have.class', 'bg-primary')
        // //     .and('have.attr', 'class')
        // //     .then((classList) => {
        // //         expect(classList).to.include('hover:bg-primary/90')
        // //     });

        // // // 2. Validate the SVG icon exists inside the button
        // // cy.get('[data-cy="po-details-dispatch-po-button"] svg')
        // //     .should('exist')
        // //     .and('have.attr', 'class', 'lucide lucide-send h-4 w-4');

        // // // 3. Click the button
        // // cy.get('[data-cy="po-details-dispatch-po-button"]')
        // //     .click();

        // });

        // // cy.wait(9000);

        //  // Validating the Preview button
        //  cy.contains('button', 'Preview')
        //  .should('exist')
        //  .and('be.visible')
        //  .and('not.be.disabled');
        
        //  // Validating and clicking Dispatch button ( GST Info Added )
        //  cy.get('[data-cy="po-details-dispatch-po-button"]')
        //     .should('exist')
        //     .and('not.be.disabled')
        //     .and('be.visible')
        //     .click({ force: true });

        // // Validating & Clicking Mark As Dispatched Button
        // cy.get('[data-cy="po-details-mark-as-dispatched-button"]')
        //     .should('exist')
        //     .and('be.visible')
        //     .and('not.be.disabled')
        //     .and('have.text', 'Mark as Dispatched')
        //     .click();

        // // Validating the Person Name Input Field
        // cy.get('[data-cy="mark-as-dispatched-person-name-input"]')
        //     .should('exist')
        //     .and('be.visible')
        //     .type('Test Person Name')
        //     .as('personInput')
        
        // // cy.get('@personInput')
        // //     .invoke('val')
        // //     .should('include.text', 'Person');

        // // Generating Random Contact Numbers
        // function generateRandomPhoneNumber() {
        //     const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000);
        //     return `+1${randomNumber}`; // US format
        // }

        // const randomPhone = generateRandomPhoneNumber();
        

        // // Validating the Contact Number Input Field
        // cy.get('[data-cy="mark-as-dispatched-contact-number-input"]')
        //     .should('exist')
        //     .and('be.visible')
        //     .type(randomPhone);

        //     // Dialog Cancel Button
        //     cy.get('[data-cy="mark-as-dispatched-cancel-button"]')
        //         .should('exist')
        //         .and('be.visible')
        //         .and('not.be.disabled')
        //         // .click();
        
        //     // Dialog Confirm Button
        //     cy.get('[data-cy="mark-as-dispatched-confirm-button"]')
        //         .should('exist')
        //         .and('be.visible')
        //         .and('not.be.disabled')
        //         .click();

        cy.visit('http://localhost:8080/purchase-orders/PO&=056&=00036&=25-26?tab=PO%20Approved');

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
            .click();

            // Revert Dialog Cancel Button
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

            // Revert Dialog Confirm Button
            // Re-Opening Revert Dialog
            cy.get('[data-cy="po-details-revert-button"]')
                .click();
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

                // cy.get('[data-cy="update-dn-edit-button"]')
                //     .realHover() // Test hover state
                //     .should('have.css', 'background-color')
                //     .and('not.equal', 'rgba(0, 0, 0, 0)');

                cy.get('[data-cy="update-dn-edit-button"]')
                    .click();


            // Filling Received Items

            // cy.get('table tbody tr').first().within(() => {
            //     // Step 1: Get the Ordered value
            //     cy.get('td').eq(2).invoke('text').then((text) => {
            //       const ordered = parseInt(text.trim());
            //       const half = Math.round(ordered / 2);
              
            //       // Step 2: Find the input field (anywhere in the current row)
            //       cy.get('input[type="number"]')
            //         .should('be.visible') // Ensure it's not hidden
            //         .scrollIntoView()
            //         .clear()
            //         .type(half.toString());
            //     });
            //   });
              
            // cy.get('td:nth-child(3)') // 3rd column is Ordered
            //     .invoke('text')
            //     .then((orderedText) => {
            //     const orderedQuantity = parseInt(orderedText.trim());
            //     cy.log(`Extracted ordered quantity: ${orderedQuantity}`);
                
            //     // 3. Calculate half (rounded)
            //     const halfQuantity = Math.round(orderedQuantity / 2);
            //     cy.log(`Calculated half quantity: ${halfQuantity}`);
                
            //     // 4. Input the value into Received field
            //     cy.get('td:nth-child(4) input') // 4th column is Received
            //         .clear()
            //         .type(halfQuantity.toString())
            //         .should('have.value', halfQuantity.toString());
            //     });
              
            // cy.get('table tbody tr').first().within(() => {
            //     // Step 1: Get Ordered value from 3rd <td>
            //     cy.get('td').eq(2).invoke('text').then((orderedText) => {
            //       const ordered = parseInt(orderedText.trim(), 10);
            //       const half = Math.round(ordered / 2);

            //       cy.log('Ordered value:', ordered);
            //       cy.log('Typing value:', half);

              
            //       // Step 2: Ensure the input exists inside 4th <td> and type the value
            //       cy.get('td').eq(3).within(() => {
            //         cy.get('input[type="number"]')
            //           .should('exist')
            //           .should('be.visible')
            //           .scrollIntoView()
            //           .clear()
            //           .type(half.toString(), { delay: 100 });
            //       });
            //     });
            //   });



            // cy.get('table tbody tr').first().then(($row) => {
            //     const $cells = $row.find('td');
              
            //     // Step 1: Extract text from the 3rd <td> (Ordered)
            //     const orderedText = $cells.eq(2).text().trim();
            //     const ordered = parseInt(orderedText, 10);
            //     cy.log('Ordered value:', ordered);
              
            //     const half = Math.round(ordered / 2);
            //     cy.log('Typing value:', half);
              
            //     // Step 2: Type into the input inside the 4th <td>
            //     cy.wrap($cells.eq(3)).within(() => {
            //       cy.get('input[type="number"]')
            //         .should('exist')
            //         .should('be.visible')
            //         .scrollIntoView()
            //         .clear()
            //         .type(half.toString(), { delay: 100 });
            //     });
            //   });



            // cy.get('table tbody tr').first().then(($row) => {
            //     const $cells = $row.find('td');
              
            //     // Step 1: Extract text from the 3rd <td> (Ordered)
            //     const orderedText = $cells.eq(2).text().trim();
            //     const ordered = parseInt(orderedText, 10);
            //     cy.log('Ordered value:', ordered);
              
            //     const half = Math.round(ordered / 2);
            //     cy.log('Typing value:', half);
              
            //     // Step 2: Check what's actually in the 4th <td>
            //     cy.wrap($cells.eq(3)).within(() => {
            //         // If you expect an input but there isn't one, you might need to:
            //         // 1. Check if you need to click something to make the input appear
            //         // 2. Or if you should be targeting a different element
                    
            //         // For now, let's log the HTML to see what's there
            //         cy.log('4th td content:', $cells.eq(3).html());
                    
            //         // If you need to interact with the span instead:
            //         cy.get('span').should('exist').then(($span) => {
            //             // Do something with the span if needed
            //         });
            //     });
            // });


            // cy.get('table tbody tr').first().then(($row) => {
            //     // Wait for the row to be fully interactive
            //     cy.wrap($row)
            //     // .should('be.visible');
                
            //     // Get all cells and ensure we have enough
            //     const $cells = $row.find('td');
            //     expect($cells.length).to.be.at.least(4);  // Ensure we have at least 4 cells
                
            //     // Extract ordered value from 3rd cell
            //     const orderedText = $cells.eq(2).text().trim();
            //     const ordered = parseInt(orderedText, 10);
            //     cy.log('Ordered value:', ordered);
                
            //     const half = Math.round(ordered / 2);
            //     cy.log('Typing value:', half);
                
            //     // Focus on the 4th cell
            //     const $fourthCell = $cells.eq(3);
            //     cy.wrap($fourthCell)
            //         .should('be.visible')
            //         .within(() => {
            //             // First, check what's actually there
            //             cy.log('Cell content:', Cypress.dom.getElements($fourthCell));
                        
            //             // Try different ways to find the element
            //             cy.root().then(($cellContent) => {
            //                 // Option 1: Try finding any child elements
            //                 const $span = $cellContent.find('span');
            //                 const $input = $cellContent.find('input');
                            
            //                 if ($span.length) {
            //                     cy.log('Found span with value:', $span.text());
            //                     // Do something with the span
            //                 } else if ($input.length) {
            //                     cy.log('Found input');
            //                     cy.wrap($input).clear().type(half.toString());
            //                 } else {
            //                     // If neither exists, maybe we need to click to activate
            //                     cy.wrap($cellContent).click();
            //                     cy.get('input[type="number"]', { timeout: 10000 })
            //                         .should('exist')
            //                         .clear()
            //                         .type(half.toString());
            //                 }
            //             });
            //         });
            // });

            // cy.get('table tbody tr').first().within(() => {
            //     cy.get('td').eq(0).invoke('text').then(text => cy.log('TD Index 0 Text:', text));
            //     cy.get('td').eq(1).invoke('text').then(text => cy.log('TD Index 1 Text:', text));
            //     cy.get('td').eq(2).invoke('text').then(text => cy.log('TD Index 2 Text:', text)); // Should be your "Ordered"
            //     cy.get('td').eq(3).invoke('text').then(text => cy.log('TD Index 3 Text:', text)); // Should be empty or contain non-numeric if it's the input's parent
            // });
              

            // cy.get('table tbody tr').first().within(() => {
            //     // Step 1: Get the "Ordered" value from the 3rd <td> (index 2)
            //     cy.get('td')
            //       .eq(2) // 0-indexed, so 2 is the 3rd cell
            //       .invoke('text')
            //       .then((orderedText) => {
            //         // --- CRITICAL DEBUGGING ---
            //         cy.log(`Raw "Ordered" text: "${orderedText}"`); // See exactly what was extracted
          
            //         const trimmedText = orderedText.trim();
            //         cy.log(`Trimmed "Ordered" text: "${trimmedText}"`); // See text after trim
          
            //         // Attempt to parse
            //         const orderedQuantity = parseInt(trimmedText, 10); // Always use radix 10
            //         cy.log(`Parsed "Ordered" quantity: ${orderedQuantity}`); // See the parsed number or NaN
          
            //         // --- VALIDATION ---
            //         if (isNaN(orderedQuantity)) {
            //           // This will fail the test clearly if parsing fails
            //           throw new Error(
            //             `Failed to parse ordered quantity. Text was: "${trimmedText}"`
            //           );
            //         }
          
            //         // Step 2: Calculate half, rounded
            //         const halfQuantity = Math.round(orderedQuantity / 2);
            //         cy.log(`Calculated "Received" quantity: ${halfQuantity}`);
          
            //         // Step 3: Find the input field in the 4th <td> (index 3) and type the value
            //         cy.get('td')
            //           .eq(3) // 4th cell
            //           .find('input[type="number"]') // Find the input within this cell
            //           .should('be.visible') // Good practice: ensure it's visible
            //           .clear() // Clear any existing value
            //           .type(halfQuantity.toString()) // .type() expects a string
            //           .should('have.value', halfQuantity.toString()); // Verify the value was set
            //       });
            //   });
              

            cy.get('table tbody tr td').should('have.length.gte', 5); // Expecting at least 5 cells per row now

    // Log the content of the first few cells to confirm indices
    cy.get('table tbody tr').first().within(() => {
        cy.get('td').eq(0).invoke('text').then(text => cy.log('TD Index 0 (Actual):', text.trim()));
        cy.get('td').eq(1).invoke('text').then(text => cy.log('TD Index 1 (Actual - Item Name?):', text.trim()));
        cy.get('td').eq(2).invoke('text').then(text => cy.log('TD Index 2 (Actual - Unit?):', text.trim()));
        cy.get('td').eq(3).invoke('text').then(text => cy.log('TD Index 3 (Actual - Ordered?):', text.trim())); // << SHOULD BE THE ORDERED VALUE
        cy.get('td').eq(4).then($td => cy.log('TD Index 4 (Actual - Received?): HTML:', $td.html())); // << SHOULD CONTAIN THE INPUT
    });


    cy.get('table tbody tr').first().within(() => {
      // Step 1: Get the "Ordered" value from the 4th <td> (index 3)
      cy.get('td')
        .eq(3) // <<<< CORRECTED: "Ordered" is at index 3 based on logs
        .invoke('text')
        .then((orderedText) => {
          cy.log(`Raw "Ordered" text from td[3]: "${orderedText}"`);
          const trimmedText = orderedText.trim();
          cy.log(`Trimmed "Ordered" text: "${trimmedText}"`);

          const orderedQuantity = parseInt(trimmedText, 10);
          cy.log(`Parsed "Ordered" quantity: ${orderedQuantity}`);

          if (isNaN(orderedQuantity)) {
            throw new Error(
              `Failed to parse ordered quantity from td at index 3. Text was: "${trimmedText}"`
            );
          }

          // Step 2: Calculate half, rounded
          const halfQuantity = Math.round(orderedQuantity / 2);
          cy.log(`Calculated "Received" quantity: ${halfQuantity}`);

          // Step 3: Find the input field in the 5th <td> (index 4) and type the value
          cy.get('td')
            .eq(4) // <<<< CORRECTED: "Received" input is in td at index 4
            .find('input[type="number"]')
            .should('be.visible')
            .clear()
            .type(halfQuantity.toString())
            .should('have.value', halfQuantity.toString());
        });
    });



    });

});