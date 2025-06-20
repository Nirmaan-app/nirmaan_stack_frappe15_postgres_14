/// <reference types="Cypress" />

describe('Add Payments for a PO', () => {
    beforeEach(() => {
        // --- Logging In ---
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', { timeout: 3000 }).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(Cypress.env('login_Email'));
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(Cypress.env('login_Password'));
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', { timeout: 3000 }).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Request Payments then Reject It, Delete It, Request Payment Again, Approve It and Check Status as Approved for it', () => { 

        // // Variable for Extracted Payment Identifier
        let extractedPaymentIdentifier;
        let extractedPoNumberFromDOM;

        // --- Navigation to Purchase Orders Module ---
        cy.log('Navigating to Purchase Orders Module');
        cy.get('[data-cy="purchase-orders-button"]', { timeout: 10000 })
            .should('be.visible')
            .click();
        cy.url().should('include', '/purchase-orders');

        // --- Navigate to Approved POs Tab ---
        cy.log('Navigating to Approved/Dispatched POs Tab');
        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // --- Wait for PO List Table to Load ---
        cy.log('Waiting for PO list table to load');
        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 6000 })
            .should('be.visible');

        // --- Clicking the first PO present in the Table ---
        cy.log('Clicking the first PO in the table');
        cy.get('[data-cy="procurement-requests-data-table"]')
            .find('tbody tr')
            .first()
            .find('td')
            .first()
            .find('a[href*="/purchase-orders/"]')
            .click();

        // --- Ensuring the PO details page is stable ---
        cy.log('Waiting for PO details page to stabilize');
        cy.get('[data-cy="total-amount-incl-gst"]', { timeout: 10000 }) 
            .should('be.visible');

        cy.get('[data-cy="po-number-from-purchase-orders"]')
        .should('be.visible')
        .invoke('text')
        .then((text) => {
          const poNumberMatch = text.match(/PO\/[\w\/]+/); 
          
          if (poNumberMatch && poNumberMatch[0]) {
              extractedPoNumberFromDOM = poNumberMatch[0].trim();
              cy.log(`Extracted PO Number from DOM: ${extractedPoNumberFromDOM}`);
  
              // Setting it in Cypress.env
              Cypress.env('extractedPurchaseOrderNumber', extractedPoNumberFromDOM);
              cy.log(`Cypress.env('extractedPurchaseOrderNumber') set to: ${Cypress.env('extractedPurchaseOrderNumber')}`);
            //   cy.pause();
          } else {
              cy.log(`Could not extract PO number pattern from text: "${text}"`);
              throw new Error('Failed to extract PO number from DOM element text.');
          }
        });


        cy.get('[data-cy="total-amount-incl-gst"]').find('span').invoke('text')
            .then(rawText => rawText.replace('₹', '').replace(/,/g, ''))
            .as('amountInclGst');

        
        // --- Step 2: Use cy.then() to access aliased values and proceed ---
        // All subsequent logic that depends on these amounts can be allowed to process inside this cy.then() only 
        cy.then(function () { 
            // Using function() to get access to 'this.aliasName'
            const extractedAmountInclGst = this.amountInclGst;

            cy.log(`Cleaned amount Incl. GST: ${extractedAmountInclGst}`);
            // cy.pause();

            // Convert to numbers for calculations
            const numAmountInclGst = parseFloat(extractedAmountInclGst);

            if (isNaN(numAmountInclGst)) {
                throw new Error('Failed to parse extracted amounts.');
            }

            // --- Open the Add Payments Dialog ---
            cy.log('Attempting to click Request Payment button');
            cy.get('[data-cy="po-details-request-payment-button"]', { timeout: 10000 })
                .should('be.visible')
                .and('not.be.disabled')
                .click();

            cy.log('Waiting for page to become interactive after button click');
            cy.get('body', { timeout: 30000 })

            cy.log('Waiting for Add Payments dialog to be visible and stable');
            cy.get('[data-cy="add-payments-dialog-title"]', { timeout: 10000 })
                .should('be.visible');
            cy.log('Add Payments dialog is now visible and page is interactive.');

            // --- Validation 1: Percentage Amount (50%) ---
            cy.log('--- Validating Percentage Amount (50%) ---');
            const expectedAmountFor50Percent = (Math.floor(numAmountInclGst / 2)).toString();
            cy.log(`Expected amount for 50%: ${expectedAmountFor50Percent}`);

            cy.get('[data-cy="percentage-amount-check"]', { timeout: 10000 }).click();
            cy.get('[data-cy="percentage-amount-input"]').clear().type('50');

            cy.get('[data-cy="requesting-amount"]', { timeout: 10000 })
                .should('be.visible')
                .invoke('text')
                .then((displayedText) => {

                    const cleanedDisplayedText = displayedText.replace('₹', '').replace(/,/g, '').trim();

                    // Convert both to numbers
                    const displayedAmountNumber = parseFloat(cleanedDisplayedText);
                    const expectedAmountNumber = parseFloat(expectedAmountFor50Percent);

                    if (isNaN(displayedAmountNumber) || isNaN(expectedAmountNumber)) {
                        throw new Error(`Could not parse amounts for comparison. Displayed: "${cleanedDisplayedText}", Expected: "${extractedAmountInclGst}"`);
                    }

                    // Rounding both numbers to the nearest whole number for comparison
                    const roundedDisplayedAmount = Math.round(displayedAmountNumber);
                    const roundedExpectedAmount = Math.round(expectedAmountNumber);

                    cy.log(`Cleaned Displayed Text: "${cleanedDisplayedText}", Parsed: ${displayedAmountNumber}, Rounded: ${roundedDisplayedAmount}`);
                    cy.log(`Expected Amount (from extractedAmountInclGst): "${extractedAmountInclGst}", Parsed: ${expectedAmountNumber}, Rounded: ${roundedExpectedAmount}`);

                    expect(roundedDisplayedAmount).to.equal(roundedExpectedAmount);
                });
                // cy.pause();
            cy.log(`Verified requesting amount for 50% contains: ${expectedAmountFor50Percent}`);

            // Validating Cancel Button
            cy.get('[data-cy="request-payment-dialog-cancel-button"]')
                .should('exist')
                .and('be.visible')
                .and('not.be.disabled')
                // .click();

            // Setting Intercepting Request Use
            cy.log('--- Setting up intercept for create_payment_request POST ---');
            cy.intercept(
                'POST',
                '**/api/method/nirmaan_stack.api.payments.project_payments.create_payment_request'
            ).as('createPaymentRequest');

            // Validating Confirm Button
            cy.get('[data-cy="request-payment-dialog-confirm-button"]')
                .should('exist')
                .and('be.visible')
                .and('not.be.disabled')
                .click();

            cy.wait('@createPaymentRequest', { timeout: 15000 }).then((interception) => {
                expect(interception.response?.statusCode).to.equal(200, 'Expected payment creation to succeed');
          
                // 1. Check if response body and message field exist
                if (interception.response?.body && interception.response.body.message) {
                    const messageString = interception.response.body.message;
                    cy.log(`Raw message string from API: ${messageString}`);
                    // cy.pause();
            
                    try {
                        const innerJson = JSON.parse(messageString);
                        cy.log('Parsed inner JSON:', innerJson);
                        // cy.pause();
            
                        if (innerJson && innerJson.name) {
                        const fullName = innerJson.name;
                        cy.log(`Full payment name from inner JSON: ${fullName}`);
                        // cy.pause();
            
                                const parts = fullName.split('-');
                                if (parts.length >= 2) {
                                    extractedPaymentIdentifier = parts[1];
                                    Cypress.env('extractedPaymentIdentifier', extractedPaymentIdentifier)
                                    cy.log(`Extracted Payment Suffix: ${extractedPaymentIdentifier}`);
                                    // cy.pause();
                                } else {
                                    cy.log('Could not extract suffix: "name" field format is unexpected after splitting.');
                                    throw new Error('Failed to parse payment suffix: Unexpected format of "name" field.');
                                }
                        } else {
                            cy.log('Could not extract "name": "name" field missing in parsed inner JSON.');
                            throw new Error('Failed to extract payment suffix: "name" field missing in inner JSON.');
                        }
                    } catch (e) {
                        cy.log(`Error parsing inner JSON string: ${e.message}`);
                        console.error("Failed to parse message string as JSON:", messageString, e);
                        throw new Error('Failed to parse inner JSON from payment response.');
                    }
                } else {
                    cy.log('Could not extract payment suffix: API response structure is unexpected (body or message field missing).');
                    console.error('Unexpected API response structure for payment creation:', interception.response?.body);
                    throw new Error('Failed to extract payment suffix: Unexpected API response structure.');
                }
            });

        });

        // Navigating To Project Payments Tab
        cy.get('[data-cy="project-payments-button"]', { timeout: 10000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // Using Search Bar Presence for making the Tab Stable and Interacted
        cy.get('[data-cy="procurement-requests-search-bar"]', { timeout: 16000})
            .should('be.visible');

        cy.then(() => { 
            const paymentIdToFind = Cypress.env('extractedPaymentIdentifier');
            if (!paymentIdToFind) {
                throw new Error('Extracted Payment Identifier is not set. Cannot proceed.');
            }

        cy.log(`Navigating to verify Payment Identifier: ${paymentIdToFind}`);
        cy.log(`Searching for identifier "${paymentIdToFind}" in the table.`);
            
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr', { timeout: 15000 })
            .contains('td span[title*="' + paymentIdToFind + '"]', paymentIdToFind, { matchCase: false })
            // cy.get('[data-cy="procurement-requests-data-table"] tbody tr td').contains(paymentIdToFind)
            .should('be.visible')
            .closest('tr')
            .then(($row) => {
                cy.log(`Found row containing payment identifier: ${paymentIdToFind}`);
            });
        
        cy.log(`Payment Identifier "${paymentIdToFind}" found in the Approve Payments table in Project Payments Module.`);
        // cy.pause();


        cy.get('[data-cy="payments-reject-button"]', { timeout: 10000 })
            .first()
            .scrollIntoView()
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click({force: true});
        // cy.pause();

        cy.contains('Are you sure you want to')
            .should('be.visible');

        cy.get('[data-cy="payment-action-dialog-cancel-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            // .click();

        cy.get('[data-cy="payment-action-dialog-confrim-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();
        });

        // cy.visit('http://localhost:8080/project-payments?approve_pay_pageIdx=0&approve_pay_pageSize=50&approve_pay_searchBy=name&tab=Approve+Payments');

        // cy.get('[data-cy="procurement-requests-data-table"]')
        //     .scrollTo('topRight', { easing: 'linear' });



        // --- Navigation to Approved Po's and Deleting the Payment --- //

        // --- Navigation to Purchase Orders Module ---
        cy.log('Navigating to Purchase Orders Module');
        cy.get('[data-cy="purchase-orders-button"]', { timeout: 10000 })
            .should('be.visible')
            .click();
        cy.url().should('include', '/purchase-orders');

        // --- Navigate to Approved POs Tab ---
        cy.log('Navigating to Approved POs Tab');
        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // --- Wait for PO List Table to Load ---
        cy.log('Waiting for PO list table to load');
        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 6000 })
            .should('be.visible');


        cy.then(() => {
            const prSuffixToFind = Cypress.env('extractedPurchaseOrderNumber');
            if (!prSuffixToFind) {
                throw new Error('Extracted PR Suffix is not set. Cannot proceed.');
            }

            cy.log(`Navigating to Purchase Orders table to find PO related to PR Suffix: ${prSuffixToFind}`);

            cy.log(`Searching for PO containing identifier part "${prSuffixToFind}" in the table.`);
            // cy.pause();

            // Targeting the specific table using its data-cy attribute
            cy.get('[data-cy="procurement-requests-data-table"] tbody tr', { timeout: 15000 })
                .contains(`td a.font-medium.whitespace-nowrap`, prSuffixToFind, { matchCase: false })
                .should('be.visible')
                .click();
            cy.log(`Found PO link containing: ${prSuffixToFind}`)

            // cy.pause();

            // --- Ensuring the PO details page is stable ---
            cy.log('Waiting for PO details page to stabilize');
            cy.get('[data-cy="total-amount-incl-gst"]', { timeout: 10000 }) 
                .should('be.visible');

            cy.log(`Successfully navigated to PO details for PR Suffix "${prSuffixToFind}".`);
            // Add further assertions for the PO details page if needed
        });

        // --- Transaction Details Card --- //
        cy.get('[data-cy="po-details-payment-details-button"]', { timeout: 10000 })
            .should('exist')
            .contains('Payment Details')
            .and('be.visible')
            .click();
        
        cy.get('[data-cy="transaction=details-card-heading"]')
            .should('exist')
            .and('be.visible')
            .and('contain.text', 'Transaction Details');

        cy.get('[data-cy="rejecte-payments-button"]')
            .first()
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // --- Delete Payments Dialog --- //
        cy.get('[data-cy="delete-payment-cancel-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            // .click();

        cy.get('[data-cy="delete-payment-confirm-delete-button"]')
            .first()
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();



        // --- Requesting Payment ( Custom ) Again --- //
        cy.get('[data-cy="total-amount-incl-gst"]').find('span').invoke('text')
        .then(rawText => rawText.replace('₹', '').replace(/,/g, ''))
        .as('amountInclGst');

    
        // --- Step 2: Use cy.then() to access aliased values and proceed ---
        // All subsequent logic that depends on these amounts can be allowed to process inside this cy.then() only 
        cy.then(function () { 
            // Using function() to get access to 'this.aliasName'
            const extractedAmountInclGst = this.amountInclGst;

            cy.log(`Cleaned amount Incl. GST: ${extractedAmountInclGst}`);
            // cy.pause();

            // Convert to numbers for calculations
            const numAmountInclGst = parseFloat(extractedAmountInclGst);

            if (isNaN(numAmountInclGst)) {
                throw new Error('Failed to parse extracted amounts.');
            }

            // --- Open the Add Payments Dialog ---
            cy.log('Attempting to click Request Payment button');
            cy.get('[data-cy="po-details-request-payment-button"]', { timeout: 10000 })
                .should('be.visible')
                .and('not.be.disabled')
                .click();

            cy.log('Waiting for page to become interactive after button click');
            cy.get('body', { timeout: 30000 })

            cy.log('Waiting for Add Payments dialog to be visible and stable');
            cy.get('[data-cy="add-payments-dialog-title"]', { timeout: 10000 })
                .should('be.visible');
            cy.log('Add Payments dialog is now visible and page is interactive.');

            
            // --- Validating Custom Amount ---
            cy.log('--- Validating Custom Amount (Exceeding) ---');
            const customAmount = (numAmountInclGst - 3).toString();
            cy.log(`customAmountExceeding: ------> ${customAmount}`);
            cy.get('[data-cy="custom-amount-check"]', { timeout: 10000 }).click();
            cy.get('[data-cy="custom-amount-input"]')
                .should('not.be.disabled')
                .clear()
                .type(customAmount);  
            
            cy.log(`Verified Custom Requesting amount contains: ${customAmount}`);
            // cy.pause();
            

            // Validating Cancel Button
            cy.get('[data-cy="request-payment-dialog-cancel-button"]')
                .should('exist')
                .and('be.visible')
                .and('not.be.disabled')
                // .click();

            // Setting Intercepting Request Use
            cy.log('--- Setting up intercept for create_payment_request POST ---');
            cy.intercept(
                'POST',
                '**/api/method/nirmaan_stack.api.payments.project_payments.create_payment_request'
            ).as('createPaymentRequest');

            // Validating Confirm Button
            cy.get('[data-cy="request-payment-dialog-confirm-button"]')
                .should('exist')
                .and('be.visible')
                .and('not.be.disabled')
                .click();

            cy.wait('@createPaymentRequest', { timeout: 15000 }).then((interception) => {
                expect(interception.response?.statusCode).to.equal(200, 'Expected payment creation to succeed');
        
                // 1. Check if response body and message field exist
                if (interception.response?.body && interception.response.body.message) {
                    const messageString = interception.response.body.message;
                    cy.log(`Raw message string from API: ${messageString}`);
                    // cy.pause();
            
                    try {
                        const innerJson = JSON.parse(messageString);
                        cy.log('Parsed inner JSON:', innerJson);
                        // cy.pause();
            
                        if (innerJson && innerJson.name) {
                        const fullName = innerJson.name;
                        cy.log(`Full payment name from inner JSON: ${fullName}`);
                        // cy.pause();
            
                                const parts = fullName.split('-');
                                if (parts.length >= 2) {
                                    extractedPaymentIdentifier = parts[1];
                                    Cypress.env('extractedPaymentIdentifier', extractedPaymentIdentifier)
                                    cy.log(`Extracted Payment Suffix: ${extractedPaymentIdentifier}`);
                                    // cy.pause();
                                } else {
                                    cy.log('Could not extract suffix: "name" field format is unexpected after splitting.');
                                    throw new Error('Failed to parse payment suffix: Unexpected format of "name" field.');
                                }
                        } else {
                            cy.log('Could not extract "name": "name" field missing in parsed inner JSON.');
                            throw new Error('Failed to extract payment suffix: "name" field missing in inner JSON.');
                        }
                    } catch (e) {
                        cy.log(`Error parsing inner JSON string: ${e.message}`);
                        console.error("Failed to parse message string as JSON:", messageString, e);
                        throw new Error('Failed to parse inner JSON from payment response.');
                    }
                } else {
                    cy.log('Could not extract payment suffix: API response structure is unexpected (body or message field missing).');
                    console.error('Unexpected API response structure for payment creation:', interception.response?.body);
                    throw new Error('Failed to extract payment suffix: Unexpected API response structure.');
                }
            });

        });

        // Navigating To Project Payments Tab
        cy.get('[data-cy="project-payments-button"]', { timeout: 10000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // Using Search Bar Presence for making the Tab Stable and Interacted
        cy.get('[data-cy="procurement-requests-search-bar"]', { timeout: 16000})
            .should('be.visible');

        cy.then(() => { 
            const paymentIdToFind = Cypress.env('extractedPaymentIdentifier');
            if (!paymentIdToFind) {
                throw new Error('Extracted Payment Identifier is not set. Cannot proceed.');
            }

        cy.log(`Navigating to verify Payment Identifier: ${paymentIdToFind}`);
        cy.log(`Searching for identifier "${paymentIdToFind}" in the table.`);
            
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr', { timeout: 15000 })
            .contains('td span[title*="' + paymentIdToFind + '"]', paymentIdToFind, { matchCase: false })
            // cy.get('[data-cy="procurement-requests-data-table"] tbody tr td').contains(paymentIdToFind)
            .should('be.visible')
            .closest('tr')
            .then(($row) => {
                cy.log(`Found row containing payment identifier: ${paymentIdToFind}`);
            });
        
        cy.log(`Payment Identifier "${paymentIdToFind}" found in the Approve Payments table in Project Payments Module.`);
        // cy.pause();


        cy.get('[data-cy="payments-approve-button"]', { timeout: 10000 })
            .first()
            .scrollIntoView()
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click({force: true});

        cy.contains('Are you sure you want to')
            .should('be.visible');

        cy.get('[data-cy="payment-action-dialog-cancel-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            // .click();

        cy.get('[data-cy="payment-action-dialog-confrim-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.log('Payments Approved Successfully...')
        // cy.pause();

        });


        // --- Navigating to Purchase Orders and Checking Delete Payment Button Unavailability --- //
        cy.log('Navigating to Purchase Orders Module');
        cy.get('[data-cy="purchase-orders-button"]', { timeout: 10000 })
            .should('be.visible')
            .click();
            
        cy.url().should('include', '/purchase-orders');

        // --- Navigate to Approved POs Tab ---
        cy.log('Navigating to Approved POs Tab');
        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        // --- Wait for PO List Table to Load ---
        cy.log('Waiting for PO list table to load');
        cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 6000 })
            .should('be.visible');

        // // --- Ensuring the PO details page is stable ---
        // cy.log('Waiting for PO details page to stabilize');
        // cy.get('[data-cy="total-amount-incl-gst"]', { timeout: 10000 }) 
        //     .should('be.visible');

        cy.then(() => {
            const prSuffixToFind = Cypress.env('extractedPurchaseOrderNumber');
            if (!prSuffixToFind) {
                throw new Error('Extracted PR Suffix is not set. Cannot proceed.');
            }

            cy.log(`Navigating to Purchase Orders table to find PO related to PR Suffix: ${prSuffixToFind}`);

            cy.log(`Searching for PO containing identifier part "${prSuffixToFind}" in the table.`);
            // cy.pause();

            // Targeting the specific table using its data-cy attribute
            cy.get('[data-cy="procurement-requests-data-table"] tbody tr', { timeout: 15000 })
                .contains(`td a.font-medium.whitespace-nowrap`, prSuffixToFind, { matchCase: false })
                .should('be.visible')
                .click();
            cy.log(`Found PO link containing: ${prSuffixToFind}`)

            // cy.pause();

            // --- Ensuring the PO details page is stable ---
            cy.log('Waiting for PO details page to stabilize');
            cy.get('[data-cy="total-amount-incl-gst"]', { timeout: 10000 }) 
                .should('be.visible');

            cy.log(`Successfully navigated to PO details for PR Suffix "${prSuffixToFind}".`);
            // Add further assertions for the PO details page if needed
        });

        // --- Transaction Details Card --- //
        cy.get('[data-cy="po-details-payment-details-button"]', { timeout: 10000 })
            .should('exist')
            .contains('Payment Details')
            .and('be.visible')
            .click();
        
        cy.get('[data-cy="transaction=details-card-heading"]')
            .should('exist')
            .and('be.visible')
            .and('contain.text', 'Transaction Details');

        // --- Checking for Empty Table in Transaction Details Card --- //
        const tableSelector = '[data-cy="transactions-details-table"]';

        cy.log('Verifying the first payment row in the transactions table.');

        cy.get(tableSelector)
            .find('tbody tr')
            .first()
            .should('be.visible')
            .within(() => {
                // Verify the status in the 4th cell (index 3) of this row
                cy.get('td')
                    .eq(3)
                    .should('be.visible')
                    .invoke('text')
                    .then((statusText) => {
                        const trimmedStatus = statusText.trim();
                        expect(trimmedStatus).to.equal('Approved');
                        cy.log(`First payment status is: "${trimmedStatus}". Verified successfully.`);
                    });
            });

        cy.log('End To End Full Test Flow Completed without Any ERRORS :) ');
        
    });
});