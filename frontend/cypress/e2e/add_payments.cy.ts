/// <reference types="Cypress" />

import cypress from "cypress";

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

    it('Navigates to Dispatched POs tab, selects a PO, and opens the Add Payments dialog and Add Payments', () => { 

        // Variable for Extracted Payment Identifier
        let extractedPaymentIdentifier;

        // --- Navigation to Purchase Orders Module ---
        cy.log('Navigating to Purchase Orders Module');
        cy.get('[data-cy="purchase-orders-button"]')
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

        // --- Step 1: Extract all necessary amounts and store them using aliases ---
        cy.get('[data-cy="total-amount-excl-gst"]').find('span').invoke('text')
            .then(rawText => rawText.replace('₹', '').replace(/,/g, ''))
            .as('amountExclGst');

        cy.get('[data-cy="total-amount-incl-gst"]').find('span').invoke('text')
            .then(rawText => rawText.replace('₹', '').replace(/,/g, ''))
            .as('amountInclGst');

        
        // --- Step 2: Use cy.then() to access aliased values and proceed ---
        // All subsequent logic that depends on these amounts can be allowed to process inside this cy.then() only 
        cy.then(function () { 
            // Using function() to get access to 'this.aliasName'
            const extractedAmountExclGst = this.amountExclGst;
            const extractedAmountInclGst = this.amountInclGst;

            cy.log(`Cleaned amount Excl. GST: ${extractedAmountExclGst}`);
            cy.log(`Cleaned amount Incl. GST: ${extractedAmountInclGst}`);
            // cy.pause();

            // Convert to numbers for calculations
            const numAmountExclGst = parseFloat(extractedAmountExclGst);
            const numAmountInclGst = parseFloat(extractedAmountInclGst);

            if (isNaN(numAmountExclGst) || isNaN(numAmountInclGst)) {
                throw new Error('Failed to parse one or both extracted amounts.');
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
                    // const amountToRound = displayedText.replace('₹', '').replace(/,/g, '').trim();
                    // const numericAmount = parseFloat(amountToRound);
                    // const cleanedDisplayedText = Math.ceil(numericAmount)
                    // expect(cleanedDisplayedText).to.include(expectedAmountFor50Percent);

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


            // --- Validation 2: Total Amount (Excl. GST) Check ---
            cy.log('--- Validating Total Amount (Excl. GST) Check ---');
            cy.get('[data-cy="total-amount-excl-gst-check"]', { timeout: 10000 }).click();
            
            cy.get('[data-cy="requesting-amount"]', { timeout: 10000 })
                .should('be.visible')
                .invoke('text')
                .then((displayedText) => {
                    // const cleanedDisplayedText = displayedText.replace('₹', '').replace(/,/g, '').trim();
                    // expect(cleanedDisplayedText).to.include(extractedAmountExclGst);

                    const cleanedDisplayedText = displayedText.replace('₹', '').replace(/,/g, '').trim();

                    // Convert both to numbers
                    const displayedAmountNumber = parseFloat(cleanedDisplayedText);
                    const expectedAmountNumber = parseFloat(extractedAmountExclGst);

                    if (isNaN(displayedAmountNumber) || isNaN(expectedAmountNumber)) {
                        throw new Error(`Could not parse amounts for comparison. Displayed: "${cleanedDisplayedText}", Expected: "${extractedAmountExclGst}"`);
                    }

                    // Rounding both numbers to the nearest whole number for comparison
                    const roundedDisplayedAmount = Math.ceil(displayedAmountNumber);
                    const roundedExpectedAmount = Math.round(expectedAmountNumber);

                    cy.log(`Cleaned Displayed Text: "${cleanedDisplayedText}", Parsed: ${displayedAmountNumber}, Rounded: ${roundedDisplayedAmount}`);
                    cy.log(`Expected Amount (from extractedAmountInclGst): "${extractedAmountExclGst}", Parsed: ${expectedAmountNumber}, Rounded: ${roundedExpectedAmount}`);

                    // expect(cleanedDisplayedText).to.include(extractedAmountInclGst);
                    expect(roundedDisplayedAmount).to.equal(roundedExpectedAmount);
                });
            // cy.pause();
            cy.log(`Verified requesting amount for Excl. GST contains: ${extractedAmountExclGst}`);


            // --- Validation 3: Full Amount Check ---
            cy.log('--- Validating Full Amount Check ---');
            cy.get('[data-cy="full-amount-check"]', { timeout: 10000 }).click();

            cy.get('[data-cy="requesting-amount"]', { timeout: 10000 })
                .should('be.visible')
                .invoke('text')
                .then((displayedText) => {
                    const cleanedDisplayedText = displayedText.replace('₹', '').replace(/,/g, '').trim();

                    // Convert both to numbers
                    const displayedAmountNumber = parseFloat(cleanedDisplayedText);
                    const expectedAmountNumber = parseFloat(extractedAmountInclGst);

                    if (isNaN(displayedAmountNumber) || isNaN(expectedAmountNumber)) {
                        throw new Error(`Could not parse amounts for comparison. Displayed: "${cleanedDisplayedText}", Expected: "${extractedAmountInclGst}"`);
                    }

                    // Rounding both numbers to the nearest whole number for comparison
                    const roundedDisplayedAmount = Math.ceil(displayedAmountNumber);
                    const roundedExpectedAmount = Math.round(expectedAmountNumber);

                    cy.log(`Cleaned Displayed Text: "${cleanedDisplayedText}", Parsed: ${displayedAmountNumber}, Rounded: ${roundedDisplayedAmount}`);
                    cy.log(`Expected Amount (from extractedAmountInclGst): "${extractedAmountInclGst}", Parsed: ${expectedAmountNumber}, Rounded: ${roundedExpectedAmount}`);

                    expect(roundedDisplayedAmount).to.equal(roundedExpectedAmount);
                });
                // cy.pause();
            cy.log(`Verified requesting amount for Full Amount contains: ${extractedAmountInclGst}`);

            
            // --- Validation 4: Custom Amount (Exceeding) ---
            cy.log('--- Validating Custom Amount (Exceeding) ---');
            const customAmountExceeding = (numAmountInclGst + 300).toString();
            cy.log(`customAmountExceeding: ------> ${customAmountExceeding}`);
            cy.get('[data-cy="custom-amount-check"]', { timeout: 10000 }).click();
            cy.get('[data-cy="custom-amount-input"]')
                .should('not.be.disabled')
                .clear()
                .type(customAmountExceeding);
            
            // Checking for the warning message
            cy.get('[data-cy="amount-warning"]', {timeout: 5000})
                .should('be.visible')
                .and('not.be.empty');
            // cy.pause();
            cy.log('Verified warning message appears for custom amount exceeding total.');

            // --- Validation 5: Checking Full Amount and Sending it For Approval ---
            cy.log('--- Validating Full Amount Check ---');
            cy.get('[data-cy="full-amount-check"]', { timeout: 10000 }).click();

            cy.get('[data-cy="requesting-amount"]', { timeout: 10000 })
                .should('be.visible')
                .invoke('text')
                .then((displayedText) => {
                    const cleanedDisplayedText = displayedText.replace('₹', '').replace(/,/g, '').trim();

                    // Convert both to numbers
                    const displayedAmountNumber = parseFloat(cleanedDisplayedText);
                    const expectedAmountNumber = parseFloat(extractedAmountInclGst);

                    if (isNaN(displayedAmountNumber) || isNaN(expectedAmountNumber)) {
                        throw new Error(`Could not parse amounts for comparison. Displayed: "${cleanedDisplayedText}", Expected: "${extractedAmountInclGst}"`);
                    }

                    // Rounding both numbers to the nearest whole number for comparison
                    const roundedDisplayedAmount = Math.ceil(displayedAmountNumber);
                    const roundedExpectedAmount = Math.round(expectedAmountNumber);

                    cy.log(`Cleaned Displayed Text: "${cleanedDisplayedText}", Parsed: ${displayedAmountNumber}, Rounded: ${roundedDisplayedAmount}`);
                    cy.log(`Expected Amount (from extractedAmountInclGst): "${extractedAmountInclGst}", Parsed: ${expectedAmountNumber}, Rounded: ${roundedExpectedAmount}`);

                    expect(roundedDisplayedAmount).to.equal(roundedExpectedAmount);
                });

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

            // let extractedPaymentIdentifier;

            cy.wait('@createPaymentRequest', { timeout: 15000 }).then((interception) => {
                expect(interception.response?.statusCode).to.equal(200, 'Expected payment creation to succeed');
          
                // 1. Check if response body and message field exist
                if (interception.response?.body && interception.response.body.message) {
                     // This is a STRING containing JSON
                    const messageString = interception.response.body.message;
                    cy.log(`Raw message string from API: ${messageString}`);
                    // cy.pause();
            
                    try {
                        // 2. Parsing the inner JSON string (the value of 'message')
                        const innerJson = JSON.parse(messageString);
                        cy.log('Parsed inner JSON:', innerJson);
                        // cy.pause();
            
                        // 3. Checking if the parsed inner JSON has a 'name' property or not
                        if (innerJson && innerJson.name) {
                        const fullName = innerJson.name;
                        cy.log(`Full payment name from inner JSON: ${fullName}`);
                        // cy.pause();
            
                                // 4. Split the name string and extract the Required Part
                                const parts = fullName.split('-');
                                if (parts.length >= 2) { // Ensure there are at least two parts
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

        // Dispatching the PO agter Adding Payments
        cy.get('[data-cy="po-details-dispatch-po-button"]', { timeout: 9000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="po-details-mark-as-dispatched-button"]', { timeout: 9000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="mark-as-dispatched-confirm-button"]', { timeout: 9000 })
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

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
            });

        
    });
});
